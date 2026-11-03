import { densify, destination, DIRS8, DIR_DEG, type Dir8, type LatLon } from '../geo';
import { elevations } from '../api/kartverket';

/**
 * Terrenganalyse basert på Kartverkets DTM (punkt-API). Alt her er BEREGNET fra ekte høydedata,
 * men tolkningene (rygg, dal, le, skredterreng) er forenklede heuristikker.
 */
export interface TerrainSample extends LatLon {
  d: number;
  z: number | null;
  terreng?: string;
  datakilde?: string;
  slope: number | null; // grader, lokalt (25 m)
  aspect: number | null; // retning bakken heller MOT (0=N)
  maxNearSlope: number | null; // brattest snitthelning mot punkter 150 m unna (grader)
  tpi600: number | null; // høyde minus snitt i 600 m-ring
  /** Hvor mye høyere terrenget er OPP mot vinden (600/1500 m) for hver vindretning */
  upwindRise: Record<Dir8, number | null>;
}

export interface TerrainAnalysis {
  samples: TerrainSample[];
  stepM: number;
  fetchedAt: string;
  routeHash: string;
}

const RINGS = [150, 600, 1500];

export async function analyseTerrain(route: LatLon[], stepM: number, routeHash: string, onProgress?: (f: number) => void): Promise<TerrainAnalysis> {
  const base = densify(route, stepM).filter((s, i, arr) => i === 0 || s.d - arr[i - 1].d >= stepM * 0.5 || i === arr.length - 1);
  const query: LatLon[] = [];
  const plan = base.map((s) => {
    const idx0 = query.length;
    query.push(s);
    [0, 90, 180, 270].forEach((b) => query.push(destination(s, 25, b)));
    RINGS.forEach((r) => DIRS8.forEach((d) => query.push(destination(s, r, DIR_DEG[d]))));
    return idx0;
  });
  const el = await elevations(query, onProgress);
  const z = (i: number) => el[i]?.z ?? null;
  const samples: TerrainSample[] = base.map((s, k) => {
    const i = plan[k];
    const zc = z(i);
    const [zn, ze, zs, zw] = [z(i + 1), z(i + 2), z(i + 3), z(i + 4)];
    let slope: number | null = null, aspect: number | null = null;
    if ([zn, ze, zs, zw].every((v) => v != null) && zc != null) {
      const dzdx = (ze! - zw!) / 50;
      const dzdy = (zn! - zs!) / 50;
      slope = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
      // bakken heller ned MOT retningen motsatt gradient
      aspect = ((Math.atan2(-dzdx, -dzdy) * 180) / Math.PI + 360) % 360;
    }
    const ring = (r: number) => DIRS8.map((_, j) => z(i + 5 + RINGS.indexOf(r) * 8 + j));
    const r150 = ring(150), r600 = ring(600), r1500 = ring(1500);
    let maxNearSlope: number | null = null;
    if (zc != null) {
      const sl = r150.filter((v) => v != null).map((v) => (Math.atan(Math.abs(v! - zc) / 150) * 180) / Math.PI);
      maxNearSlope = sl.length ? Math.max(...sl) : null;
    }
    const v600 = r600.filter((v) => v != null) as number[];
    const tpi600 = zc != null && v600.length ? zc - v600.reduce((a, b) => a + b, 0) / v600.length : null;
    const upwindRise = Object.fromEntries(
      DIRS8.map((d, j) => {
        const a = r600[j], b = r1500[j];
        if (zc == null || (a == null && b == null)) return [d, null];
        return [d, Math.max(a != null ? a - zc : -Infinity, b != null ? b - zc : -Infinity)];
      }),
    ) as Record<Dir8, number | null>;
    return { lat: s.lat, lon: s.lon, d: s.d, z: zc, terreng: el[i]?.terreng, datakilde: el[i]?.datakilde, slope, aspect, maxNearSlope, tpi600, upwindRise };
  });
  return { samples, stepM, fetchedAt: new Date().toISOString(), routeHash };
}

export type TerrainClass = 'bratt' | 'nær-bratt' | 'rygg' | 'dal' | 'flatt' | 'kupert' | 'ukjent';

export function classify(s: TerrainSample): { cls: TerrainClass; text: string } {
  if (s.z == null) return { cls: 'ukjent', text: 'Ingen DTM-data' };
  const near = s.maxNearSlope ?? 0;
  const loc = s.slope ?? 0;
  if (loc >= 30 || near >= 30) return { cls: 'bratt', text: `Bratt (${Math.round(Math.max(loc, near))}°) – mulig skredterreng / utløp` };
  if (loc >= 25 || near >= 25) return { cls: 'nær-bratt', text: `Nær skredterreng (${Math.round(Math.max(loc, near))}°)` };
  if ((s.tpi600 ?? 0) > 25) return { cls: 'rygg', text: `Rygg/topp (+${Math.round(s.tpi600!)} m over omgivelser) – eksponert` };
  if ((s.tpi600 ?? 0) < -25) return { cls: 'dal', text: `Dal/forsenkning (${Math.round(s.tpi600!)} m) – le, men kaldluft/fokk` };
  if (loc < 6) return { cls: 'flatt', text: `Slakt/flatt vidde (${Math.round(loc)}°)` };
  return { cls: 'kupert', text: `Kupert (${Math.round(loc)}°)` };
}
