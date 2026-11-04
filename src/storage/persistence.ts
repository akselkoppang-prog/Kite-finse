import { create } from 'zustand';
import { useStore, routeHash, type State } from '../state/store';
import { getDB, getMeta, setMeta, sizeOf, type CacheRec, type RouteRec, type SliceRec } from './db';
import { SLICES, CACHE_KEYS, pick, uncoveredKeys } from './slices';
import { createBackup, pruneBackups } from './backup';
import { majorChange } from './hooks';
import { migrateFromLocalStorage, type MigrationReport } from './migrate';
import { elevSnapshot, elevDirty, loadElevCache, markElevSaved } from '../lib/api/kartverket';
import type { Route } from '../types';

export type SaveState = 'loading' | 'saved' | 'saving' | 'unsaved' | 'warning' | 'failed' | 'unavailable';

export interface EmergencyJournal { projectId: string; at: string; slices: Record<string, Record<string, unknown>>; routes: Route[]; deletedRoutes: string[] }

interface SaveStore {
  state: SaveState;
  lastSavedAt?: string;
  lastBackupAt?: string;
  error?: string;
  warning?: string;
  projectId: string;
  projectName: string;
  persisted: boolean | null;
  quota?: { usage: number; quota: number };
  recovery: EmergencyJournal | null;
  migration: MigrationReport | null;
  saves: number;
  set: (p: Partial<SaveStore>) => void;
}

export const useSave = create<SaveStore>((set) => ({
  state: 'loading',
  projectId: 'default',
  projectName: 'Finse–Rjukan 2027',
  persisted: null,
  recovery: null,
  migration: null,
  saves: 0,
  set: (p) => set(p),
}));

const INITIAL: Record<string, unknown> = { ...(useStore.getState() as unknown as Record<string, unknown>) };
const EMERGENCY_KEY = 'kite.emergency';

/** Referanser til sist lagrede verdier per felt / rute / cache – avgjør hva som er endret. */
const lastRefs = new Map<string, unknown>();
const lastRoutes = new Map<string, Route>();
const lastCaches = new Map<string, unknown>();
let hydrating = true;
let saving: Promise<void> | null = null;
let pending = false;
let timer: number | undefined;
let firstDirtyAt = 0;
let retryMs = 0;
let changesSinceBackup = 0;

function dirtySlices(st: Record<string, unknown>): string[] {
  return Object.entries(SLICES)
    .filter(([, keys]) => keys.some((k) => st[k] !== lastRefs.get(k as string)))
    .map(([name]) => name);
}

function dirtyRoutes(st: State): { changed: Route[]; deleted: string[] } {
  const ids = new Set(st.routes.map((r) => r.id));
  return {
    changed: st.routes.filter((r) => lastRoutes.get(r.id) !== r),
    deleted: [...lastRoutes.keys()].filter((id) => !ids.has(id)),
  };
}

export function isDirty(): boolean {
  const st = useStore.getState();
  const d = dirtyRoutes(st);
  return dirtySlices(st as unknown as Record<string, unknown>).length > 0 || d.changed.length > 0 || d.deleted.length > 0;
}

/** Bare bufre data for nåværende ruteversjoner – gamle versjoner kan hentes på nytt og lagres ikke. */
function prunedCache(name: string, st: State): unknown {
  const v = (st as unknown as Record<string, unknown>)[name];
  if ((name === 'lakes' || name === 'terrain') && v && typeof v === 'object') {
    const keep = new Set(st.routes.map((r) => routeHash(r)));
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => keep.has(k)));
  }
  return v;
}

/** Felt som kopieres til prosjektlisten (så listen kan vises uten å laste hvert prosjekt). */
export function listFields(st: State) {
  const m = st.project;
  return { name: m.name, description: m.description, icon: m.icon, status: m.status, archived: !!m.archived, coverThumbId: m.coverThumbId, tripDate: st.tripDate, days: st.plans.find((p) => p.id === st.mainPlanId)?.days.length ?? st.tripDays };
}

