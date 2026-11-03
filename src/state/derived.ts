import { useEffect, useMemo, useState } from 'react';
import { useStore, routeHash } from './store';
import { cumulative, densify, type Sample } from '../lib/geo';
import { elevations, cachedElevation } from '../lib/api/kartverket';
import { buildBarriers, findCrossings, elevationBandWarnings, type Barrier, type Crossing } from '../lib/analysis/barriers';
import { windLegs, summarize } from '../lib/analysis/wind';
import type { Route, Status } from '../types';

export interface ProfilePoint extends Sample {
  z: number | null;
  src: 'DTM' | 'GPX' | 'ingen';
}

/** Høydeprofil: DTM (Kartverket) når tilgjengelig, ellers interpolert GPX-høyde (Garmin). */
export function useProfile(route: Route | undefined, step = 250) {
  const [dtm, setDtm] = useState<Record<string, number | null>>({});
  const [state, setState] = useState<{ loading: boolean; progress: number; error?: string }>({ loading: false, progress: 0 });
  const hash = routeHash(route);
  const samples = useMemo(() => (route ? densify(route.waypoints, step) : []), [hash, step]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!samples.length) return;
    const pre: Record<string, number | null> = {};
    let missing = 0;
    samples.forEach((s) => {
      const c = cachedElevation(s);
      if (c) pre[`${s.d}`] = c.z;
      else missing++;
    });
    setDtm(pre);
    if (!missing) return;
    let cancelled = false;
    setState({ loading: true, progress: 0 });
    elevations(samples, (f) => !cancelled && setState({ loading: true, progress: f }))
      .then((res) => {
        if (cancelled) return;
        const m: Record<string, number | null> = {};
        res.forEach((r, i) => (m[`${samples[i].d}`] = r.z));
        setDtm(m);
        setState({ loading: false, progress: 1 });
      })
      .catch((e) => !cancelled && setState({ loading: false, progress: 0, error: String(e.message ?? e) }));
    return () => {
      cancelled = true;
    };
  }, [samples]);

  const profile: ProfilePoint[] = useMemo(() => {
    if (!route) return [];
    const wps = route.waypoints;
    const cum = cumulative(wps);
    return samples.map((s) => {
      const z = dtm[`${s.d}`];
      if (z != null) return { ...s, z, src: 'DTM' as const };
      // interpoler GPX-høyde
      const i = s.seg;
      const a = wps[i], b = wps[i + 1];
      if (a?.eleGpx != null && b?.eleGpx != null) {
        const L = cum[i + 1] - cum[i];
        const t = L ? (s.d - cum[i]) / L : 0;
        return { ...s, z: a.eleGpx + (b.eleGpx - a.eleGpx) * t, src: 'GPX' as const };
      }
      return { ...s, z: null, src: 'ingen' as const };
    });
  }, [samples, dtm, route]);

  const stats = useMemo(() => {
    const zs = profile.filter((p) => p.z != null) as (ProfilePoint & { z: number })[];
    let up = 0, down = 0;
    for (let i = 1; i < zs.length; i++) {
      const dz = zs[i].z - zs[i - 1].z;
      if (dz > 0) up += dz;
      else down -= dz;
    }
    const hi = zs.reduce((m, p) => (p.z > (m?.z ?? -Infinity) ? p : m), undefined as (typeof zs)[number] | undefined);
    const lo = zs.reduce((m, p) => (p.z < (m?.z ?? Infinity) ? p : m), undefined as (typeof zs)[number] | undefined);
    const total = profile.length ? profile[profile.length - 1].d : 0;
    const src = profile.some((p) => p.src === 'DTM') ? (profile.every((p) => p.src === 'DTM') ? 'DTM' : 'blandet') : profile.some((p) => p.src === 'GPX') ? 'GPX' : 'ingen';
    return { up, down, hi, lo, total, src };
  }, [profile]);

  return { profile, stats, ...state };
}

/** Barrierer + kryssinger for aktiv rute. */
export function useBarrierCheck(route: Route | undefined) {
  const hydro = useStore((s) => s.hydro);
  const lakesAll = useStore((s) => s.lakes);
  const zones = useStore((s) => s.zones);
  const userVerified = useStore((s) => s.userVerifiedLakes);
  const hash = routeHash(route);
  const lakeEntry = lakesAll[hash];
  return useMemo(() => {
    const barriers: Barrier[] = buildBarriers(hydro?.reservoirs ?? [], lakeEntry?.lakes ?? [], zones, userVerified);
    const crossings: Crossing[] = route ? findCrossings(route.waypoints, barriers) : [];
    const bandWarnings = route ? elevationBandWarnings(route.waypoints) : [];
    const waterChecked = !!hydro && !!lakeEntry;
    const blocking = crossings.filter((c) => c.barrier.status === 'RØD');
    let status: Status = 'GRÅ';
    if (waterChecked) status = blocking.length ? 'RØD' : crossings.length || bandWarnings.length ? 'GUL' : 'GRØNN';
    else if (blocking.length || bandWarnings.length) status = 'RØD';
    return { barriers, crossings, blocking, bandWarnings, waterChecked, status, hydroAt: hydro?.fetchedAt, lakesAt: lakeEntry?.fetchedAt };
  }, [hash, hydro, lakeEntry, zones, userVerified]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useActiveRoute() {
  const routes = useStore((s) => s.routes);
  const id = useStore((s) => s.activeRouteId);
  return routes.find((r) => r.id === id);
}

export function useTerrain(route: Route | undefined) {
  const terrain = useStore((s) => s.terrain);
  return route ? terrain[routeHash(route)] : undefined;
}

export function useWind(route: Route | undefined) {
  const windFrom = useStore((s) => s.windFrom);
  const terrain = useTerrain(route);
  const hash = routeHash(route);
  return useMemo(() => {
    const legs = route ? windLegs(route.waypoints, windFrom, 1000, terrain?.samples) : [];
    return { legs, summary: summarize(legs) };
  }, [hash, windFrom, terrain]); // eslint-disable-line react-hooks/exhaustive-deps
}
