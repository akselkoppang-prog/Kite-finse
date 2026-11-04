import { fetchJson, pool, validLatLon } from './http';
import type { LatLon } from '../geo';
import type { Place } from '../../types';
import type { PlaceQuery } from '../../data/places';

const SSR = 'https://ws.geonorge.no/stedsnavn/v1';
const HOYDE = 'https://ws.geonorge.no/hoydedata/v1/punkt';

/** Grovt planområde Finse–Rjukan (lon/lat). Brukes kun til å filtrere søketreff. */
export const AREA = { minLat: 59.7, maxLat: 60.75, minLon: 7.1, maxLon: 8.95 };

interface SsrNavn {
  skrivemåte: string;
  navneobjekttype: string;
  representasjonspunkt: { øst: number; nord: number; koordsys?: number };
  kommuner?: { kommunenavn: string }[];
}

export interface PlaceCandidate extends LatLon {
  name: string;
  type: string;
  kommune?: string;
}

export async function searchPlace(q: string): Promise<PlaceCandidate[]> {
  const url = `${SSR}/navn?sok=${encodeURIComponent(q)}&fuzzy=false&utkoordsys=4258&treffPerSide=50&side=1`;
  const json = await fetchJson<{ navn: SsrNavn[] }>('kv-stedsnavn', url, undefined, { cacheMs: 86400000, nature: 'kartdata' });
  if (!Array.isArray(json.navn)) throw new Error('Uventet svar fra stedsnavn-API (mangler «navn»)');
  return (json.navn ?? [])
    .filter((n) => n.representasjonspunkt && Number.isFinite(n.representasjonspunkt.nord) && Number.isFinite(n.representasjonspunkt.øst))
    .map((n) => ({
      name: n.skrivemåte,
      type: n.navneobjekttype,
      kommune: n.kommuner?.map((k) => k.kommunenavn).join(', '),
      lat: n.representasjonspunkt.nord,
      lon: n.representasjonspunkt.øst,
    }))
    .filter((c) => c.lat >= AREA.minLat && c.lat <= AREA.maxLat && c.lon >= AREA.minLon && c.lon <= AREA.maxLon);
}

export function pickCandidate(q: PlaceQuery, cands: PlaceCandidate[]): PlaceCandidate | undefined {
  for (const t of q.preferTypes) {
    const c = cands.find((c) => c.type.toLowerCase() === t.toLowerCase());
    if (c) return c;
  }
  return cands[0];
}

export async function resolvePlace(q: PlaceQuery): Promise<{ place?: Place; candidates: PlaceCandidate[] }> {
  const cands = await searchPlace(q.query);
  const c = pickCandidate(q, cands);
  if (!c) return { candidates: cands };
  return {
    candidates: cands,
    place: {
      key: q.key,
      name: c.name,
      type: c.type,
      kommune: c.kommune,
      lat: c.lat,
      lon: c.lon,
      role: q.role,
      source: 'Kartverket stedsnavn-API (SSR)',
      fetchedAt: new Date().toISOString(),
    },
  };
}

/** Nærmeste stedsnavn innen radius (m). */
export async function nearestName(p: LatLon, radius = 2500): Promise<{ name: string; type: string; dist?: number } | undefined> {
  if (!validLatLon(p.lat, p.lon)) throw new Error('Ugyldig koordinat');
  const url = `${SSR}/punkt?nord=${p.lat}&ost=${p.lon}&koordsys=4258&radius=${radius}&utkoordsys=4258&treffPerSide=20&side=1`;
  const json = await fetchJson<{ navn: (SsrNavn & { meterFraPunkt?: number; stedsnavn?: { skrivemåte: string }[] })[] }>('kv-stedsnavn', url);
  const n = json.navn?.[0];
  if (!n) return undefined;
  const name = n.skrivemåte ?? n.stedsnavn?.[0]?.skrivemåte ?? '?';
  return { name, type: n.navneobjekttype, dist: n.meterFraPunkt };
}

// ---------- Høyde (DTM) ----------

export interface ElevPoint extends LatLon {
  z: number | null;
  terreng?: string;
  datakilde?: string;
}

