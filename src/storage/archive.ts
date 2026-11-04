import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { useStore, type State } from '../state/store';
import { getDB, type BlobRec } from './db';
import { projectSnapshot, createBackup } from './backup';
import { extractImages, writeStateAsProject } from './migrate';
import { CACHE_KEYS } from './slices';
import { toGpx } from '../lib/gpx';
import { uid } from '../lib/geo';
import type { Route } from '../types';

/**
 * Prosjektformat v3 (versjonert):
 *  { format: 'kite-finse-rjukan-plan', version: 3, schema: 1, exportedAt, name, slices, routes, caches?, images? }
 * ZIP: project.json · metadata.json · routes/*.gpx · images/<id>.jpg · images/thumbs/<id>.jpg · attachments/
 * Eldre filer (v1/v2 fra «Lagre plan» / «Last ned hele prosjektet», med base64-bilder) kan importeres.
 */
export const FORMAT = 'kite-finse-rjukan-plan';
export const VERSION = 3;

async function projectBlobs(projectId: string): Promise<BlobRec[]> {
  const db = await getDB();
  return db.getAllFromIndex('blobs', 'byProject', projectId);
}

function referenced(snapshot: unknown): Set<string> {
  const ids = new Set<string>();
  for (const m of JSON.stringify(snapshot).matchAll(/"(?:blobId|thumbId)":"([^"]+)"/g)) ids.add(m[1]);
  return ids;
}

async function b64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(s: string, mime: string): Blob {
  const bin = atob(s);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new Blob([a], { type: mime });
}

function projectJson(name: string, includeCaches: boolean) {
  const st = useStore.getState() as unknown as Record<string, unknown>;
  const snap = projectSnapshot();
  return {
    format: FORMAT,
    version: VERSION,
    schema: 1,
    exportedAt: new Date().toISOString(),
    name,
    slices: snap.slices,
    routes: snap.routes,
    caches: includeCaches ? Object.fromEntries(CACHE_KEYS.map((k) => [k, st[k]])) : undefined,
  };
}

/** JSON-eksport. Med includeImages legges bildene ved som base64 (større fil, men alt i én fil). */
export async function exportJson(projectId: string, name: string, opts: { includeImages: boolean; includeCaches: boolean }): Promise<string> {
  const pj: Record<string, unknown> = projectJson(name, opts.includeCaches);
  if (opts.includeImages) {
    const used = referenced(pj);
    const imgs: Record<string, unknown> = {};
    for (const b of await projectBlobs(projectId)) if (used.has(b.id)) imgs[b.id] = { name: b.name, mime: b.mime, role: b.role, parentId: b.parentId, hash: b.hash, width: b.width, height: b.height, data: await b64(b.blob) };
    pj.images = imgs;
  }
  return JSON.stringify(pj);
}

const safe = (s: string) => s.replace(/[^\wæøåÆØÅ.-]+/g, '_').slice(0, 60);

/** ZIP-arkiv med alt: prosjekt, metadata, ruter som GPX, bilder og vedlegg. */
export async function exportZip(projectId: string, name: string, includeCaches = false): Promise<Blob> {
  const pj = projectJson(name, includeCaches);
  const st = useStore.getState();
  const used = referenced(pj);
  const blobs = (await projectBlobs(projectId)).filter((b) => used.has(b.id));
  const files: Record<string, Uint8Array> = {};
  files['project.json'] = strToU8(JSON.stringify(pj));
  const ext = (m: string) => (m.includes('png') ? 'png' : m.includes('webp') ? 'webp' : 'jpg');
  const index: Record<string, unknown> = {};
  for (const b of blobs) {
    const path = b.kind === 'bilde' ? (b.role === 'thumb' ? `images/thumbs/${b.id}.${ext(b.mime)}` : `images/${b.id}.${ext(b.mime)}`) : `attachments/${b.id}_${safe(b.name)}`;
    files[path] = new Uint8Array(await b.blob.arrayBuffer());
    index[b.id] = { path, name: b.name, mime: b.mime, role: b.role, parentId: b.parentId, kind: b.kind, hash: b.hash, width: b.width, height: b.height, size: b.size };
  }
  st.routes.forEach((r, i) => (files[`routes/${String(i + 1).padStart(2, '0')}_${safe(r.name)}.gpx`] = strToU8(toGpx([r], i === 0 ? st.camps : [], i === 0 ? st.markers : []))));
  files['attachments/LESMEG.txt'] = strToU8('Vedlegg (ikke-bilder) lagres her. Lenker ligger i project.json.');
  files['metadata.json'] = strToU8(
    JSON.stringify({
      format: FORMAT,
      version: VERSION,
      exportedAt: pj.exportedAt,
      name,
      counts: { routes: st.routes.length, waypoints: st.routes.reduce((a, r) => a + r.waypoints.length, 0), camps: st.camps.length, markers: st.markers.length, lakeOverrides: st.lakeOverrides.length, images: blobs.filter((b) => b.role === 'main').length },
      blobs: index,
      note: 'Rutene i routes/ er GPX 1.1 med full koordinatpresisjon (7 desimaler). project.json er kilden ved import.',
    }, null, 2),
  );
  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped], { type: 'application/zip' });
}

