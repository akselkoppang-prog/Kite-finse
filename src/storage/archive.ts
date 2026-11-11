import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { APP_VERSION, versionStamp } from '../lib/version';
import { useStore, type State } from '../state/store';
import { getDB, type BlobRec } from './db';
import { projectSnapshot, createBackup } from './backup';
import { extractImages, writeStateAsProject } from './migrate';
import { CACHE_KEYS } from './slices';
import { toGpx } from '../lib/gpx';
import { scenarioFile } from '../state/expedition';
import { slug } from '../lib/project/meta';
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
  for (const m of JSON.stringify(snapshot).matchAll(/"(?:blobId|thumbId|coverBlobId|coverThumbId)":"([^"]+)"/g)) ids.add(m[1]);
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
    ...versionStamp(),
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

const README = (name: string, at: string) => `${name}
${'='.repeat(Math.min(60, name.length))}

Fullstendig prosjektkopi fra snowkite-ekspedisjonsplanleggeren (eksportert ${at}).

Slik åpner du prosjektet på en annen enhet:
  Prosjekt → «Importer prosjekt (ZIP/JSON)» → velg denne ZIP-filen.
  Prosjektet importeres som et NYTT prosjekt – ingenting eksisterende overskrives.

Innhold
  project/project.json   Kilden ved import: alle ruter, scenarioer, dagplaner, vind, kites,
                         teltplasser, punkter, vann-godkjenninger, notater og eksportvalg.
  project/metadata.json  Versjon, antall og oversikt over bilder/vedlegg.
  project/routes/        Rutene som GPX 1.1 med full koordinatpresisjon (Garmin, GPS, kartapper).
                         main-route.gpx = ruten hovedplanen bruker.
  project/scenarios/     Hvert scenario som egen fil – kan deles og importeres enkeltvis
                         (Dagplan → Scenarioer → «Importer delt scenario»).
  project/images/        Bilder (originaler) og miniatyrer (images/thumbs/).
  project/attachments/   Andre vedlegg.
  project/exports/       Ferdige eksporter (GeoJSON, CSV, Excel, PDF) hvis du valgte det.

GPX kan ikke lagre alt (bilder, statuser, scenarioer); alt dette ligger i project.json.
Formatversjon: ${FORMAT} v${VERSION}. Laget med appversjon ${APP_VERSION}.
`;

