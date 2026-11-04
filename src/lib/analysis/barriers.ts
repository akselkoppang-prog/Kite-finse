import * as turf from '@turf/turf';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import { densify, haversine, cumulative, type LatLon } from '../geo';
import type { Status, Waypoint, Zone } from '../../types';
import { matchWater, NOT_VERIFIED, WATERS } from '../../data/waters';
import { featureName, findNumeric, type PolyFeature } from '../api/nve';
import { uid } from '../geo';

export interface Barrier {
  /** Stabil nøkkel (NVE-nummer/navn) – brukes av overstyringer */
  id: string;
  kind: 'magasin' | 'innsjø' | 'sone';
  name: string;
  status: Status;
  label: string;
  hrv?: number;
  lrv?: number;
  source: string;
  feature: Feature<Polygon | MultiPolygon>;
  props?: Record<string, unknown>;
}

export interface Crossing {
  barrier: Barrier;
  fromD: number;
  toD: number;
  lengthM: number;
  entry: LatLon;
  exit: LatLon;
}

/** Bygger barriere-liste fra NVE-magasiner, NVE-innsjøer og egne soner. */
export function buildBarriers(reservoirs: PolyFeature[], lakes: PolyFeature[], zones: Zone[], userVerified: Record<string, string>): Barrier[] {
  const out: Barrier[] = [];
  reservoirs.forEach((f, i) => {
    const nm = featureName(f.properties) ?? `NVE-magasin #${i + 1}`;
    const reg = matchWater(nm);
    const rid = findNumeric(f.properties, /^(magasinnr|magnr|objectid|fid)$/i);
    out.push({
      id: `res_${rid ?? nm}`,
      kind: 'magasin',
      name: nm,
      status: 'RØD',
      label: 'Regulert magasin (NVE) – KRYSSING FORBUDT I PLANEN',
      hrv: findNumeric(f.properties, /^(hrv|hoyesteregulertevannstand|hrv_moh)$/i) ?? findNumeric(f.properties, /h(ø|o)y.*vannst|hrv/i) ?? reg?.hrv,
      lrv: findNumeric(f.properties, /^(lrv|lavesteregulertevannstand|lrv_moh)$/i) ?? findNumeric(f.properties, /lav.*vannst|lrv/i) ?? reg?.lrv,
      source: 'NVE Vannkraft – magasin (hentet i nettleser)',
      feature: f,
      props: f.properties,
    });
  });
  lakes.forEach((f, i) => {
    // Er innsjøen del av et NVE-magasin?
    const nm = featureName(f.properties) ?? `Navnløs innsjø (NVE #${i + 1})`;
    const regByGeom = reservoirs.some((r) => safeIntersects(r, f));
    const reg = matchWater(nm);
    const key = lakeKey(f, nm);
    const userNote = userVerified[key];
    let status: Status = 'RØD';
    let label = NOT_VERIFIED;
    if (regByGeom || reg?.regulated === 'ja') label = 'Regulert (NVE-magasin / publisert kilde) – KRYSSING FORBUDT I PLANEN';
    else if (userNote) {
      status = 'GUL';
      label = `Bruker-dokumentert uregulert: «${userNote}» – kryssing fortsatt på eget ansvar (isforhold ukjent)`;
    }
    out.push({
      id: key,
      kind: 'innsjø',
      name: nm,
      status,
      label,
      hrv: reg?.hrv,
      lrv: reg?.lrv,
      source: regByGeom ? 'NVE Innsjødatabase ∩ NVE magasin' : reg ? `NVE Innsjødatabase + ${reg.source}` : 'NVE Innsjødatabase – reguleringsstatus ikke dokumentert',
      feature: f,
      props: f.properties,
    });
  });
  zones.forEach((z) => {
    if (z.ring.length < 3) return;
    const ring = [...z.ring, z.ring[0]].map((p) => [p.lon, p.lat]);
    out.push({
      id: z.id,
      kind: 'sone',
      name: z.name,
      status: z.kind === 'forbudt' ? 'RØD' : 'GUL',
      label: z.kind === 'forbudt' ? 'Egen forbudt sone' : 'Egen usikker sone',
      source: 'Manuelt markert',
      feature: turf.polygon([ring]),
    });
  });
  return out;
}

export function lakeKey(f: PolyFeature, nm: string): string {
  const id = findNumeric(f.properties, /^(vatnlnr|innsjonr|objectid|lnr)$/i);
  return `lake_${id ?? nm}`;
}

function safeIntersects(a: Feature<Polygon | MultiPolygon>, b: Feature<Polygon | MultiPolygon>) {
  try {
    return turf.booleanIntersects(a, b);
  } catch {
    return false;
  }
}

