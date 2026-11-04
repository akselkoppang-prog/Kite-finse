import { getDB, setMeta, sizeOf, type BackupRec, type ProjectRec } from './db';
import { SLICES, CACHE_KEYS, pick } from './slices';
import { flush, switchProject, useSave, listFields } from './persistence';
import { uid } from '../lib/geo';
import { useStore, type State } from '../state/store';
import { DEFAULT_PROJECT, type ProjectMeta } from '../lib/project/meta';
import { examplePlan } from '../lib/sim/expedition';
import type { Route } from '../types';

/**
 * Prosjektadministrasjon. Hvert prosjekt har egne poster (projectId) i slices/routes/caches/blobs/backups,
 * så ruter, GPX, dagplaner, vind, kites, teltplasser, punkter, vann-godkjenninger, notater og
 * eksportinnstillinger er helt atskilt. Ingen operasjon her skriver til et annet prosjekt enn det som er navngitt.
 */

export async function listProjects(): Promise<ProjectRec[]> {
  const db = await getDB();
  return (await db.getAll('projects')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Les et lagret prosjekt fra databasen (uten å åpne det). */
export async function readProjectState(projectId: string): Promise<Record<string, unknown>> {
  const db = await getDB();
  const [slices, routes, caches] = await Promise.all([
    db.getAllFromIndex('slices', 'byProject', projectId),
    db.getAllFromIndex('routes', 'byProject', projectId),
    db.getAllFromIndex('caches', 'byProject', projectId),
  ]);
  const st: Record<string, unknown> = {};
  slices.forEach((s) => s.slice !== 'routeOrder' && Object.assign(st, s.value as object));
  const order = (slices.find((s) => s.slice === 'routeOrder')?.value as string[] | undefined) ?? [];
  const byId = new Map(routes.map((r) => [r.routeId, r.value as Route]));
  st.routes = [...order.filter((id) => byId.has(id)).map((id) => byId.get(id)!), ...[...byId.keys()].filter((id) => !order.includes(id)).map((id) => byId.get(id)!)];
  caches.forEach((c) => (st[c.name] = c.value));
  return st;
}

async function writeProject(projectId: string, state: Record<string, unknown>, rec: Partial<ProjectRec>) {
  const db = await getDB();
  const now = new Date().toISOString();
  const tx = db.transaction(['projects', 'slices', 'routes', 'caches'], 'readwrite');
  if (await tx.objectStore('projects').get(projectId)) throw new Error('Prosjekt-id finnes allerede – avbrutt for ikke å overskrive');
  const ops: Promise<unknown>[] = [];
  if (!state.project) state = { ...state, project: { ...DEFAULT_PROJECT, name: rec.name ?? 'Gjenopprettet prosjekt' } };
  const meta = state.project as ProjectMeta;
  ops.push(tx.objectStore('projects').put({ id: projectId, createdAt: now, updatedAt: now, schema: 1, ...listFields({ ...(useStore.getState() as State), ...(state as Partial<State>) } as State), ...rec, name: meta.name }));
  for (const [n, keys] of Object.entries(SLICES)) {
    const value = pick(state, keys as string[]);
    if (Object.keys(value).length) ops.push(tx.objectStore('slices').put({ projectId, slice: n, value, updatedAt: now, size: sizeOf(value) }));
  }
  const routes = (state.routes as Route[]) ?? [];
  ops.push(tx.objectStore('slices').put({ projectId, slice: 'routeOrder', value: routes.map((r) => r.id), updatedAt: now, size: 0 }));
  for (const r of routes) ops.push(tx.objectStore('routes').put({ projectId, routeId: r.id, value: r, updatedAt: now, size: sizeOf(r) }));
  for (const c of CACHE_KEYS) if (state[c] != null) ops.push(tx.objectStore('caches').put({ projectId, name: c, value: state[c], updatedAt: now, size: sizeOf(state[c]) }));
  await Promise.all([...ops, tx.done]);
}

/** Standardverdier for et helt nytt prosjekt (samme som en fersk installasjon). */
function freshState(): Record<string, unknown> {
  const init = useStore.getInitialState?.() ?? useStore.getState();
  const st: Record<string, unknown> = {};
  for (const keys of Object.values(SLICES)) for (const k of keys) st[k as string] = (init as unknown as Record<string, unknown>)[k as string];
  st.routes = [];
  st.plans = [examplePlan()];
  st.activePlanId = 'plan-main';
  st.mainPlanId = 'plan-main';
  st.tab = 'oversikt';
  return st;
}

export interface NewProjectOpts { name: string; description?: string; template: 'tom' | 'finse'; tripDate?: string; icon?: string }

/** Lag nytt prosjekt og åpne det. Det aktive prosjektet lagres først og røres ikke. */
export async function createProject(o: NewProjectOpts): Promise<string> {
  await flush();
  const id = uid('prj');
  const st = freshState();
  st.project = { ...DEFAULT_PROJECT, name: o.name.trim() || 'Ny ekspedisjon', description: o.description ?? '', icon: o.icon ?? '🪁', origin: o.template === 'finse' ? 'Finse' : '', destination: o.template === 'finse' ? 'Rjukan' : '', status: 'idé', seedGpx: o.template === 'finse' } satisfies ProjectMeta;
  if (o.tripDate) st.tripDate = o.tripDate;
  if (o.template === 'tom') st.places = {};
  await writeProject(id, st, {});
  await switchProject(id);
  if (o.template === 'finse') {
    const { loadInitialGpx } = await import('../lib/actions');
    await loadInitialGpx(true);
    await flush();
  }
  return id;
}

/** Bytt id-er for bilder (blobs) i en serialisert tilstand. */
function remapIds(json: string, map: Map<string, string>): string {
  let out = json;
  map.forEach((to, from) => (out = out.split(`"${from}"`).join(`"${to}"`)));
  return out;
}

/** Kopi av et prosjekt, inkludert bilder (nye id-er). Originalen endres ikke. */
export async function duplicateProject(sourceId: string, name?: string): Promise<string> {
  if (sourceId === useSave.getState().projectId) await flush();
  const db = await getDB();
  const src = await db.get('projects', sourceId);
  if (!src) throw new Error('Fant ikke prosjektet');
  const st = await readProjectState(sourceId);
  const blobs = await db.getAllFromIndex('blobs', 'byProject', sourceId);
  const map = new Map(blobs.map((b) => [b.id, uid(b.role === 'thumb' ? 'thumb' : 'img')]));
  const copy = JSON.parse(remapIds(JSON.stringify(st), map)) as Record<string, unknown>;
  const meta = { ...DEFAULT_PROJECT, ...((copy.project as ProjectMeta) ?? { name: src.name }) };
  copy.project = { ...meta, name: name ?? `${meta.name} (kopi)`, archived: false };
  const id = uid('prj');
  if (blobs.length) {
    const tx = db.transaction('blobs', 'readwrite');
    for (const b of blobs) tx.store.put({ ...b, id: map.get(b.id)!, parentId: b.parentId ? map.get(b.parentId) ?? b.parentId : undefined, projectId: id, createdAt: new Date().toISOString() });
    await tx.done;
  }
  await writeProject(id, copy, {});
  return id;
}

/** Endre opplysninger om et prosjekt. Aktivt prosjekt endres via tilstanden (autolagres); andre direkte i databasen. */
export async function updateProjectMeta(projectId: string, patch: Partial<ProjectMeta>) {
  if (projectId === useSave.getState().projectId) {
    const st = useStore.getState();
    st.set({ project: { ...st.project, ...patch } });
    await flush();
    return;
  }
  const db = await getDB();
  const tx = db.transaction(['projects', 'slices'], 'readwrite');
  const rec = await tx.objectStore('projects').get(projectId);
  if (!rec) throw new Error('Fant ikke prosjektet');
  const sl = await tx.objectStore('slices').get([projectId, 'project']);
  const cur = ((sl?.value as { project?: ProjectMeta })?.project) ?? { ...DEFAULT_PROJECT, name: rec.name };
  const project = { ...cur, ...patch };
  const value = { ...((sl?.value as object) ?? {}), project };
  const now = new Date().toISOString();
  await Promise.all([
    tx.objectStore('slices').put({ projectId, slice: 'project', value, updatedAt: now, size: sizeOf(value) }),
    tx.objectStore('projects').put({ ...rec, name: project.name, description: project.description, icon: project.icon, status: project.status, archived: !!project.archived, coverThumbId: project.coverThumbId, updatedAt: now }),
    tx.done,
  ]);
}

/**
 * Slett et prosjekt (krever bekreftelse i grensesnittet). Før sletting lagres en beskyttet sikkerhetskopi
 * av prosjektdataene, så det kan gjenopprettes fra Innstillinger → Lagring. Det aktive prosjektet kan ikke slettes.
 */
export async function deleteProject(projectId: string): Promise<void> {
  if (projectId === useSave.getState().projectId) throw new Error('Åpne et annet prosjekt før du sletter dette.');
  const db = await getDB();
  const rec = await db.get('projects', projectId);
  if (!rec) return;
  const st = await readProjectState(projectId);
  const data = JSON.stringify({ schema: 1, slices: pick(st, Object.values(SLICES).flat() as string[]), routes: st.routes });
  const bk: BackupRec = { id: uid('bk'), projectId, createdAt: new Date().toISOString(), reason: `Før sletting av prosjektet «${rec.name}»`, size: new Blob([data]).size, data, auto: false, keep: true };
  await db.put('backups', bk);
  const tx = db.transaction(['projects', 'slices', 'routes', 'caches', 'blobs'], 'readwrite');
  tx.objectStore('projects').delete(projectId);
  for (const s of ['slices', 'routes', 'caches', 'blobs'] as const) {
    let c = await tx.objectStore(s).index('byProject').openCursor(projectId);
    while (c) {
      await c.delete();
      c = await c.continue();
    }
  }
  await tx.done;
  await setMeta(`deletedProject:${projectId}`, { name: rec.name, at: new Date().toISOString(), backupId: bk.id });
}

/** Gjenopprett et slettet prosjekt fra sikkerhetskopien som ble tatt før sletting. */
export async function restoreDeletedProject(backupId: string): Promise<string> {
  const db = await getDB();
  const bk = await db.get('backups', backupId);
  if (!bk) throw new Error('Fant ikke kopien');
  const snap = JSON.parse(bk.data) as { slices: Record<string, unknown>; routes: Route[] };
  const st = { ...snap.slices, routes: snap.routes };
  const exists = await db.get('projects', bk.projectId);
  const id = exists ? uid('prj') : bk.projectId;
  await writeProject(id, st, {});
  return id;
}
