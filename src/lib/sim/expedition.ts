import { simulate, type SimResult, type WindProvider } from './route';
import { forecastProvider, manualProvider, type RouteForecastPoint } from './wind';
import type { KiteInput, SimParams } from './physics';
import { addDays, hourOf, sunDay } from '../sun';
import { cumulative, pointAt, type LatLon } from '../geo';
import { uid } from '../geo';

/**
 * Dag-for-dag ekspedisjonsplan. Hver dag har sin egen vind, ÉN kite (eller «auto»), avreise, aktive timer,
 * pauser og forventet fart. Dagene henger sammen: neste dag starter der forrige endte. Manuelle stopp
 * beholdes alltid; «auto»-dager fordeler seg selv på nytt når en tidligere dag endres.
 */
export type WindMode = 'manuell' | 'prognose' | 'blandet';

export interface DayWind {
  dir: number;
  avg: number;
  min: number;
  max: number;
  gust: number;
  variability: number; // 0–0,6
  favorableH: number; // timer med denne vinden fra avreise (deretter faller den til minimum)
}

export interface DayPlan {
  id: string;
  departure: number; // klokkeslett (desimaltimer)
  activeH: number;
  breakH: number;
  speedKmh: number; // forventet fart når du kiter (over bakken)
  kiteId: string; // 'auto' = beste av kitene du tar med
  windMode: WindMode;
  wind: DayWind;
  mix: { speedFactor: number; dirOffset: number };
  target: { mode: 'auto' | 'km' | 'stopp'; km?: number; stopD?: number };
  campId?: string;
  note?: string;
}

export interface PlanScenario { id: string; name: string; days: DayPlan[]; createdAt: string; updatedAt: string }

export const DAY_COLORS = ['#f97316', '#22d3ee', '#a3e635', '#f472b6', '#facc15', '#a78bfa', '#34d399'];

export function newDay(p: Partial<DayPlan> = {}): DayPlan {
  return {
    id: uid('day'),
    departure: 8,
    activeH: 5,
    breakH: 1,
    speedKmh: 22,
    kiteId: 'auto',
    windMode: 'manuell',
    wind: { dir: 225, avg: 8, min: 5, max: 11, gust: 13, variability: 0.2, favorableH: 12 },
    mix: { speedFactor: 1, dirOffset: 0 },
    target: { mode: 'auto' },
    ...p,
  };
}

/** Eksempel-plan (hypotetisk vind – ikke prognose og ikke anbefaling). */
export function examplePlan(): PlanScenario {
  const now = new Date().toISOString();
  return {
    id: 'plan-main',
    name: 'Hovedplan',
    createdAt: now,
    updatedAt: now,
    days: [
      newDay({ wind: { dir: 225, avg: 8, min: 5, max: 11, gust: 13, variability: 0.2, favorableH: 12 } }),
      newDay({ wind: { dir: 0, avg: 6, min: 3, max: 9, gust: 11, variability: 0.25, favorableH: 12 } }),
      newDay({ wind: { dir: 90, avg: 10, min: 7, max: 14, gust: 17, variability: 0.25, favorableH: 12 } }),
    ],
  };
}

export interface PlanContext {
  route: LatLon[];
  total: number;
  tripDate: string;
  params: SimParams;
  quiver: string[];
  kite: (id: string) => KiteInput;
  zAt: (d: number) => number | null;
  walkRanges: [number, number][];
  forecast: RouteForecastPoint[] | null;
  launchMin: number;
  navMinPerHour: number;
}

export interface DayOutcome {
  day: number;
  date: string;
  startD: number;
  endD: number; // brukt sluttpunkt (sim eller manuelt)
  simEndD: number; // hvor langt modellen kom
  targetD: number | null;
  reachedTarget: boolean;
  forcedStop: boolean; // manuelt stopp lenger enn modellen rakk
  kiteId: string;
  kiteAuto: boolean;
  theoreticalKm: number; // fart × aktive timer
  sailedKm: number;
  progressKm: number;
  movingH: number;
  departure: number;
  arrival: number; // klokkeslett
  sunrise: number | null;
  sunset: number | null;
  civilDusk: number | null;
  daylightLeftH: number | null;
  rangeKm: [number, number]; // usikkerhet i fremdrift (pessimistisk–optimistisk)
  rangeArrival: [number, number];
  reason: string;
  upwindShare: number;
  underShare: number;
  overShare: number;
  windSource: string;
  remainingKm: number;
  issues: string[];
  result: SimResult;
}

