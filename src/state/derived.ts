import { useEffect, useMemo, useState } from 'react';
import { useStore, routeHash, type State } from './store';
import { cumulative, densify, type Sample } from '../lib/geo';
import { elevations, cachedElevation } from '../lib/api/kartverket';
import { buildBarriers, findCrossings, elevationBandWarnings, type Barrier, type Crossing } from '../lib/analysis/barriers';
import { windLegs, summarize } from '../lib/analysis/wind';
import type { Route, Status } from '../types';
import { evaluateCrossings, overrideState } from '../lib/analysis/overrides';
import { legTimes, dayTotals, daysNeeded, equalBreaks, finalDescent, type DayResult } from '../lib/analysis/feasibility';
import { classify } from '../lib/analysis/terrain';
import { sunDay, hourOf, addDays, type SunDay } from '../lib/sun';
import { pointAt as pAt } from '../lib/geo';
import type { Feature } from 'geojson';

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
    const gpx = (s: Sample): number | null => {
      const i = s.seg;
      const a = wps[i], b = wps[i + 1];
      if (a?.eleGpx != null && b?.eleGpx != null) {
        const L = cum[i + 1] - cum[i];
        const t = L ? (s.d - cum[i]) / L : 0;
        return a.eleGpx + (b.eleGpx - a.eleGpx) * t;
      }
      return null;
    };
    const z = samples.map((s) => dtm[`${s.d}`] ?? null);
    // ikke bland DTM og GPX punkt for punkt (gir falske topper mens DTM lastes)
    const useDtm = z.filter((v) => v != null).length >= samples.length * 0.9;
    return samples.map((s, i) => {
      if (useDtm && z[i] != null) return { ...s, z: z[i], src: 'DTM' as const };
      const g = gpx(s);
      if (g != null) return { ...s, z: g, src: 'GPX' as const };
      return { ...s, z: useDtm ? z[i] : null, src: z[i] != null ? ('DTM' as const) : ('ingen' as const) };
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

/** Barrierer + kryssinger for en rute (ren funksjon – brukes også av eksport). */
export function computeBarrierCheck(st: Pick<State, 'hydro' | 'lakes' | 'zones' | 'userVerifiedLakes' | 'lakeOverrides' | 'tripDate'>, route: Route | undefined) {
  const { hydro, zones, userVerifiedLakes: userVerified, lakeOverrides: overrides, tripDate } = st;
  const lakeEntry = st.lakes[routeHash(route)];
  const barriers: Barrier[] = buildBarriers(hydro?.reservoirs ?? [], lakeEntry?.lakes ?? [], zones, userVerified);
  const raw: Crossing[] = route ? findCrossings(route.waypoints, barriers) : [];
  const crossings = evaluateCrossings(raw, overrides, { routeId: route?.id ?? '', tripDate, dams: (hydro?.dams ?? []) as Feature[] });
  const bandWarnings = route ? elevationBandWarnings(route.waypoints) : [];
  const waterChecked = !!hydro && !!lakeEntry;
  const blocking = crossings.filter((c) => c.blocking);
  const userApproved = crossings.filter((c) => c.label === 'BRUKERGODKJENT');
  const activeOverrideKeys = new Set(overrides.filter((o) => overrideState(o, tripDate) === 'aktiv').map((o) => o.barrierKey));
  let status: Status = 'GRÅ';
  if (waterChecked) status = blocking.length ? 'RØD' : crossings.length || bandWarnings.length ? 'GUL' : 'GRØNN';
  else if (blocking.length || bandWarnings.length) status = 'RØD';
  return { barriers, crossings, blocking, userApproved, activeOverrideKeys, bandWarnings, waterChecked, status, hydroAt: hydro?.fetchedAt, lakesAt: lakeEntry?.fetchedAt };
}
export type BarrierCheck = ReturnType<typeof computeBarrierCheck>;

/** Barrierer + kryssinger for aktiv rute, inkl. dine overstyringer (whitelist). */
export function useBarrierCheck(route: Route | undefined) {
  const hydro = useStore((s) => s.hydro);
  const lakesAll = useStore((s) => s.lakes);
  const zones = useStore((s) => s.zones);
  const userVerified = useStore((s) => s.userVerifiedLakes);
  const overrides = useStore((s) => s.lakeOverrides);
  const tripDate = useStore((s) => s.tripDate);
  const hash = routeHash(route);
  const lakeEntry = lakesAll[hash];
  return useMemo(() => computeBarrierCheck({ hydro, lakes: lakesAll, zones, userVerifiedLakes: userVerified, lakeOverrides: overrides, tripDate }, route), [hash, hydro, lakeEntry, zones, userVerified, overrides, tripDate]); // eslint-disable-line react-hooks/exhaustive-deps
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

export interface PlannedDay extends DayResult {
  date: string;
  sun: SunDay;
  startH: number;
  endH: number;
  daylightLeftH: number | null; // solnedgang − ankomst
  civilLeftH: number | null; // borgerlig skumring − ankomst
  windScore: number;
}

/** Dagsplan for aktiv rute: dagsskift, reisetid (snowkite-modell), dagslys per dag og sted. */
export function useDayPlan(route: Route | undefined) {
  const s = useStore();
  const { profile, stats } = useProfile(route);
  const terrain = useTerrain(route);
  const hash = routeHash(route);
  const windFrom = s.windFrom;
  const sc = s.scenarios.find((x) => x.id === s.scenarioId) ?? s.scenarios[0];
  return useMemo(() => {
    const empty = { days: [] as PlannedDay[], breaks: [] as number[], total: 0, descent: null as ReturnType<typeof finalDescent>, walkRanges: [] as [number, number][], scenarioDays: [] as { id: string; days: number; totalDays: number }[], pulkFactor: 1 };
    if (!route || route.waypoints.length < 2) return empty;
    const total = stats.total || 0;
    const zAt = (p: { d: number }) => {
      const q = profile.reduce((b, x) => (Math.abs(x.d - p.d) < Math.abs(b.d - p.d) ? x : b), profile[0]);
      return q?.z ?? null;
    };
    const descent = profile.length ? finalDescent(route.waypoints, zAt) : null;
    const walkRanges: [number, number][] = [];
    if (descent) walkRanges.push([descent.fromD, descent.toD]);
    terrain?.samples.forEach((t) => {
      if (classify(t).cls === 'bratt') walkRanges.push([t.d - 500, t.d + 500]);
    });
    const legs = windLegs(route.waypoints, windFrom, 500, terrain?.samples);
    const pulkFactor = Math.sqrt(110 / (s.riderKg + s.pulkKg));
    const lt = legTimes(legs, s.travel, sc, walkRanges, pulkFactor);
    const n = Math.max(1, s.tripDays);
    const breaks = route.dayBreaks && route.dayBreaks.length === n - 1 ? route.dayBreaks : equalBreaks(total, n);
    const edges = [0, ...breaks, total];
    const cum = cumulative(route.waypoints);
    const sunFor = (i: number, d: number) => sunDay(addDays(s.tripDate, i), pAt(route.waypoints, cum, d));
    const availH = (day: number) => {
      const sun = sunFor(day - 1, total * Math.min(1, (day - 0.5) / n));
      const start = Math.max(s.travel.startHour, hourOf(sun.civilDawn) ?? s.travel.startHour);
      const end = (hourOf(sun.civilDusk) ?? 18) - s.travel.campSetupH;
      return Math.max(1, Math.min(s.travel.maxMovingH + sc.downtimeH, end - start));
    };
    const days: PlannedDay[] = edges.slice(0, -1).map((d0, i) => {
      const d1 = edges[i + 1];
      const r = dayTotals(lt, d0, d1, i + 1, s.travel, sc);
      const sun = sunFor(i, (d0 + d1) / 2);
      const startH = Math.max(s.travel.startHour, hourOf(sun.civilDawn) ?? s.travel.startHour);
      const endH = startH + r.totalH;
      const ss = hourOf(sun.sunset), cd = hourOf(sun.civilDusk);
      const dl = legs.filter((l) => l.d0 >= d0 - 1 && l.d1 <= d1 + 1);
      const wl = dl.reduce((a, l) => a + (l.d1 - l.d0), 0) || 1;
      return { ...r, date: addDays(s.tripDate, i), sun, startH, endH, daylightLeftH: ss != null ? ss - endH : null, civilLeftH: cd != null ? cd - endH : null, windScore: dl.reduce((a, l) => a + l.score * (l.d1 - l.d0), 0) / wl };
    });
    const scenarioDays = s.scenarios.map((x) => {
      const ltx = legTimes(legs, s.travel, x, walkRanges, pulkFactor);
      const dn = daysNeeded(ltx, s.travel, x, availH);
      return { id: x.id, days: dn.days, totalDays: dn.days + x.restDays };
    });
    return { days, breaks, total, descent, walkRanges, scenarioDays, pulkFactor };
  }, [hash, profile, stats.total, terrain, windFrom, sc, s.travel, s.scenarios, s.tripDays, s.tripDate, s.riderKg, s.pulkKg, route?.dayBreaks]); // eslint-disable-line react-hooks/exhaustive-deps
}