function schedule() {
  if (hydrating) return;
  const s = useSave.getState();
  if (s.state !== 'saving' && s.state !== 'failed') s.set({ state: 'unsaved' });
  if (!firstDirtyAt) firstDirtyAt = Date.now();
  clearTimeout(timer);
  // debounce 400 ms, men aldri mer enn 2 s etter første ulagrede endring
  const wait = Math.max(0, Math.min(400, 2000 - (Date.now() - firstDirtyAt)));
  timer = window.setTimeout(() => void flush(), wait);
}

/** Skriver alle endrede deler i ÉN transaksjon. Løser først når IndexedDB har bekreftet. */
export function flush(): Promise<void> {
  if (hydrating) return Promise.resolve();
  if (saving) {
    pending = true;
    return saving;
  }
  clearTimeout(timer);
  saving = doSave().finally(() => {
    saving = null;
    if (pending) {
      pending = false;
      void flush();
    }
  });
  return saving;
}

async function doSave() {
  const st = useStore.getState();
  const raw = st as unknown as Record<string, unknown>;
  const pid = useSave.getState().projectId;
  const slices = dirtySlices(raw);
  const { changed, deleted } = dirtyRoutes(st);
  const cacheNames = [...CACHE_KEYS].filter((k) => raw[k] !== lastCaches.get(k));
  const elev = elevDirty();
  if (!slices.length && !changed.length && !deleted.length && !cacheNames.length && !elev) {
    useSave.getState().set({ state: useSave.getState().warning ? 'warning' : 'saved' });
    firstDirtyAt = 0;
    return;
  }
  const now = new Date().toISOString();
  // referanser tatt NÅ – endringer under skriving fanges av neste lagring
  const refs = new Map<string, unknown>();
  slices.forEach((n) => SLICES[n].forEach((k) => refs.set(k as string, raw[k as string])));
  const routeRefs = changed.map((r) => r);
  const critical = slices.length || changed.length || deleted.length;
  if (critical) useSave.getState().set({ state: 'saving' });
  try {
    const db = await getDB();
    if (critical) {
      const tx = db.transaction(['slices', 'routes', 'meta', 'projects'], 'readwrite');
      const ops: Promise<unknown>[] = [];
      for (const n of slices) {
        const value = pick(raw, SLICES[n] as string[]);
        const rec: SliceRec = { projectId: pid, slice: n, value, updatedAt: now, size: sizeOf(value) };
        ops.push(tx.objectStore('slices').put(rec));
      }
      // rekkefølgen på rutene
      ops.push(tx.objectStore('slices').put({ projectId: pid, slice: 'routeOrder', value: st.routes.map((r) => r.id), updatedAt: now, size: 0 }));
      for (const r of routeRefs) {
        const rec: RouteRec = { projectId: pid, routeId: r.id, value: r, updatedAt: now, size: sizeOf(r) };
        ops.push(tx.objectStore('routes').put(rec));
      }
      for (const id of deleted) ops.push(tx.objectStore('routes').delete([pid, id]));
      ops.push(tx.objectStore('meta').put({ key: `lastSaved:${pid}`, value: now }));
      const proj = await tx.objectStore('projects').get(pid);
      if (proj) ops.push(tx.objectStore('projects').put({ ...proj, ...listFields(st), updatedAt: now }));
      await Promise.all([...ops, tx.done]);
      refs.forEach((v, k) => lastRefs.set(k, v));
      routeRefs.forEach((r) => lastRoutes.set(r.id, r));
      deleted.forEach((id) => lastRoutes.delete(id));
      changesSinceBackup++;
      try {
        localStorage.removeItem(EMERGENCY_KEY);
      } catch {
        /* */
      }
    }
    // Cache (ikke-kritisk): egen transaksjon
    if (cacheNames.length || elev) {
      try {
        const ctx = db.transaction('caches', 'readwrite');
        const cops: Promise<unknown>[] = [];
        for (const name of cacheNames) {
          const value = prunedCache(name, st);
          const rec: CacheRec = { projectId: pid, name, value, updatedAt: now, size: sizeOf(value) };
          cops.push(ctx.store.put(rec));
        }
        if (elev) cops.push(ctx.store.put({ projectId: '*', name: 'elevation', value: elevSnapshot(), updatedAt: now, size: 0 }));
        await Promise.all([...cops, ctx.done]);
        cacheNames.forEach((k) => lastCaches.set(k, raw[k]));
        if (elev) markElevSaved();
      } catch (e) {
        useSave.getState().set({ warning: `Hurtigbuffer (NVE/terreng/prognose) kunne ikke lagres: ${(e as Error).message}. Prosjektdata er lagret.` });
      }
    }
    retryMs = 0;
    firstDirtyAt = 0;
    const q = await estimate();
    const near = q && q.quota > 0 && q.usage / q.quota > 0.8;
    useSave.getState().set({
      state: near || useSave.getState().warning ? 'warning' : 'saved',
      lastSavedAt: critical ? now : useSave.getState().lastSavedAt,
      error: undefined,
      warning: near ? `Lagringen er ${(100 * q!.usage / q!.quota).toFixed(0)} % full. Last ned en sikkerhetskopi og rydd under Innstillinger / Lagring.` : useSave.getState().warning,
      saves: useSave.getState().saves + 1,
      projectName: st.project.name,
    });
    if (isDirty()) schedule();
  } catch (e) {
    const err = e as DOMException;
    const quota = err?.name === 'QuotaExceededError' || /quota/i.test(err?.message ?? '');
    writeEmergency(slices, changed, deleted);
    retryMs = Math.min(60000, retryMs ? retryMs * 2 : 3000);
    useSave.getState().set({
      state: 'failed',
      error: quota
        ? 'Nettleseren har ikke mer plass. Endringene er beholdt i minnet (og en nødkopi forsøkt lagret). Last ned prosjektet og rydd under Innstillinger / Lagring.'
        : `Lagring feilet: ${err?.message ?? String(e)}. Endringene er beholdt i minnet – prøver igjen om ${Math.round(retryMs / 1000)} s.`,
    });
    timer = window.setTimeout(() => void flush(), retryMs);
  }
}