function provider(d: DayPlan, ctx: PlanContext, scale = 1): { wind: WindProvider; source: string } {
  const w = d.wind;
  const hourly = w.favorableH < 24 ? [
    { hour: d.departure - 1, speed: w.avg * scale, gust: w.gust * scale, dir: w.dir },
    { hour: d.departure + w.favorableH, speed: w.min * scale, gust: Math.max(w.min, w.min * 1.3) * scale, dir: w.dir },
  ] : [];
  const manual = manualProvider({ dir: w.dir, avg: w.avg * scale, min: w.min * scale, max: w.max * scale, gust: w.gust * scale, tempC: ctx.params.tempC, hourly });
  if (d.windMode === 'manuell' || !ctx.forecast?.length) return { wind: manual, source: d.windMode === 'manuell' ? 'manuelt scenario' : 'manuelt (ingen prognose for datoen)' };
  const fc = forecastProvider(ctx.forecast, manual);
  if (d.windMode === 'prognose') return { wind: (t, p, x) => { const s = fc(t, p, x); return { ...s, speed: s.speed * scale, gust: s.gust * scale }; }, source: 'MET-prognose' };
  return {
    wind: (t, p, x) => {
      const s = fc(t, p, x);
      return { ...s, speed: s.speed * d.mix.speedFactor * scale, gust: s.gust * d.mix.speedFactor * scale, min: s.min != null ? s.min * d.mix.speedFactor : undefined, max: s.max != null ? s.max * d.mix.speedFactor : undefined, dirFrom: (s.dirFrom + d.mix.dirOffset + 360) % 360, source: s.source === 'prognose (MET)' ? 'prognose (MET)' : s.source };
    },
    source: 'MET-prognose, justert av deg',
  };
}

function runDay(d: DayPlan, ctx: PlanContext, date: string, startD: number, toD: number, kiteId: string, scale = 1, speedScale = 1): SimResult {
  const { wind } = provider(d, ctx, scale);
  return simulate({
    route: ctx.route,
    fromD: startD,
    toD,
    startDate: date,
    startHour: d.departure,
    kites: [ctx.kite(kiteId)],
    params: { ...ctx.params, comfortKmh: d.speedKmh * speedScale, terrainFactor: 1, variability: d.wind.variability },
    wind,
    rules: {
      startHour: d.departure,
      endHour: (ds, p) => hourOf(sunDay(ds, p).civilDusk) ?? 19,
      maxMovingH: d.activeH,
      launchMin: ctx.launchMin,
      // pauser fordeles jevnt over dagen (påvirker klokkeslett og dermed time-for-time-vind)
      navMinPerHour: ctx.navMinPerHour + (d.breakH * 60) / Math.max(0.5, d.activeH),
    },
    walkRanges: ctx.walkRanges,
    zAt: ctx.zAt,
    maxDays: 1,
  });
}

/** Velg kiten (av de du tar med) som gir best fremdrift denne dagen. */
export function bestKite(d: DayPlan, ctx: PlanContext, date: string, startD: number, toD: number): string {
  let best = ctx.quiver[0] ?? 'sonic10';
  let bestD = -1;
  for (const id of ctx.quiver) {
    const r = runDay(d, ctx, date, startD, toD, id);
    const prog = r.reachedD - startD - (r.totals.stormH + r.totals.skiH) * 50; // straff for ski/storm
    if (prog > bestD || (r.completed && prog >= bestD)) {
      bestD = prog;
      best = id;
    }
  }
  return best;
}

