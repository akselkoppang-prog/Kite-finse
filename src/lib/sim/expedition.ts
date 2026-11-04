import { simulate, type SimResult, type WindProvider } from './route';
import { forecastProvider, manualProvider, type RouteForecastPoint } from './wind';
import type { KiteInput, SimParams } from './physics';
import { addDays, hourOf, sunDay } from '../sun';
import { cumulative, pointAt, type LatLon } from '../geo';
import { uid } from '../geo';
import { crossingDelay, type Crossing } from '../project/model';
import { rowAt, weatherSpeedFactor } from '../weather/analysis';
import type { ForecastRow } from '../api/met';

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

export interface PlanScenario {
  id: string;
  name: string;
  days: DayPlan[];
  createdAt: string;
  updatedAt: string;
  /** Ruten scenarioet bruker (mangler = aktiv rute da scenarioet ble laget). */
  routeId?: string;
  note?: string;
  /** Avreisedato for dette scenarioet (YYYY-MM-DD). Mangler = prosjektets dato. */
  tripDate?: string;
  /** Hvilken værleverandør «Værmelding»-dagene bruker (met, om-ecmwf …). */
  weatherSource?: string;
  /** Utstyrsliste scenarioet bruker (kan deles mellom scenarioer). */
  gearListId?: string;
  /** Matplan for scenarioet. */
  food?: import('../project/model').FoodPlan;
}

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
  /** krysninger langs ruten (projisert avstand d) */
  crossings?: { c: Crossing; d: number }[];
  /** last (pulk) ved start av dag i (utstyr + gjenværende mat/brensel) – mangler = params.pulkKg */
  dayLoad?: (i: number) => number;
  /** fartsreduksjon per påfølgende dag (%) */
  fatiguePct?: number;
  /** dagens dato i «nå» (for prognosens pålitelighet). Settes i tester. */
  today?: string;
}

export interface CrossEvent { name: string; kind: string; d: number; arriveH: number; waitH: number; transferH: number; departH: number; blocked: string | null; unverified: boolean }

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
  crossings: CrossEvent[];
  /** pulkvekt denne dagen (kg) */
  loadKg: number;
  fatigueFactor: number;
  weatherFactor: number;
  weatherReasons: string[];
  confidence: 'høy' | 'middels' | 'lav';
  uncertainties: string[];
  /** tidsbruk (timer) */
  breakdown: { kiteH: number; skiH: number; walkH: number; tackH: number; overheadH: number; crossingH: number; windWaitH: number };
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

interface DayOpts { scale?: number; speedScale?: number; startHour?: number; maxMovingH?: number; params?: SimParams }
function runDay(d: DayPlan, ctx: PlanContext, date: string, startD: number, toD: number, kiteId: string, o: DayOpts = {}): SimResult {
  const { wind } = provider(d, ctx, o.scale ?? 1);
  const startHour = o.startHour ?? d.departure;
  return simulate({
    route: ctx.route,
    fromD: startD,
    toD,
    startDate: date,
    startHour,
    kites: [ctx.kite(kiteId)],
    params: { ...(o.params ?? ctx.params), comfortKmh: d.speedKmh * (o.speedScale ?? 1), terrainFactor: 1, variability: d.wind.variability },
    wind,
    rules: {
      startHour,
      endHour: (ds, p) => hourOf(sunDay(ds, p).civilDusk) ?? 19,
      maxMovingH: o.maxMovingH ?? d.activeH,
      launchMin: ctx.launchMin,
      // pauser fordeles jevnt over dagen (påvirker klokkeslett og dermed time-for-time-vind)
      navMinPerHour: ctx.navMinPerHour + (d.breakH * 60) / Math.max(0.5, d.activeH),
    },
    walkRanges: ctx.walkRanges,
    zAt: ctx.zAt,
    maxDays: 1,
  });
}