/** ZIP-arkiv med alt: prosjekt, metadata, ruter som GPX, scenarioer, bilder, vedlegg og (valgfritt) ferdige eksporter. */
export async function exportZip(projectId: string, name: string, includeCaches = false, extraExports: Record<string, Uint8Array> = {}): Promise<Blob> {
  const pj = projectJson(name, includeCaches);
  const st = useStore.getState();
  const used = referenced(pj);
  const blobs = (await projectBlobs(projectId)).filter((b) => used.has(b.id));
  const R = 'project/';
  const files: Record<string, Uint8Array> = {};
  files[`${R}project.json`] = strToU8(JSON.stringify(pj));
  const ext = (m: string) => (m.includes('png') ? 'png' : m.includes('webp') ? 'webp' : 'jpg');
  const index: Record<string, unknown> = {};
  for (const b of blobs) {
    const path = b.kind === 'bilde' ? (b.role === 'thumb' ? `images/thumbs/${b.id}.${ext(b.mime)}` : `images/${b.id}.${ext(b.mime)}`) : `attachments/${b.id}_${safe(b.name)}`;
    files[R + path] = new Uint8Array(await b.blob.arrayBuffer());
    index[b.id] = { path, name: b.name, mime: b.mime, role: b.role, parentId: b.parentId, kind: b.kind, hash: b.hash, width: b.width, height: b.height, size: b.size };
  }
  // ruter: hovedplanens rute = main-route.gpx
  const main = st.plans.find((p) => p.id === st.mainPlanId);
  const mainRoute = st.routes.find((r) => r.id === main?.routeId) ?? st.routes.find((r) => r.id === st.activeRouteId) ?? st.routes[0];
  const usedNames = new Set<string>();
  st.routes.forEach((r) => {
    let fn = r.id === mainRoute?.id ? 'main-route' : `alternative-${slug(r.name)}`;
    while (usedNames.has(fn)) fn += '-2';
    usedNames.add(fn);
    files[`${R}routes/${fn}.gpx`] = strToU8(toGpx([r], r.id === mainRoute?.id ? st.camps : [], r.id === mainRoute?.id ? st.markers : []));
  });
  // scenarioer
  const scenNames = new Set<string>();
  st.plans.forEach((p) => {
    let fn = `${p.id === st.mainPlanId ? 'hovedplan-' : ''}${slug(p.name)}`;
    while (scenNames.has(fn)) fn += '-2';
    scenNames.add(fn);
    files[`${R}scenarios/${fn}.json`] = strToU8(JSON.stringify(scenarioFile(p.id), null, 2));
  });
  for (const [k, v] of Object.entries(extraExports)) files[`${R}exports/${k}`] = v;
  if (!Object.keys(extraExports).length) files[`${R}exports/LESMEG.txt`] = strToU8('Ferdige eksporter (PDF, GeoJSON, CSV, Excel) legges her når du velger det i Eksport & deling.');
  files[`${R}attachments/LESMEG.txt`] = strToU8('Vedlegg (ikke-bilder) lagres her. Lenker ligger i project.json.');
  files[`${R}README.txt`] = strToU8(README(name, String(pj.exportedAt)));
  files[`${R}metadata.json`] = strToU8(
    JSON.stringify({
      format: FORMAT,
      version: VERSION,
      exportedAt: pj.exportedAt,
      ...versionStamp(),
      name,
      project: st.project,
      mainScenario: main?.name,
      counts: { routes: st.routes.length, scenarios: st.plans.length, waypoints: st.routes.reduce((a, r) => a + r.waypoints.length, 0), camps: st.camps.length, markers: st.markers.length, lakeOverrides: st.lakeOverrides.length, images: blobs.filter((b) => b.role === 'main').length },
      blobs: index,
      note: 'Stier i «blobs» er relative til mappen project/. Rutene i routes/ er GPX 1.1 med full koordinatpresisjon. project.json er kilden ved import.',
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
    // project.json i roten (eldre arkiv) eller i en mappe (project/project.json)
    const pjPath = files['project.json'] ? 'project.json' : Object.keys(files).filter((k) => k.endsWith('/project.json')).sort((a, b) => a.length - b.length)[0];
    if (!pjPath) throw new Error('ZIP-filen mangler project.json');
    const root = pjPath.slice(0, pjPath.length - 'project.json'.length);
    pj = JSON.parse(strFromU8(files[pjPath]));
    const metaRaw = files[`${root}metadata.json`];
    const meta = metaRaw ? JSON.parse(strFromU8(metaRaw)) : { blobs: {} };
    for (const [id, m] of Object.entries(meta.blobs ?? {}) as [string, { path: string; name: string; mime: string; role: 'main' | 'thumb'; parentId?: string; kind: 'bilde' | 'vedlegg'; hash: string; width?: number; height?: number }][]) {
      const data = files[root + m.path] ?? files[m.path];
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
  const { sanitize, persistable } = await import('./persistence');
  let converted: Record<string, unknown>;
  try {
    // valider innholdet før noe skrives (ugyldige punkter utelates, manglende felt får standardverdier)
    converted = sanitize(legacy ? await extractImages(state, pid) : state).state;
    if (mode === 'new') await writeStateAsProject(converted, pid, name);
  } catch (e) {
    // rydd bildene som ble lagt inn for et prosjekt som ikke ble opprettet
    if (mode === 'new' && images.length) {
      const tx = db.transaction('blobs', 'readwrite');
      for (const im of images) tx.store.delete(im.id);
      await tx.done.catch(() => undefined);
    }
    throw e;
  }
  const routes = (converted.routes as Route[]) ?? [];
  if (mode !== 'new') {
    await createBackup('Før import (erstatt prosjekt)', false, true);
    const patch: Record<string, unknown> = { ...converted };
    for (const k of ['focus', 'editMode', 'selectedWp', 'selectedMarker', 'selectedBarrier', 'selectedCamp', 'simPlay', 'dailyView', 'windPoints', 'format', 'version', 'exportedAt', 'appVersion', 'appBuiltAt', 'appCommit']) delete patch[k];
    useStore.setState(sanitize({ ...persistable(useStore.getState()), ...patch }).state as Partial<State>);
    useStore.getState().log('annet', `Importerte prosjektfil (${format}) og erstattet aktivt prosjekt`);
  }
  return { name, routes: routes.length, images: images.filter((i) => i.rec.role === 'main').length, format, projectId: pid };
}