function writeEmergency(slices: string[], changed: Route[], deleted: string[]) {
  try {
    const st = useStore.getState() as unknown as Record<string, unknown>;
    const prev: EmergencyJournal | null = JSON.parse(localStorage.getItem(EMERGENCY_KEY) || 'null');
    const j: EmergencyJournal = {
      projectId: useSave.getState().projectId,
      at: new Date().toISOString(),
      slices: { ...(prev?.slices ?? {}), ...Object.fromEntries(slices.map((n) => [n, pick(st, SLICES[n] as string[])])) },
      routes: [...(prev?.routes ?? []).filter((r) => !changed.some((c) => c.id === r.id)), ...changed],
      deletedRoutes: [...new Set([...(prev?.deletedRoutes ?? []), ...deleted])],
    };
    const txt = JSON.stringify(j);
    if (txt.length < 2_000_000) localStorage.setItem(EMERGENCY_KEY, txt);
  } catch {
    /* nødlagring er best-effort */
  }
}

export async function estimate(): Promise<{ usage: number; quota: number } | undefined> {
  try {
    if (!navigator.storage?.estimate) return undefined;
    const e = await navigator.storage.estimate();
    const q = { usage: e.usage ?? 0, quota: e.quota ?? 0 };
    useSave.getState().set({ quota: q });
    return q;
  } catch {
    return undefined;
  }
}

export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persisted) return null;
    let p = await navigator.storage.persisted();
    if (!p && navigator.storage.persist) p = await navigator.storage.persist();
    useSave.getState().set({ persisted: p });
    return p;
  } catch {
    return null;
  }
}