/** En dag med krysninger: kjør frem til krysningen, vent på avgang / bruk overgangstid, kjør videre. */
function simDay(d: DayPlan, ctx: PlanContext, date: string, start: number, toD: number, kiteId: string, o: DayOpts = {}): { r: SimResult; events: CrossEvent[] } {
  const xs = (ctx.crossings ?? []).filter((x) => x.d > start + 50 && x.d < toD - 50).sort((a, b) => a.d - b.d);
  if (!xs.length) return { r: runDay(d, ctx, date, start, toD, kiteId, o), events: [] };
  const parts: SimResult[] = [];
  const events: CrossEvent[] = [];
  let from = start, hour = o.startHour ?? d.departure, moving = o.maxMovingH ?? d.activeH;
  for (const seg of [...xs.map((x) => ({ end: x.d, x })), { end: toD, x: null }]) {
    const r = runDay(d, ctx, date, from, seg.end, kiteId, { ...o, startHour: hour, maxMovingH: Math.max(0.05, moving) });
    parts.push(r);
    moving -= r.totals.movingH;
    if (!seg.x || r.reachedD < seg.end - 50) break;
    const arriveH = hourOf(new Date(r.end)) ?? hour;
    const del = crossingDelay(seg.x.c, date, arriveH);
    events.push({ name: seg.x.c.name, kind: seg.x.c.kind, d: seg.x.d, arriveH, waitH: del.waitH, transferH: del.transferH, departH: del.departH, blocked: del.blocked, unverified: !seg.x.c.source });
    if (del.blocked || moving < 0.2) break;
    from = seg.end;
    hour = del.departH;
  }
  const last = parts[parts.length - 1];
  const sum = <K extends keyof SimResult['totals']>(k: K) => parts.reduce((a, p) => a + (p.totals[k] as number), 0);
  const lastEv = events[events.length - 1];
  const endMs = lastEv && last.reachedD <= lastEv.d + 1 ? last.end + (lastEv.waitH + lastEv.transferH) * 3600000 : last.end;
  return {
    r: {
      ...last,
      legs: parts.flatMap((p) => p.legs),
      dayEnds: last.dayEnds,
      start: parts[0].start,
      end: endMs,
      totals: { movingH: sum('movingH'), kiteH: sum('kiteH'), skiH: sum('skiH'), walkH: sum('walkH'), stormH: sum('stormH'), tackH: sum('tackH'), overheadH: sum('overheadH'), waitH: sum('waitH'), sailedKm: sum('sailedKm'), days: 1 },
      warnings: parts.flatMap((p) => p.warnings),
    },
    events,
  };
}