export function runExpedition(plan: PlanScenario, ctx: PlanContext): DayOutcome[] {
  const out: DayOutcome[] = [];
  const cum = cumulative(ctx.route);
  let start = 0;
  plan.days.forEach((d, i) => {
    const date = addDays(ctx.tripDate, i);
    const last = i === plan.days.length - 1;
    const issues: string[] = [];
    if (start >= ctx.total - 50) {
      // allerede i mål – ingen reise denne dagen
      const p0 = pointAt(ctx.route, cum, ctx.total);
      const sun0 = sunDay(date, p0);
      const empty = simulate({ route: ctx.route, fromD: ctx.total - 1, toD: ctx.total, startDate: date, startHour: d.departure, kites: [], params: ctx.params, wind: manualProvider({ dir: 0, avg: 0, min: 0, max: 0, gust: 0, tempC: 0, hourly: [] }), rules: { startHour: d.departure, endHour: () => 24, maxMovingH: 1, launchMin: 0, navMinPerHour: 0 }, walkRanges: [], zAt: ctx.zAt, maxDays: 1 });
      out.push({ day: i + 1, date, startD: start, endD: start, simEndD: start, targetD: null, reachedTarget: true, forcedStop: false, kiteId: d.kiteId === 'auto' ? ctx.quiver[0] ?? 'sonic10' : d.kiteId, kiteAuto: d.kiteId === 'auto', theoreticalKm: 0, sailedKm: 0, progressKm: 0, movingH: 0, departure: d.departure, arrival: d.departure, sunrise: hourOf(sun0.sunrise), sunset: hourOf(sun0.sunset), civilDusk: hourOf(sun0.civilDusk), daylightLeftH: null, rangeKm: [0, 0], rangeArrival: [d.departure, d.departure], reason: 'allerede i mål – reservedag', upwindShare: 0, underShare: 0, overShare: 0, windSource: '–', remainingKm: 0, issues: [], result: empty });
      return;
    }
    let targetD: number | null = null;
    if (d.target.mode === 'km' && d.target.km) targetD = Math.min(ctx.total, start + d.target.km * 1000);
    if (d.target.mode === 'stopp' && d.target.stopD != null) {
      if (d.target.stopD <= start + 100) issues.push(`Det manuelle stoppet (${(d.target.stopD / 1000).toFixed(1)} km) ligger bak dagens start – velg nytt stopp`);
      else targetD = Math.min(ctx.total, d.target.stopD);
    }
    const toD = targetD ?? ctx.total;
    const kiteAuto = d.kiteId === 'auto';
    const kiteId = kiteAuto ? bestKite(d, ctx, date, start, toD) : d.kiteId;
    const r = runDay(d, ctx, date, start, toD, kiteId);
    const lo = runDay(d, ctx, date, start, toD, kiteId, 0.8, 0.9);
    const hi = runDay(d, ctx, date, start, toD, kiteId, 1.15, 1.05);
    const simEnd = r.reachedD;
    const forced = d.target.mode === 'stopp' && targetD != null && simEnd < targetD - 100;
    const endD = forced ? targetD! : simEnd;
    const reached = targetD == null ? simEnd >= ctx.total - 50 : simEnd >= targetD - 100;
    const p = pointAt(ctx.route, cum, endD);
    const sun = sunDay(date, p);
    const arrival = hourOf(new Date(r.end)) ?? d.departure;
    const kmLeg = (x: SimResult) => x.legs.reduce((a, l) => a + (l.d1 - l.d0), 0) || 1;
    const share = (f: (l: SimResult['legs'][number]) => number) => r.legs.reduce((a, l) => a + f(l) * (l.d1 - l.d0), 0) / kmLeg(r);
    if (!reached && targetD != null) issues.push(`Modellen rekker ${((simEnd - start) / 1000).toFixed(1)} av ${((targetD - start) / 1000).toFixed(1)} km innen ${r.totals.movingH >= d.activeH - 0.05 ? 'de planlagte timene' : 'mørket'}${forced ? ' – du har valgt stoppet likevel' : ''}`);
    if (last && endD < ctx.total - 50) issues.push(`Mangler ${((ctx.total - endD) / 1000).toFixed(1)} km til mål etter siste dag`);
    const sunset = hourOf(sun.sunset);
    const left = sunset != null ? sunset - arrival : null;
    if (left != null && left < 0.5) issues.push(left < 0 ? 'Ankomst etter solnedgang' : 'Under 30 min dagslys ved ankomst');
    r.warnings.filter((w) => !/Stoppet etter/.test(w)).forEach((w) => issues.push(w));
    out.push({
      day: i + 1,
      date,
      startD: start,
      endD,
      simEndD: simEnd,
      targetD,
      reachedTarget: reached,
      forcedStop: forced,
      kiteId,
      kiteAuto,
      theoreticalKm: d.speedKmh * d.activeH,
      sailedKm: r.totals.sailedKm,
      progressKm: (simEnd - start) / 1000,
      movingH: r.totals.movingH,
      departure: d.departure,
      arrival,
      sunrise: hourOf(sun.sunrise),
      sunset,
      civilDusk: hourOf(sun.civilDusk),
      daylightLeftH: left,
      rangeKm: [Math.min(lo.reachedD, hi.reachedD, simEnd) - start, Math.max(lo.reachedD, hi.reachedD, simEnd) - start].map((x) => x / 1000) as [number, number],
      rangeArrival: [Math.min(hourOf(new Date(hi.end)) ?? arrival, hourOf(new Date(lo.end)) ?? arrival, arrival), Math.max(hourOf(new Date(hi.end)) ?? arrival, hourOf(new Date(lo.end)) ?? arrival, arrival)],
      reason: reached ? (targetD != null ? 'dagsmål nådd' : 'mål nådd') : r.totals.movingH >= d.activeH - 0.05 ? 'planlagte timer brukt' : 'mørket kom',
      upwindShare: share((l) => (l.course === 'motvind' || l.course === 'kryss' ? 1 : 0)),
      underShare: share((l) => l.fracUnder),
      overShare: share((l) => l.fracOver),
      windSource: provider(d, ctx).source,
      remainingKm: (ctx.total - endD) / 1000,
      issues,
      result: r,
    });
    start = endD;
  });
  return out;
}

export const hhmm = (h: number | null | undefined) => (h == null || !Number.isFinite(h) ? '–' : `${String(Math.floor(((h % 24) + 24) % 24)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`);
