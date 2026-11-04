import { routeHash, type State } from '../../state/store';
import { kiteInput } from '../../state/sim';
import { cumulative, densify, type Sample } from '../geo';
import { cachedElevation } from '../api/kartverket';
import { finalDescent } from '../analysis/feasibility';
import { classify } from '../analysis/terrain';
import { runExpedition, type DayOutcome, type PlanContext, type PlanScenario } from '../sim/expedition';
import type { SimParams } from '../sim/physics';
import type { Route } from '../../types';

/**
 * Ren (ikke-React) beregning av plan-konteksten for en gitt rute og tilstand.
 * Brukes både av skjermen og av eksport, så en eksport alltid gir nøyaktig samme tall som appen –
 * men regnes ut fra et øyeblikksbilde, uavhengig av hva som er åpent i redigering.
 */
export interface ProfilePt extends Sample { z: number | null; src: 'DTM' | 'GPX' | 'ingen' }

export function routeProfile(route: Route, step = 250): ProfilePt[] {
  const wps = route.waypoints;
  if (wps.length < 2) return [];
  const cum = cumulative(wps);
  return densify(wps, step).map((s) => {
    const c = cachedElevation(s);
    if (c?.z != null) return { ...s, z: c.z, src: 'DTM' as const };
    const a = wps[s.seg], b = wps[s.seg + 1];
    if (a?.eleGpx != null && b?.eleGpx != null) {
      const L = cum[s.seg + 1] - cum[s.seg];
      const t = L ? (s.d - cum[s.seg]) / L : 0;
      return { ...s, z: a.eleGpx + (b.eleGpx - a.eleGpx) * t, src: 'GPX' as const };
    }
    return { ...s, z: null, src: 'ingen' as const };
  });
}

export function profileStats(profile: ProfilePt[]) {
  let up = 0, down = 0, hi = -Infinity, lo = Infinity;
  let prev: number | null = null;
  for (const p of profile) {
    if (p.z == null) continue;
    if (prev != null) {
      const dz = p.z - prev;
      if (dz > 0) up += dz;
      else down -= dz;
    }
    prev = p.z;
    hi = Math.max(hi, p.z);
    lo = Math.min(lo, p.z);
  }
  const total = profile.length ? profile[profile.length - 1].d : 0;
  return { up, down, hi: Number.isFinite(hi) ? hi : null, lo: Number.isFinite(lo) ? lo : null, total, src: profile.some((p) => p.src === 'DTM') ? 'Kartverket DTM' : profile.some((p) => p.src === 'GPX') ? 'GPX-høyder' : 'ingen høydedata' };
}

export function routeOf(st: Pick<State, 'routes' | 'activeRouteId'>, plan?: Pick<PlanScenario, 'routeId'>): Route | undefined {
  return (plan?.routeId && st.routes.find((r) => r.id === plan.routeId)) || st.routes.find((r) => r.id === st.activeRouteId) || st.routes[0];
}

export function buildPlanContext(st: State, route: Route): PlanContext | null {
  if (route.waypoints.length < 2) return null;
  const profile = routeProfile(route);
  const total = profile.length ? profile[profile.length - 1].d : 0;
  if (total <= 0) return null;
  const zAt = (d: number) => {
    let lo = 0, hi = profile.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (profile[mid].d < d) lo = mid;
      else hi = mid;
    }
    const a = profile[lo], b = profile[hi];
    if (a.z == null || b.z == null) return a.z ?? b.z ?? null;
    const t = b.d === a.d ? 0 : (d - a.d) / (b.d - a.d);
    return a.z + (b.z - a.z) * Math.max(0, Math.min(1, t));
  };
  const walkRanges: [number, number][] = [];
  const descent = finalDescent(route.waypoints, (p) => zAt(p.d));
  if (descent) walkRanges.push([descent.fromD, descent.toD]);
  st.terrain[routeHash(route)]?.samples.forEach((t) => classify(t).cls === 'bratt' && walkRanges.push([t.d - 500, t.d + 500]));
  const quiver = st.quivers.find((q) => q.id === st.activeQuiverId);
  const params: SimParams = { ...st.simParams, riderKg: st.riderKg, pulkKg: st.pulkKg, snow: st.snow };
  return {
    route: route.waypoints,
    total,
    tripDate: st.tripDate,
    params,
    quiver: quiver?.kiteIds.length ? quiver.kiteIds : ['sonic10'],
    kite: (id: string) => kiteInput(id, st),
    zAt,
    walkRanges,
    forecast: st.routeForecast?.points ?? null,
    launchMin: st.travel.launchMin,
    navMinPerHour: st.travel.navMinPerHour,
  };
}

export interface PlanRun { plan: PlanScenario; route: Route | undefined; ctx: PlanContext | null; days: DayOutcome[] }

/** Kjør ett scenario mot sin egen rute. */
export function runPlan(st: State, plan: PlanScenario): PlanRun {
  const route = routeOf(st, plan);
  const ctx = route ? buildPlanContext(st, route) : null;
  return { plan, route, ctx, days: ctx ? runExpedition(plan, ctx) : [] };
}

export interface PlanSummary {
  totalKm: number;
  days: number;
  doneDay: DayOutcome | undefined;
  remainingKm: number;
  movingH: number;
  travelH: number[];
  kites: string[];
}
export function summarize(r: PlanRun): PlanSummary {
  const last = r.days[r.days.length - 1];
  return {
    totalKm: (r.ctx?.total ?? 0) / 1000,
    days: r.plan.days.length,
    doneDay: r.days.find((d) => d.remainingKm <= 0.05),
    remainingKm: last?.remainingKm ?? 0,
    movingH: r.days.reduce((a, d) => a + d.movingH, 0),
    travelH: r.days.map((d) => Math.max(0, d.arrival - d.departure)),
    kites: r.days.map((d) => d.kiteId),
  };
}