// Høydecachen lagres i IndexedDB (caches-lageret) av lagringsmodulen – ikke lenger i localStorage.
const elevCache: Record<string, ElevPoint> = {};
let elevChanged = false;
export function loadElevCache(v: Record<string, ElevPoint>) {
  Object.assign(elevCache, v);
}
export const elevSnapshot = () => elevCache;
export const elevDirty = () => elevChanged;
export const markElevSaved = () => {
  elevChanged = false;
};
export function clearElevCache() {
  Object.keys(elevCache).forEach((k) => delete elevCache[k]);
  elevChanged = true;
}
const MAX_CACHE = 30000;
export const elevCacheWarning = '';
function persistCache() {
  const keys = Object.keys(elevCache);
  if (keys.length > MAX_CACHE) keys.slice(0, keys.length - MAX_CACHE).forEach((k) => delete elevCache[k]); // eldste ut
  elevChanged = true;
}
const ckey = (p: LatLon) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;

export function cachedElevation(p: LatLon): ElevPoint | undefined {
  return elevCache[ckey(p)];
}

interface HoydePunkt { x: number; y: number; z: number | null; terreng?: string; datakilde?: string }

let batchSupported: boolean | null = null;

async function fetchBatch(pts: LatLon[]): Promise<ElevPoint[]> {
  if (batchSupported !== false) {
    try {
      const arr = JSON.stringify(pts.map((p) => [Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))]));
      const url = `${HOYDE}?koordsys=4258&punkter=${encodeURIComponent(arr)}&geojson=false`;
      const json = await fetchJson<{ punkter: HoydePunkt[] }>('kv-hoyde', url, undefined, { nature: 'kartdata', retries: 1 });
      if (!Array.isArray(json.punkter) || json.punkter.length !== pts.length) throw new Error('uventet svar');
      batchSupported = true;
      return json.punkter.map((r, i) => ({ ...pts[i], z: r.z, terreng: r.terreng, datakilde: r.datakilde }));
    } catch (e) {
      if (batchSupported === true) throw e;
      batchSupported = false;
    }
  }
  return pool(pts, 4, async (p) => {
    const url = `${HOYDE}?koordsys=4258&nord=${p.lat}&ost=${p.lon}&geojson=false`;
    const json = await fetchJson<{ punkter: HoydePunkt[] }>('kv-hoyde', url, undefined, { nature: 'kartdata' });
    const r = json.punkter?.[0];
    return { ...p, z: r?.z ?? null, terreng: r?.terreng, datakilde: r?.datakilde };
  });
}

/** Pågående oppslag per punkt – hindrer at flere komponenter henter de samme punktene samtidig. */
const pending = new Map<string, Promise<ElevPoint>>();

/** Henter DTM-høyder (med cache og deling av pågående kall). onProgress gir 0–1. */
export async function elevations(pts: LatLon[], onProgress?: (f: number) => void): Promise<ElevPoint[]> {
  const bad = pts.find((p) => !validLatLon(p.lat, p.lon));
  if (bad) throw new Error(`Ugyldig koordinat ${bad.lat}, ${bad.lon}`);
  const missing = pts.filter((p) => !elevCache[ckey(p)] && !pending.has(ckey(p)));
  const uniq = Array.from(new Map(missing.map((p) => [ckey(p), p])).values());
  const chunks: LatLon[][] = [];
  for (let i = 0; i < uniq.length; i += 50) chunks.push(uniq.slice(i, i + 50));
  let done = 0;
  const run = pool(chunks, 3, async (c) => {
    const res = await fetchBatch(c);
    res.forEach((r) => (elevCache[ckey(r)] = r));
    persistCache();
    done++;
    onProgress?.(done / Math.max(1, chunks.length));
    return res;
  });
  // registrer hvert punkt som pågående
  chunks.forEach((c, ci) =>
    c.forEach((p, pi) => {
      const k = ckey(p);
      const pr = run.then((all) => all[ci][pi]);
      pending.set(k, pr);
      pr.catch(() => undefined).finally(() => pending.delete(k));
    }),
  );
  await run;
  // vent også på punkter som andre kall henter
  await Promise.all(pts.map((p) => pending.get(ckey(p))).filter(Boolean));
  onProgress?.(1);
  return pts.map((p) => elevCache[ckey(p)] ?? { ...p, z: null });
}
