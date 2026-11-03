import { cumulative, haversine, pointAt, type LatLon } from './geo';
import type { Route } from '../types';

export interface Subgoal extends LatLon {
  idx: number;
  d: number;
  name: string;
  /** navngitt waypoint det er snappet til, ellers interpolert */
  snapped: boolean;
}

/** Delmål ca. hver `target` m (10–15 km). Snapper til navngitte stopp innen 3 km. */
export function subgoals(route: Route | undefined, target = 12500): Subgoal[] {
  if (!route || route.waypoints.length < 2) return [];
  const wps = route.waypoints;
  const cum = cumulative(wps);
  const total = cum[cum.length - 1];
  const n = Math.max(1, Math.round(total / target));
  const step = total / n;
  const out: Subgoal[] = [{ ...wps[0], idx: 0, d: 0, name: wps[0].name ?? 'Start', snapped: true }];
  for (let k = 1; k < n; k++) {
    const d = step * k;
    const named = wps.map((w, i) => ({ w, d: cum[i] })).filter((x) => x.w.name && Math.abs(x.d - d) < 3000).sort((a, b) => Math.abs(a.d - d) - Math.abs(b.d - d))[0];
    if (named) out.push({ lat: named.w.lat, lon: named.w.lon, idx: k, d: named.d, name: named.w.name!, snapped: true });
    else out.push({ ...pointAt(wps, cum, d), idx: k, d, name: `Delmål ${k}`, snapped: false });
  }
  const last = wps[wps.length - 1];
  out.push({ ...last, idx: n, d: total, name: last.name ?? 'Mål', snapped: true });
  return out;
}

export function nearestPlace<T extends LatLon & { name: string }>(p: LatLon, places: T[]): { place: T; km: number } | undefined {
  return places.map((pl) => ({ place: pl, km: haversine(p, pl) / 1000 })).sort((a, b) => a.km - b.km)[0];
}
