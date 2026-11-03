import { fetchJson, pool } from './http';
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
  const json = await fetchJson<{ navn: SsrNavn[] }>('kv-stedsnavn', url);
  return (json.navn ?? [])
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

const CACHE_KEY = 'kite.elevCache.v1';
const elevCache: Record<string, ElevPoint> = (() => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
})();
let saveTimer: number | undefined;
function persistCache() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(elevCache));
    } catch {
      /* full lagring – ignorer */
    }
  }, 500);
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
      const json = await fetchJson<{ punkter: HoydePunkt[] }>('kv-hoyde', url);
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
    const json = await fetchJson<{ punkter: HoydePunkt[] }>('kv-hoyde', url);
    const r = json.punkter?.[0];
    return { ...p, z: r?.z ?? null, terreng: r?.terreng, datakilde: r?.datakilde };
  });
}

/** Henter DTM-høyder (med cache). onProgress gir 0–1. */
export async function elevations(pts: LatLon[], onProgress?: (f: number) => void): Promise<ElevPoint[]> {
  const missing = pts.filter((p) => !elevCache[ckey(p)]);
  const uniq = Array.from(new Map(missing.map((p) => [ckey(p), p])).values());
  const chunks: LatLon[][] = [];
  for (let i = 0; i < uniq.length; i += 50) chunks.push(uniq.slice(i, i + 50));
  let done = 0;
  await pool(chunks, 3, async (c) => {
    const res = await fetchBatch(c);
    res.forEach((r) => (elevCache[ckey(r)] = r));
    persistCache();
    done++;
    onProgress?.(done / chunks.length);
  });
  onProgress?.(1);
  return pts.map((p) => elevCache[ckey(p)] ?? { ...p, z: null });
}