/** Finner kryssinger ved å sample ruten hver 40 m og teste punkt-i-polygon. */
export function findCrossings(route: LatLon[], barriers: Barrier[]): Crossing[] {
  if (route.length < 2) return [];
  const samples = densify(route, 40);
  const out: Crossing[] = [];
  for (const b of barriers) {
    const bb = turf.bbox(b.feature);
    let inside = false;
    let start = 0;
    let entry: LatLon = samples[0];
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const inBox = s.lon >= bb[0] && s.lon <= bb[2] && s.lat >= bb[1] && s.lat <= bb[3];
      const isIn = inBox && turf.booleanPointInPolygon([s.lon, s.lat], b.feature);
      if (isIn && !inside) {
        inside = true;
        start = s.d;
        entry = s;
      } else if (!isIn && inside) {
        inside = false;
        out.push({ barrier: b, fromD: start, toD: s.d, lengthM: s.d - start, entry, exit: s });
      }
    }
    if (inside) {
      const s = samples[samples.length - 1];
      out.push({ barrier: b, fromD: start, toD: s.d, lengthM: s.d - start, entry, exit: s });
    }
  }
  return out.sort((a, b) => a.fromD - b.fromD);
}

/**
 * Indikasjon uten geometri: GPX-høyde innenfor publisert reguleringsintervall (±3 m) i
 * et grovt søkevindu rundt Mår-reguleringen. Dette er et VARSEL, ikke et bevis.
 */
export function elevationBandWarnings(wps: Waypoint[]): { wp: Waypoint; index: number; water: string; band: string }[] {
  const out: { wp: Waypoint; index: number; water: string; band: string }[] = [];
  wps.forEach((w, i) => {
    if (w.eleGpx == null) return;
    if (w.lat < 59.9 || w.lat > 60.25 || w.lon < 7.9 || w.lon > 8.55) return; // grovt søkevindu
    for (const r of WATERS) {
      if (r.hrv == null || r.lrv == null) continue;
      if (w.eleGpx >= r.lrv - 3 && w.eleGpx <= r.hrv + 3) {
        out.push({ wp: w, index: i, water: r.name, band: `${r.lrv}–${r.hrv} moh` });
        break;
      }
    }
  });
  return out;
}

/**
 * Lager en omvei rundt en barriere: konveks hull av polygonet med buffer, og velger korteste side.
 * Resultatet er en BEREGNET skisse som må terrengvurderes – den tar ikke hensyn til bratthet,
 * andre vann eller elver.
 */
export function detourAround(wps: Waypoint[], barrier: Barrier, bufferM = 300): Waypoint[] | null {
  const pts: LatLon[] = wps;
  const cum = cumulative(pts);
  let hull: Feature<Polygon> | null = null;
  try {
    const buf = turf.buffer(barrier.feature, bufferM / 1000, { units: 'kilometers' });
    if (!buf) return null;
    hull = turf.convex(buf as Feature<Polygon | MultiPolygon>) as Feature<Polygon> | null;
  } catch {
    return null;
  }
  if (!hull) return null;
  const samples = densify(pts, 40);
  const inHull = samples.map((s) => turf.booleanPointInPolygon([s.lon, s.lat], hull!));
  const first = inHull.indexOf(true);
  if (first < 0) return null;
  let last = first;
  while (last + 1 < inHull.length && inHull[last + 1]) last++;
  if (first === 0 || last === samples.length - 1) return null; // start/slutt inne i barrieren
  const A = samples[first - 1];
  const B = samples[last + 1];
  const ring = hull.geometry.coordinates[0].slice(0, -1).map(([lon, lat]) => ({ lat, lon }));
  const nearest = (p: LatLon) => ring.reduce((bi, q, i) => (haversine(p, q) < haversine(p, ring[bi]) ? i : bi), 0);
  const ia = nearest(A);
  const ib = nearest(B);
  const walk = (dir: 1 | -1) => {
    const path: LatLon[] = [];
    let i = ia;
    for (let k = 0; k <= ring.length; k++) {
      path.push(ring[i]);
      if (i === ib) break;
      i = (i + dir + ring.length) % ring.length;
    }
    return path;
  };
  const len = (p: LatLon[]) => [A, ...p, B].reduce((s, q, i, arr) => (i ? s + haversine(arr[i - 1], q) : 0), 0);
  const p1 = walk(1);
  const p2 = walk(-1);
  const path = len(p1) <= len(p2) ? p1 : p2;
  const mk = (p: LatLon, name?: string): Waypoint => ({
    id: uid('wp'),
    lat: p.lat,
    lon: p.lon,
    kind: 'omvei',
    name,
    source: `Auto-omvei rundt «${barrier.name}» (konvekst hull + ${bufferM} m buffer)`,
    dataKind: 'beregnet',
    note: 'Beregnet skisse – ikke terrengvurdert. Kontroller bratthet, elver og andre vann.',
  });
  const before = wps.filter((_, i) => cum[i] < A.d);
  const after = wps.filter((_, i) => cum[i] > B.d);
  return [...before, mk(A), ...path.map((p, k) => mk(p, k === 0 ? `Omvei ${barrier.name}` : undefined)), mk(B), ...after];
}
