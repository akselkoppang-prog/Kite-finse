import { getDB, getMeta, setMeta, sizeOf } from './db';
import { SLICES, CACHE_KEYS, pick } from './slices';
import { dataUrlToBlob, putImage } from './blobs';
import { uid } from '../lib/geo';
import type { Attachment, Route } from '../types';

export const LEGACY_KEY = 'kite.plan.v1';
const LEGACY_ELEV = 'kite.elevCache.v1';

export interface MigrationReport {
  status: 'verified' | 'started' | 'failed' | 'none';
  at: string;
  originalBytes: number;
  /** Størrelse per felt i den gamle planen – forklarer hvorfor den ble for stor */
  bySize: { key: string; bytes: number }[];
  imagesConverted: number;
  imageBytesBefore: number;
  imageBytesAfter: number;
  counts: Record<string, number>;
  error?: string;
}

type Obj = Record<string, unknown>;

/** Går gjennom vedlegg og flytter data:-URL-bilder til Blob-lageret. Returnerer ny verdi (muterer ikke). */
export async function extractImages<T>(value: T, projectId: string, stats = { n: 0, before: 0, after: 0 }): Promise<T> {
  const fixAtt = async (a: Attachment): Promise<Attachment> => {
    if (a.kind === 'bilde' && typeof a.href === 'string' && a.href.startsWith('data:')) {
      const blob = dataUrlToBlob(a.href);
      stats.before += a.href.length * 2;
      const img = await putImage(blob, a.name || 'bilde.jpg', projectId);
      stats.after += img.size;
      stats.n++;
      return { ...a, href: '', blobId: img.blobId, thumbId: img.thumbId, size: img.size, width: img.width, height: img.height };
    }
    return a;
  };
  const walk = async (v: unknown): Promise<unknown> => {
    if (Array.isArray(v)) return Promise.all(v.map(walk));
    if (v && typeof v === 'object') {
      const o = v as Obj;
      const out: Obj = {};
      for (const [k, x] of Object.entries(o)) {
        if (k === 'attachments' && Array.isArray(x)) out[k] = await Promise.all((x as Attachment[]).map(fixAtt));
        else if (k === 'hydro' || k === 'lakes' || k === 'terrain' || k === 'routeForecast') out[k] = x; // store, uten vedlegg
        else out[k] = await walk(x);
      }
      return out;
    }
    return v;
  };
  return (await walk(value)) as T;
}

function counts(st: Obj): Record<string, number> {
  const routes = (st.routes as Route[] | undefined) ?? [];
  return {
    ruter: routes.length,
    rutepunkter: routes.reduce((a, r) => a + r.waypoints.length, 0),
    markører: ((st.markers as unknown[]) ?? []).length,
    teltplasser: ((st.camps as unknown[]) ?? []).length,
    overstyringer: ((st.lakeOverrides as unknown[]) ?? []).length,
    quivers: ((st.quivers as unknown[]) ?? []).length,
    soner: ((st.zones as unknown[]) ?? []).length,
    historikk: ((st.history as unknown[]) ?? []).length,
  };
}

/** Skriv en hel tilstand (gammelt format) som prosjekt i IndexedDB og verifiser. */
export async function writeStateAsProject(state: Obj, projectId: string, name: string): Promise<void> {
  const db = await getDB();
  const now = new Date().toISOString();
  const tx = db.transaction(['projects', 'slices', 'routes', 'caches'], 'readwrite');
  const ops: Promise<unknown>[] = [];
  ops.push(tx.objectStore('projects').put({ id: projectId, name, createdAt: now, updatedAt: now, schema: 1 }));
  for (const [n, keys] of Object.entries(SLICES)) {
    const value = pick(state, keys as string[]);
    ops.push(tx.objectStore('slices').put({ projectId, slice: n, value, updatedAt: now, size: sizeOf(value) }));
  }
  const routes = (state.routes as Route[]) ?? [];
  ops.push(tx.objectStore('slices').put({ projectId, slice: 'routeOrder', value: routes.map((r) => r.id), updatedAt: now, size: 0 }));
  for (const r of routes) ops.push(tx.objectStore('routes').put({ projectId, routeId: r.id, value: r, updatedAt: now, size: sizeOf(r) }));
  for (const c of CACHE_KEYS) if (state[c] != null) ops.push(tx.objectStore('caches').put({ projectId, name: c, value: state[c], updatedAt: now, size: sizeOf(state[c]) }));
  await Promise.all([...ops, tx.done]);
}