/** Les et prosjekt fra IndexedDB inn i app-tilstanden (erstatter alt lagringsbart, beholder standardverdier for nye felt). */
export async function hydrate(projectId: string) {
  hydrating = true;
  const db = await getDB();
  const [slices, routes, caches, elev] = await Promise.all([
    db.getAllFromIndex('slices', 'byProject', projectId),
    db.getAllFromIndex('routes', 'byProject', projectId),
    db.getAllFromIndex('caches', 'byProject', projectId),
    db.get('caches', ['*', 'elevation']),
  ]);
  const next: Record<string, unknown> = {};
  for (const [, keys] of Object.entries(SLICES)) for (const k of keys) next[k as string] = INITIAL[k as string];
  for (const k of CACHE_KEYS) next[k] = INITIAL[k];
  for (const s of slices) if (s.slice !== 'routeOrder' && s.value && typeof s.value === 'object') Object.assign(next, s.value);
  const order = (slices.find((s) => s.slice === 'routeOrder')?.value as string[] | undefined) ?? [];
  const byId = new Map(routes.map((r) => [r.routeId, r.value as Route]));
  next.routes = [...order.filter((id) => byId.has(id)).map((id) => byId.get(id)!), ...[...byId.keys()].filter((id) => !order.includes(id)).map((id) => byId.get(id)!)];
  for (const c of caches) next[c.name] = c.value;
  // eldre prosjekter uten prosjektopplysninger: bruk navnet fra prosjektlisten
  const hasMeta = slices.some((x) => x.slice === 'project');
  if (!hasMeta) {
    const rec = await db.get('projects', projectId);
    next.project = { ...(INITIAL.project as object), name: rec?.name ?? (INITIAL.project as { name: string }).name };
  } else next.project = { ...(INITIAL.project as object), ...(next.project as object) };
  if (!next.mainPlanId || !(next.plans as { id: string }[]).some((p) => p.id === next.mainPlanId)) next.mainPlanId = (next.plans as { id: string }[])[0]?.id;
  if (!(next.plans as { id: string }[]).some((p) => p.id === next.activePlanId)) next.activePlanId = next.mainPlanId;
  if (elev?.value) loadElevCache(elev.value as Record<string, never>);
  useStore.setState({ ...(next as Partial<State>), selectedWp: null, selectedMarker: null, selectedBarrier: null, selectedCamp: null, dailyView: null });
  const st = useStore.getState() as unknown as Record<string, unknown>;
  lastRefs.clear();
  lastRoutes.clear();
  lastCaches.clear();
  for (const keys of Object.values(SLICES)) for (const k of keys) lastRefs.set(k as string, st[k as string]);
  for (const r of useStore.getState().routes) lastRoutes.set(r.id, r);
  for (const k of CACHE_KEYS) lastCaches.set(k, st[k]);
  const missing = uncoveredKeys(st);
  if (missing.length) console.warn('Felt som ikke lagres (legg dem til i SLICES):', missing);
  const lastSavedAt = await getMeta<string>(`lastSaved:${projectId}`);
  const lastBackupAt = await getMeta<string>(`lastBackup:${projectId}`);
  useSave.getState().set({ lastSavedAt, lastBackupAt, state: 'saved', projectName: useStore.getState().project.name });
  hydrating = false;
  // prosjekter uten «project»-felt: skriv det straks (vanlig autolagring)
  if (!hasMeta) lastRefs.set('project', undefined);
  if (isDirty()) schedule();
}

let initP: Promise<void> | null = null;
/** Oppstart (kjøres bare én gang): åpne databasen, migrer fra localStorage ved behov, last aktivt prosjekt, start autolagring. */
export function initPersistence(onStatus?: (msg: string) => void): Promise<void> {
  if (!initP) initP = doInit(onStatus);
  return initP;
}