/** Velg kiten (av de du tar med) som gir best fremdrift denne dagen. */
export function bestKite(d: DayPlan, ctx: PlanContext, date: string, startD: number, toD: number, o: DayOpts = {}): string {
  let best = ctx.quiver[0] ?? 'sonic10';
  let bestD = -1;
  for (const id of ctx.quiver) {
    const r = runDay(d, ctx, date, startD, toD, id, o);
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
      out.push({ day: i + 1, date, startD: start, endD: start, simEndD: start, targetD: null, reachedTarget: true, forcedStop: false, kiteId: d.kiteId === 'auto' ? ctx.quiver[0] ?? 'sonic10' : d.kiteId, kiteAuto: d.kiteId === 'auto', theoreticalKm: 0, sailedKm: 0, progressKm: 0, movingH: 0, departure: d.departure, arrival: d.departure, sunrise: hourOf(sun0.sunrise), sunset: hourOf(sun0.sunset), civilDusk: hourOf(sun0.civilDusk), daylightLeftH: null, rangeKm: [0, 0], rangeArrival: [d.departure, d.departure], reason: 'allerede i mål – reservedag', upwindShare: 0, underShare: 0, overShare: 0, windSource: '–', remainingKm: 0, issues: [], result: empty, crossings: [], loadKg: ctx.dayLoad ? ctx.dayLoad(i) : ctx.params.pulkKg, fatigueFactor: 1, weatherFactor: 1, weatherReasons: [], confidence: 'høy', uncertainties: [], breakdown: { kiteH: 0, skiH: 0, walkH: 0, tackH: 0, overheadH: 0, crossingH: 0, windWaitH: 0 } });
      return;
    }
    let targetD: number | null = null;
    if (d.target.mode === 'km' && d.target.km) targetD = Math.min(ctx.total, start + d.target.km * 1000);
    if (d.target.mode === 'stopp' && d.target.stopD != null) {
      if (d.target.stopD <= start + 100) issues.push(`Det manuelle stoppet (${(d.target.stopD / 1000).toFixed(1)} km) ligger bak dagens start – velg nytt stopp`);
      else targetD = Math.min(ctx.total, d.target.stopD);
    }
    const toD = targetD ?? ctx.total;
    // last, tretthet og vær utover vind
    const loadKg = ctx.dayLoad ? ctx.dayLoad(i) : ctx.params.pulkKg;
    const params = { ...ctx.params, pulkKg: loadKg };
    const fatigueFactor = Math.max(0.75, 1 - ((ctx.fatiguePct ?? 0) / 100) * i);
    const dayStartMs = Date.parse(`${date}T00:00:00Z`) + (d.departure - 1) * 3600000;
    const wxRows: ForecastRow[] = [];
    if (d.windMode !== 'manuell' && ctx.forecast?.length) {
      const reach = start + d.speedKmh * d.activeH * 1000;
      for (let h = 0; h <= d.activeH + d.breakH; h += 1) for (const pt of ctx.forecast) if (pt.d >= start - 6000 && pt.d <= reach + 6000) { const a = rowAt([pt], dayStartMs + h * 3600000, pt.d); if (a) wxRows.push(a.row); }
    }
    const wf = weatherSpeedFactor(wxRows);
    const speedScale = fatigueFactor * wf.factor;
    const o: DayOpts = { params, speedScale };
    const kiteAuto = d.kiteId === 'auto';
    const kiteId = kiteAuto ? bestKite(d, ctx, date, start, toD, o) : d.kiteId;
    const main = simDay(d, ctx, date, start, toD, kiteId, o);
    const r = main.r;
    const lo = simDay(d, ctx, date, start, toD, kiteId, { ...o, scale: 0.8, speedScale: speedScale * 0.9 }).r;
    const hi = simDay(d, ctx, date, start, toD, kiteId, { ...o, scale: 1.15, speedScale: speedScale * 1.05 }).r;
    const blockedEv = main.events.find((e) => e.blocked);
    if (blockedEv) issues.push(`${blockedEv.blocked} – dagen stopper ved krysningen`);
    main.events.forEach((e) => e.unverified && !e.blocked && issues.push(`${e.name}: ventetid/rutetid er ikke bekreftet (legg inn kilde)`));
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
      crossings: main.events,
      loadKg,
      fatigueFactor,
      weatherFactor: wf.factor,
      weatherReasons: wf.reasons,
      ...confidenceFor(d, ctx, date, (simEnd - start) / 1000, [Math.min(lo.reachedD, hi.reachedD, simEnd) - start, Math.max(lo.reachedD, hi.reachedD, simEnd) - start], main.events, wxRows.length > 0),
      breakdown: { kiteH: r.totals.kiteH, skiH: r.totals.skiH, walkH: r.totals.walkH, tackH: r.totals.tackH, overheadH: r.totals.overheadH, crossingH: main.events.reduce((a, e) => a + e.waitH + e.transferH, 0), windWaitH: r.totals.waitH },
    });
    start = endD;
  });
  return out;
}

/** Hvor sikker er dagens estimat, og hvorfor. */
function confidenceFor(d: DayPlan, ctx: PlanContext, date: string, progKm: number, range: number[], events: CrossEvent[], hasForecast: boolean): { confidence: DayOutcome['confidence']; uncertainties: string[] } {
  const u: string[] = [];
  const today = ctx.today ?? new Date().toISOString().slice(0, 10);
  const ahead = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  let lvl = 2; // 2 høy, 1 middels, 0 lav
  if (d.windMode === 'manuell' || !hasForecast) {
    lvl = 0;
    u.push('Vinden er ditt eget scenario, ikke en prognose');
  } else if (ahead > 5) {
    lvl = 0;
    u.push(`Prognose ${ahead} dager frem – stor usikkerhet`);
  } else if (ahead > 2) {
    lvl = 1;
    u.push(`Prognose ${ahead} dager frem`);
  }
  const width = (range[1] - range[0]) / 1000;
  if (progKm > 1 && width / progKm > 0.35) {
    lvl = Math.max(0, lvl - 1);
    u.push(`Fremdriften er følsom for vinden (spenn ${width.toFixed(0)} km)`);
  }
  if (d.wind.gust >= d.wind.avg * 1.6) u.push('Byget vind – kastene kan tvinge frem defensiv kjøring');
  if (events.some((e) => e.unverified)) {
    lvl = Math.max(0, lvl - 1);
    u.push('Krysning(er) uten bekreftet rutetid');
  }
  if (!ctx.walkRanges.length) u.push('Terreng/nedstigning ikke analysert (gåstrekk kan mangle)');
  return { confidence: lvl === 2 ? 'høy' : lvl === 1 ? 'middels' : 'lav', uncertainties: u };
}

export const hhmm = (h: number | null | undefined) => {
  if (h == null || !Number.isFinite(h)) return '–';
  const m = ((Math.round(h * 60) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
