import { useStore, type State } from '../state/store';
import { getDB, getMeta, setMeta, type BackupRec } from './db';
import { SLICES, pick } from './slices';
import { uid } from '../lib/geo';

/**
 * Sikkerhetskopier (øyeblikksbilder) av hele prosjektet unntatt cache. Bilder refereres med id og lagres
 * ikke på nytt i hver kopi. En kopi skriver ALDRI over det aktive prosjektet før du velger «Gjenopprett».
 */
export const DEFAULT_RETENTION = 10;

export function projectSnapshot(st: State = useStore.getState()) {
  const raw = st as unknown as Record<string, unknown>;
  const keys = Object.values(SLICES).flat() as string[];
  return { schema: 1, slices: pick(raw, keys), routes: st.routes };
}

async function activeProjectId(): Promise<string> {
  return (await getMeta<string>('activeProject')) ?? 'default';
}

export async function createBackup(reason: string, auto: boolean, keep = false, data?: string): Promise<BackupRec> {
  const db = await getDB();
  const projectId = await activeProjectId();
  const txt = data ?? JSON.stringify(projectSnapshot());
  const rec: BackupRec = { id: uid('bk'), projectId, createdAt: new Date().toISOString(), reason, size: new Blob([txt]).size, data: txt, auto, keep };
  await db.put('backups', rec);
  await setMeta(`lastBackup:${projectId}`, rec.createdAt);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ps = (await import('./persistence')).useSave.getState();
  ps.set({ lastBackupAt: rec.createdAt });
  return rec;
}

export async function getRetention(): Promise<number> {
  return (await getMeta<number>('backupRetention')) ?? DEFAULT_RETENTION;
}

/** Sletter de eldste AUTOMATISKE kopiene utover valgt antall. Manuelle og migreringskopier beholdes. */
export async function pruneBackups(): Promise<number> {
  const db = await getDB();
  const n = await getRetention();
  const projectId = await activeProjectId();
  const autos = (await db.getAllFromIndex('backups', 'byProject', projectId)).filter((b) => b.auto && !b.keep).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const del = autos.slice(n);
  const tx = db.transaction('backups', 'readwrite');
  for (const b of del) tx.store.delete(b.id);
  await tx.done;
  return del.length;
}

export async function listBackups(): Promise<Omit<BackupRec, 'data'>[]> {
  const db = await getDB();
  const projectId = await activeProjectId();
  const all = await db.getAllFromIndex('backups', 'byProject', projectId);
  return all.map(({ data: _d, ...rest }) => rest).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getBackupData(id: string): Promise<string | undefined> {
  const db = await getDB();
  return (await db.get('backups', id))?.data;
}

export async function deleteBackup(id: string) {
  const db = await getDB();
  await db.delete('backups', id);
}

/** Gjenoppretter en kopi: lagrer først nåværende tilstand som egen kopi, deretter erstattes prosjektdataene. */
export async function restoreBackup(id: string): Promise<void> {
  const data = await getBackupData(id);
  if (!data) throw new Error('Fant ikke kopien');
  const parsed = JSON.parse(data);
  if (parsed.emergency) {
    const j = parsed.emergency;
    const patch: Record<string, unknown> = {};
    Object.values(j.slices as Record<string, Record<string, unknown>>).forEach((v) => Object.assign(patch, v));
    await createBackup('Før gjenoppretting av nødkopi', false, true);
    const st = useStore.getState();
    useStore.setState({ ...(patch as Partial<State>), routes: [...st.routes.filter((r) => !j.routes.some((x: { id: string }) => x.id === r.id)), ...j.routes] });
  } else {
    if (!parsed.slices || !Array.isArray(parsed.routes)) throw new Error('Kopien har ukjent format');
    await createBackup('Før gjenoppretting', false, true);
    useStore.setState({ ...(parsed.slices as Partial<State>), routes: parsed.routes });
  }
  useStore.getState().log('annet', 'Gjenopprettet sikkerhetskopi');
  const { flush } = await import('./persistence');
  await flush();
}

/** Alle blob-id-er som fortsatt er i bruk (aktivt prosjekt + alle kopier). */
export async function referencedBlobIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  const scan = (txt: string) => {
    for (const m of txt.matchAll(/"(?:blobId|thumbId|coverBlobId|coverThumbId)":"([^"]+)"/g)) ids.add(m[1]);
  };
  scan(JSON.stringify(projectSnapshot()));
  const db = await getDB();
  // alle prosjekter (også ikke-aktive) og alle kopier
  for (const s of await db.getAll('slices')) scan(JSON.stringify(s.value));
  for (const r of await db.getAll('routes')) scan(JSON.stringify(r.value));
  let cur = await db.transaction('backups').store.openCursor();
  while (cur) {
    scan(cur.value.data);
    cur = await cur.continue();
  }
  return ids;
}

/** Fjern et bilde fra lagringen hvis ingenting (prosjekt eller kopi) bruker det lenger. */
export async function releaseImage(blobId: string): Promise<boolean> {
  const { flush } = await import('./persistence');
  await flush();
  const used = await referencedBlobIds();
  if (used.has(blobId)) return false;
  const { deleteImage } = await import('./blobs');
  await deleteImage(blobId);
  return true;
}