interface ImportResult { name: string; routes: number; images: number; format: string }

/** Les fil (ZIP eller JSON, alle versjoner) til tilstand + bilder. */
async function readFile(file: File | Blob): Promise<{ state: Record<string, unknown>; images: { id: string; rec: Omit<BlobRec, 'projectId'> }[]; legacy: boolean; name: string; format: string }> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  const images: { id: string; rec: Omit<BlobRec, 'projectId'> }[] = [];
  let pj: Record<string, unknown>;
  if (isZip) {
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
    if (!files['project.json']) throw new Error('ZIP-filen mangler project.json');
    pj = JSON.parse(strFromU8(files['project.json']));
    const meta = files['metadata.json'] ? JSON.parse(strFromU8(files['metadata.json'])) : { blobs: {} };
    for (const [id, m] of Object.entries(meta.blobs ?? {}) as [string, { path: string; name: string; mime: string; role: 'main' | 'thumb'; parentId?: string; kind: 'bilde' | 'vedlegg'; hash: string; width?: number; height?: number }][]) {
      const data = files[m.path];
      if (!data) continue;
      const blob = new Blob([data], { type: m.mime });
      images.push({ id, rec: { id, kind: m.kind, role: m.role, parentId: m.parentId, name: m.name, mime: m.mime, size: blob.size, hash: m.hash, blob, width: m.width, height: m.height, createdAt: new Date().toISOString() } });
    }
  } else {
    pj = JSON.parse(await file.text());
    for (const [id, m] of Object.entries((pj.images as Record<string, { name: string; mime: string; role: 'main' | 'thumb'; parentId?: string; hash: string; data: string; width?: number; height?: number }>) ?? {})) {
      const blob = fromB64(m.data, m.mime);
      images.push({ id, rec: { id, kind: 'bilde', role: m.role, parentId: m.parentId, name: m.name, mime: m.mime, size: blob.size, hash: m.hash, blob, width: m.width, height: m.height, createdAt: new Date().toISOString() } });
    }
  }
  if (pj.format === FORMAT && pj.version === VERSION) {
    const state = { ...(pj.slices as Record<string, unknown>), routes: pj.routes, ...((pj.caches as Record<string, unknown>) ?? {}) };
    return { state, images, legacy: false, name: String(pj.name ?? 'Importert prosjekt'), format: 'v3' };
  }
  // v1/v2 (eldre eksport) eller rå localStorage-format {state: …}
  const st = ((pj.state as Record<string, unknown>) ?? pj) as Record<string, unknown>;
  if (!Array.isArray(st.routes)) throw new Error('Ukjent filformat (fant ingen ruter)');
  return { state: st, images, legacy: true, name: 'Importert prosjekt', format: pj.format === FORMAT ? `v${pj.version}` : 'localStorage-dump' };
}

/**
 * Importer et prosjekt. «new» lager et nytt prosjekt (det aktive røres ikke). «replace» tar sikkerhetskopi
 * av det aktive først og erstatter deretter innholdet.
 */
export async function importProject(file: File | Blob, mode: 'new' | 'replace', currentProjectId: string): Promise<ImportResult & { projectId: string }> {
  const { state, images, legacy, name, format } = await readFile(file);
  const db = await getDB();
  const pid = mode === 'new' ? uid('prj') : currentProjectId;
  // bilder først (samme id-er som i prosjektdataene)
  if (images.length) {
    const tx = db.transaction('blobs', 'readwrite');
    for (const im of images) tx.store.put({ ...im.rec, projectId: pid });
    await tx.done;
  }
  const converted = legacy ? await extractImages(state, pid) : state;
  const routes = (converted.routes as Route[]) ?? [];
  if (mode === 'new') {
    await writeStateAsProject(converted, pid, name);
  } else {
    await createBackup('Før import (erstatt prosjekt)', false, true);
    const patch: Record<string, unknown> = { ...converted };
    for (const k of ['focus', 'editMode', 'selectedWp', 'selectedMarker', 'selectedBarrier', 'selectedCamp', 'simPlay', 'dailyView', 'windPoints', 'format', 'version', 'exportedAt']) delete patch[k];
    useStore.setState(patch as Partial<State>);
    useStore.getState().log('annet', `Importerte prosjektfil (${format}) og erstattet aktivt prosjekt`);
  }
  return { name, routes: routes.length, images: images.filter((i) => i.rec.role === 'main').length, format, projectId: pid };
}