export async function verifyProject(projectId: string, expected: Obj): Promise<string | null> {
  const db = await getDB();
  const slices = await db.getAllFromIndex('slices', 'byProject', projectId);
  const routes = await db.getAllFromIndex('routes', 'byProject', projectId);
  const got: Obj = {};
  slices.forEach((s) => s.slice !== 'routeOrder' && Object.assign(got, s.value as Obj));
  got.routes = routes.map((r) => r.value);
  const a = counts(expected), b = counts(got);
  for (const k of Object.keys(a)) if (a[k] !== b[k]) return `Antall ${k} stemmer ikke (${a[k]} ≠ ${b[k]})`;
  // stikkprøve: alle koordinater i alle ruter identiske
  const coords = (rs: Route[]) => rs.map((r) => r.waypoints.map((w) => `${w.lat},${w.lon}`).join(';')).sort().join('|');
  if (coords((expected.routes as Route[]) ?? []) !== coords(got.routes as Route[])) return 'Rutekoordinater stemmer ikke';
  for (const k of ['tripDate', 'activeQuiverId', 'activeRouteId']) if (JSON.stringify(expected[k]) !== JSON.stringify(got[k])) return `Feltet ${k} stemmer ikke`;
  return null;
}

/**
 * Engangsmigrering fra localStorage («kite.plan.v1»):
 * 1 les → 2 valider → 3 backup av originalen (beskyttet) → 4 skriv til IndexedDB → 5 les tilbake og verifiser
 * → 6 marker «verified». Originalen i localStorage slettes IKKE (du kan gjøre det selv i Lagring-siden).
 * Avbrutt migrering (status «started») kjøres trygt på nytt fordi originalen er urørt.
 */
export async function migrateFromLocalStorage(onStatus?: (m: string) => void): Promise<MigrationReport | null> {
  const prev = await getMeta<MigrationReport>('migration');
  if (prev && (prev.status === 'verified' || prev.status === 'none')) {
    await migrateElevation();
    return prev;
  }
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEGACY_KEY);
  } catch {
    raw = null;
  }
  const now = new Date().toISOString();
  if (!raw) {
    const rep: MigrationReport = { status: 'none', at: now, originalBytes: 0, bySize: [], imagesConverted: 0, imageBytesBefore: 0, imageBytesAfter: 0, counts: {} };
    await setMeta('migration', rep);
    await migrateElevation();
    return rep;
  }
  const report: MigrationReport = { status: 'started', at: now, originalBytes: raw.length * 2, bySize: [], imagesConverted: 0, imageBytesBefore: 0, imageBytesAfter: 0, counts: {} };
  try {
    onStatus?.('Leser gammel lagring …');
    const parsed = JSON.parse(raw);
    const state: Obj = parsed?.state ?? parsed;
    if (!state || !Array.isArray(state.routes)) throw new Error('Gammel plan har ukjent format (mangler ruter)');
    report.bySize = Object.entries(state)
      .map(([key, v]) => ({ key, bytes: JSON.stringify(v ?? null).length * 2 }))
      .sort((a, b) => b.bytes - a.bytes);
    report.counts = counts(state);
    await setMeta('migration', report);
    onStatus?.('Lager sikkerhetskopi av originalen …');
    const db = await getDB();
    const existing = (await db.getAll('backups')).find((b) => b.reason.startsWith('Original localStorage'));
    if (!existing) await db.put('backups', { id: uid('bk'), projectId: 'default', createdAt: now, reason: 'Original localStorage-data (før migrering)', size: raw.length * 2, data: raw, auto: false, keep: true });
    onStatus?.('Flytter bilder til egen lagring …');
    const stats = { n: 0, before: 0, after: 0 };
    const converted = await extractImages(state, 'default', stats);
    report.imagesConverted = stats.n;
    report.imageBytesBefore = stats.before;
    report.imageBytesAfter = stats.after;
    onStatus?.('Skriver prosjektet til IndexedDB …');
    await writeStateAsProject(converted, 'default', 'Finse–Rjukan 2027');
    onStatus?.('Verifiserer …');
    const err = await verifyProject('default', converted);
    if (err) throw new Error(`Verifisering feilet: ${err}`);
    report.status = 'verified';
    report.at = new Date().toISOString();
    await setMeta('migration', report);
    await setMeta('activeProject', 'default');
    await migrateElevation();
    return report;
  } catch (e) {
    report.status = 'failed';
    report.error = (e as Error).message;
    await setMeta('migration', report);
    return report;
  }
}

/** Høydecachen (ikke brukerdata) flyttes og fjernes fra localStorage når den er bekreftet skrevet. */
async function migrateElevation() {
  try {
    const raw = localStorage.getItem(LEGACY_ELEV);
    if (!raw) return;
    const db = await getDB();
    const cur = await db.get('caches', ['*', 'elevation']);
    const merged = { ...JSON.parse(raw), ...((cur?.value as Obj) ?? {}) };
    await db.put('caches', { projectId: '*', name: 'elevation', value: merged, updatedAt: new Date().toISOString(), size: raw.length });
    if (await db.get('caches', ['*', 'elevation'])) localStorage.removeItem(LEGACY_ELEV);
  } catch {
    /* cache – ikke kritisk */
  }
}

export function legacyPresent(): number {
  try {
    return (localStorage.getItem(LEGACY_KEY)?.length ?? 0) * 2;
  } catch {
    return 0;
  }
}
