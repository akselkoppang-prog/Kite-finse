import { routeHash, type State } from '../../state/store';
import { kiteInput } from '../../state/sim';
import { cumulative, densify, nearestOnRoute, type Sample } from '../geo';
import { gearTotals, foodSummary, newFoodPlan } from '../project/model';
import type { RouteForecastPoint } from '../sim/wind';
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
  const samples = densify(wps, step);
  const gpx = (s: Sample): number | null => {
    const a = wps[s.seg], b = wps[s.seg + 1];
    if (a?.eleGpx == null || b?.eleGpx == null) return a?.eleGpx ?? null;
    const L = cum[s.seg + 1] - cum[s.seg];
    const t = L ? (s.d - cum[s.seg]) / L : 0;
    return a.eleGpx + (b.eleGpx - a.eleGpx) * t;
  };
  const dtm = samples.map((s) => cachedElevation(s)?.z ?? null);
  // Bland ikke kilder punkt for punkt (gir falske topper): DTM bare når nesten hele ruten har DTM.
  const coverage = dtm.filter((z) => z != null).length / Math.max(1, samples.length);
  const useDtm = coverage >= 0.9;
  return samples.map((s, i) => {
    if (useDtm && dtm[i] != null) return { ...s, z: dtm[i], src: 'DTM' as const };
    if (useDtm) {
      // hull i DTM: interpoler mellom nærmeste DTM-punkter
      let a = i - 1, b = i + 1;
      while (a >= 0 && dtm[a] == null) a--;
      while (b < dtm.length && dtm[b] == null) b++;
      if (a >= 0 && b < dtm.length) return { ...s, z: dtm[a]! + ((dtm[b]! - dtm[a]!) * (i - a)) / (b - a), src: 'DTM' as const };
    }
    const g = gpx(s);
    return g != null ? { ...s, z: g, src: 'GPX' as const } : { ...s, z: null, src: 'ingen' as const };
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

/** Hvilken prognose et scenario bruker: valgt leverandør hvis den er hentet for denne ruten, ellers MET (eldre data). */
export function forecastFor(st: State, route: Route, plan?: Pick<PlanScenario, 'weatherSource'>): { points: RouteForecastPoint[] | null; provider: string; fetchedAt?: string; updatedAt?: string } {
  const id = plan?.weatherSource ?? 'met';
  const w = st.weather?.[id];
  if (w && w.routeKey === routeHash(route) && w.points.length) return { points: w.points, provider: id, fetchedAt: w.fetchedAt, updatedAt: w.updatedAt };
  if (id === 'met' && st.routeForecast?.points.length) return { points: st.routeForecast.points, provider: 'met', fetchedAt: st.routeForecast.fetchedAt };
  return { points: null, provider: id };
}

/** Utstyrslisten et scenario bruker. */
export const gearListOf = (st: Pick<State, 'gearLists'>, plan?: Pick<PlanScenario, 'gearListId'>) => st.gearLists.find((g) => g.id === plan?.gearListId) ?? st.gearLists[0];

/** Overnattinger med påfyll (dag-indekser etter hvilke dere fyller på mat). */
export const resupplyDays = (st: Pick<State, 'camps'>, plan: PlanScenario) => plan.days.map((d, i) => (d.campId && st.camps.find((c) => c.id === d.campId)?.resupply ? i + 1 : 0)).filter(Boolean);

/** Laveste temperatur vi regner med: prognosen langs ruten hvis den finnes, ellers modellens temperatur. */
export function minTempFor(st: State, route: Route | undefined, plan: PlanScenario): number {
  const fc = route ? forecastFor(st, route, plan).points : null;
  const start = Date.parse(`${plan.tripDate ?? st.tripDate}T00:00:00Z`), end = start + plan.days.length * 86400000;
  const temps = (fc ?? []).flatMap((p) => p.fc.rows.filter((r) => { const t = Date.parse(r.time); return t >= start && t < end && r.temp != null; }).map((r) => r.temp!));
  return temps.length ? Math.min(...temps) : st.simParams.tempC;
}

/** Mat for scenarioet (alle tall per scenario). */
export function scenarioFood(st: State, plan: PlanScenario, route = routeOf(st, plan)) {
  const fp = plan.food ?? newFoodPlan(plan.days.length);
  const people = Math.max(1, st.team.length);
  const bodyKg = st.team.length ? st.team.reduce((a, m) => a + (m.weightKg ?? st.riderKg), 0) / st.team.length : st.riderKg;
  return foodSummary(fp, plan.days.length, people, st.meals, st.foods, minTempFor(st, route, plan), resupplyDays(st, plan), bodyKg);
}

/** Pulkvekt per dag: utstyr (når listen har vekter) + gjenværende mat og brensel. Ellers din manuelle pulkvekt. */
export function loadModel(st: State, plan: PlanScenario, route = routeOf(st, plan)) {
  const gear = gearTotals(gearListOf(st, plan));
  // Bare når du selv har lagt inn vekter, erstatter listen din manuelle pulkvekt (typiske vekter alene endrer ingenting).
  const explicitKg = (gearListOf(st, plan)?.items ?? []).reduce((acc, g) => acc + (g.kg ?? 0) * Math.max(0, g.qty), 0);
  if (explicitKg < 1 || gear.pulkKg < 1) return { source: 'manuell' as const, gear, food: null, dayLoad: (_i: number) => st.pulkKg, bodyKg: st.simParams.extraKg };
  const food = scenarioFood(st, plan, route);
  const fuelKgPerDay = (food.fuelL * 0.75) / Math.max(1, food.totalDays);
  const people = food.people;
  // gruppens felles last fordeles på antall pulker (én per person)
  const dayLoad = (i: number) => (gear.pulkKg + (food.remainingKgByDay[i] ?? 0) + fuelKgPerDay * Math.max(0, food.totalDays - i)) / people;
  return { source: 'utstyrsliste' as const, gear, food, dayLoad, bodyKg: gear.bodyKg / people };
}

export function buildPlanContext(st: State, route: Route, plan?: PlanScenario): PlanContext | null {
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
  const lm = plan ? loadModel(st, plan, route) : null;
  const params: SimParams = { ...st.simParams, riderKg: st.riderKg, pulkKg: st.pulkKg, snow: st.snow, extraKg: lm?.source === 'utstyrsliste' ? lm.bodyKg : st.simParams.extraKg };
  const crossings = (st.crossings ?? []).map((c) => ({ c, n: nearestOnRoute(route.waypoints, c) })).filter((x) => x.n.dist < 400).map((x) => ({ c: x.c, d: x.n.d }));
  return {
    route: route.waypoints,
    total,
    tripDate: plan?.tripDate ?? st.tripDate,
    crossings,
    dayLoad: lm ? lm.dayLoad : undefined,
    fatiguePct: st.travel.fatiguePctPerDay,
    params,
    quiver: quiver?.kiteIds.length ? quiver.kiteIds : ['sonic10'],
    kite: (id: string) => kiteInput(id, st),
    zAt,
    walkRanges,
    forecast: forecastFor(st, route, plan).points,
    launchMin: st.travel.launchMin,
    navMinPerHour: st.travel.navMinPerHour,
  };
}

export interface PlanRun { plan: PlanScenario; route: Route | undefined; ctx: PlanContext | null; days: DayOutcome[] }

/** Kjør ett scenario mot sin egen rute. */
export function runPlan(st: State, plan: PlanScenario): PlanRun {
  const route = routeOf(st, plan);
  const ctx = route ? buildPlanContext(st, route, plan) : null;
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