async function doInit(onStatus?: (msg: string) => void): Promise<void> {
  try {
    await getDB();
  } catch (e) {
    hydrating = false;
    useSave.getState().set({ state: 'unavailable', error: `Lagring i nettleseren er ikke tilgjengelig (${(e as Error).message}). Appen virker, men INGENTING lagres automatisk – bruk «Last ned prosjekt» jevnlig. (Privat nettlesing kan gi dette.)` });
    return;
  }
  onStatus?.('Sjekker migrering …');
  const report = await migrateFromLocalStorage(onStatus);
  if (report) useSave.getState().set({ migration: report });
  let pid = (await getMeta<string>('activeProject')) ?? 'default';
  const db = await getDB();
  if (!(await db.get('projects', pid))) {
    const any = (await db.getAll('projects'))[0];
    if (any) pid = any.id;
    else await db.put('projects', { id: pid, name: 'Finse–Rjukan 2027', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), schema: 1 });
    await setMeta('activeProject', pid);
  }
  const proj = await db.get('projects', pid);
  useSave.getState().set({ projectId: pid, projectName: proj?.name ?? pid });
  onStatus?.('Laster prosjekt …');
  await hydrate(pid);
  // nødkopi fra en mislykket lagring?
  try {
    const j: EmergencyJournal | null = JSON.parse(localStorage.getItem(EMERGENCY_KEY) || 'null');
    if (j && j.projectId === pid && (!useSave.getState().lastSavedAt || j.at > useSave.getState().lastSavedAt!)) {
      // samme innhold som allerede er lagret? Da trengs ingen gjenoppretting.
      const st = useStore.getState() as unknown as Record<string, unknown>;
      const same =
        Object.entries(j.slices).every(([n, v]) => JSON.stringify(pick(st, SLICES[n] as string[])) === JSON.stringify(v)) &&
        j.routes.every((r) => JSON.stringify(useStore.getState().routes.find((x) => x.id === r.id)) === JSON.stringify(r)) &&
        j.deletedRoutes.every((id) => !useStore.getState().routes.some((r) => r.id === id));
      if (same) localStorage.removeItem(EMERGENCY_KEY);
      else useSave.getState().set({ recovery: j });
    }
  } catch {
    /* */
  }
  useStore.subscribe(() => schedule());
  majorChange.fn = (reason) => {
    void createBackup(reason, true).then(() => pruneBackups());
  };
  // periodiske øyeblikksbilder (hvert 10. min ved endringer)
  window.setInterval(() => {
    if (changesSinceBackup > 0) {
      changesSinceBackup = 0;
      void createBackup('Automatisk øyeblikksbilde', true).then(() => pruneBackups());
    }
  }, 10 * 60000);
  // Safari/iPad: faner suspenderes uten forvarsel – lagre straks når siden skjules
  const urgent = () => {
    if (isDirty()) {
      // synkron nødkopi først (localStorage) – IndexedDB rekker ikke alltid å fullføre før Safari dreper fanen.
      // Fjernes straks den vanlige lagringen er bekreftet; ellers tilbys den ved neste oppstart.
      const st = useStore.getState();
      const d = dirtyRoutes(st);
      writeEmergency(dirtySlices(st as unknown as Record<string, unknown>), d.changed, d.deleted);
    }
    if (isDirty() || elevDirty()) void flush();
  };
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && urgent());
  window.addEventListener('pagehide', urgent);
  window.addEventListener('beforeunload', (e) => {
    if (isDirty() || saving) {
      urgent();
      e.preventDefault();
      e.returnValue = '';
    }
  });
  void requestPersistence();
  void estimate();
}

export function applyRecovery(apply: boolean) {
  const j = useSave.getState().recovery;
  if (!j) return;
  if (apply) {
    const patch: Record<string, unknown> = {};
    Object.values(j.slices).forEach((v) => Object.assign(patch, v));
    const st = useStore.getState();
    const routes = [...st.routes.filter((r) => !j.deletedRoutes.includes(r.id) && !j.routes.some((x) => x.id === r.id)), ...j.routes];
    useStore.setState({ ...(patch as Partial<State>), routes });
  } else {
    // forkastet nødkopi beholdes som backup – ingenting slettes stille
    void getDB().then((db) => db.put('backups', { id: `bk_${Date.now()}`, projectId: j.projectId, createdAt: new Date().toISOString(), reason: 'Forkastet nødkopi (ulagrede endringer)', size: JSON.stringify(j).length, data: JSON.stringify({ emergency: j }), auto: false, keep: true }));
  }
  try {
    localStorage.removeItem(EMERGENCY_KEY);
  } catch {
    /* */
  }
  useSave.getState().set({ recovery: null });
}

/** Bytt aktivt prosjekt (lagrer nåværende først). */
export async function switchProject(id: string) {
  await flush();
  await setMeta('activeProject', id);
  const db = await getDB();
  const p = await db.get('projects', id);
  useSave.getState().set({ projectId: id, projectName: p?.name ?? id });
  await hydrate(id);
}

export function _testing() {
  return { lastRefs, lastRoutes, setHydrating: (v: boolean) => (hydrating = v) };
}
