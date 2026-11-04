import { angleDiff, bearing, cumulative, densify, pointAt, type LatLon } from '../geo';
import { airDensity, bestVMG, canStart, courseClass, heightFactor, overpowered, polar, type CourseMode, type KiteInput, type SimParams } from './physics';
import { addDays, atLocalHour, hourOf, sunDay } from '../sun';

/** Vind i et punkt og tidspunkt (10 m høyde). */
export interface WindSample {
  speed: number; // middelvind m/s
  gust: number;
  dirFrom: number; // grader
  min?: number;
  max?: number;
  tempC?: number;
  source: 'prognose (MET)' | 'manuell time-for-time' | 'scenario' | 'klimatologi';
  pointLabel?: string;
}
export type WindProvider = (t: Date, p: LatLon, d: number) => WindSample;

export interface DayRules {
  startHour: number;
  /** Slutt på dagen (lokal time) for dato og sted – normalt borgerlig skumring minus leirtid */
  endHour: (dateStr: string, p: LatLon) => number;
  maxMovingH: number;
  launchMin: number;
  navMinPerHour: number;
}

export type LegMode = 'kite' | 'ski (for lite vind)' | 'gå (bratt/nedstigning)' | 'storm (for mye vind)';

export interface SimLeg {
  d0: number;
  d1: number;
  t0: number; // ms
  t1: number;
  day: number;
  routeBearing: number;
  twa: number;
  course: ReturnType<typeof courseClass>;
  wind: WindSample;
  mode: LegMode;
  kiteId?: string;
  courseMode?: CourseMode;
  groundKmh: number; // fart over bakken (snitt over vindfordelingen)
  progressKmh: number; // fremdrift langs ruten
  sailedM: number; // faktisk tilbakelagt distanse inkl. kryss/jibb
  tacks: number;
  tackSec: number;
  fracUnder: number;
  fracOver: number;
  fracDefensive?: number;
}

export interface DayEnd { day: number; d: number; t: number; reason: 'mørke' | 'maks reisetid' | 'dagsmål nådd' | 'mål nådd' }

export interface SimResult {
  legs: SimLeg[];
  dayEnds: DayEnd[];
  start: number;
  end: number;
  reachedD: number;
  completed: boolean;
  totals: { movingH: number; kiteH: number; skiH: number; walkH: number; stormH: number; tackH: number; overheadH: number; waitH: number; sailedKm: number; days: number };
  warnings: string[];
}

export interface SimInput {
  route: LatLon[];
  fromD: number;
  toD: number;
  startDate: string; // YYYY-MM-DD
  startHour: number;
  kites: KiteInput[];
  params: SimParams;
  wind: WindProvider;
  rules: DayRules;
  walkRanges: [number, number][];
  zAt: (d: number) => number | null;
  /** Dagsmål (m fra startpunkt) – brukes av reiseplan-simulatoren */
  dayTargets?: number[];
  maxDays?: number;
  legM?: number;
}

/** Kvantiler av vind innen timen (normalfordeling med variasjonskoeff., avkortet til min/maks). */
const Z = [-1.28, -0.52, 0, 0.52, 1.28]; // 10/30/50/70/90 %
function windQuantiles(w: WindSample, cv: number): number[] {
  return Z.map((z) => {
    let v = w.speed * (1 + cv * z);
    if (w.min != null) v = Math.max(w.min, v);
    if (w.max != null) v = Math.min(w.max, v);
    return Math.max(0, v);
  });
}

/**
 * Tidssteg-simulering langs ruten. For hver etappe (standard 500 m):
 *  1. vind for (tid, sted) fra provider (prognose time for time når den finnes)
 *  2. for 5 vindkvantiler: velg den kiten i quiveren som gir best fremdrift og ikke er overpowered i kast
 *  3. tid = snitt over kvantiler av distanse/fremdrift (+ stagvendinger), ski når ingen kite fungerer
 *  4. dagen slutter ved mørke/maks reisetid/dagsmål; neste dag starter på starttid
 */
export function simulate(inp: SimInput): SimResult {
  const p = inp.params;
  const hf = heightFactor(p);
  // Etapper klippet nøyaktig til [fromD, toD]
  const cumR = cumulative(inp.route);
  const inner = densify(inp.route, inp.legM ?? 500).filter((x) => x.d > inp.fromD + 1 && x.d < inp.toD - 1);
  const pts = [{ ...pointAt(inp.route, cumR, inp.fromD), d: inp.fromD }, ...inner, { ...pointAt(inp.route, cumR, inp.toD), d: inp.toD }];
  const legs: SimLeg[] = [];
  const dayEnds: DayEnd[] = [];
  const warnings = new Set<string>();
  let day = 1;
  let date = inp.startDate;
  let t = atLocalHour(date, inp.startHour).getTime();
  let dayStartT = t;
  let movingToday = 0;
  let lastKite: string | undefined;
  const tot = { movingH: 0, kiteH: 0, skiH: 0, walkH: 0, stormH: 0, tackH: 0, overheadH: 0, waitH: 0, sailedKm: 0, days: 1 };
  const maxDays = inp.maxDays ?? 10;
  t += (inp.rules.launchMin / 60) * 3600000;
  tot.overheadH += inp.rules.launchMin / 60;
  let completed = true;
  let reachedD = inp.fromD;

  const newDay = (reason: DayEnd['reason'], d: number) => {
    dayEnds.push({ day, d, t, reason });
    day++;
    tot.days = day;
    date = addDays(inp.startDate, day - 1);
    t = atLocalHour(date, inp.startHour).getTime() + (inp.rules.launchMin / 60) * 3600000;
    tot.overheadH += inp.rules.launchMin / 60;
    dayStartT = t;
    movingToday = 0;
  };

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = b.d - a.d;
    if (L <= 0) continue;
    // dagsmål / mørke
    const target = inp.dayTargets?.[day - 1];
    if (target != null && a.d - inp.fromD >= target - 1 && day <= (inp.dayTargets?.length ?? 0)) newDay('dagsmål nådd', a.d);
    const endH = Math.min(inp.rules.endHour(date, a), hourOf(new Date(dayStartT))! + inp.rules.maxMovingH + 2);
    if ((hourOf(new Date(t)) ?? 0) >= endH || movingToday >= inp.rules.maxMovingH) {
      if (day >= maxDays) {
        completed = false;
        warnings.add(`Stoppet etter ${maxDays} dager`);
        break;
      }
      newDay((hourOf(new Date(t)) ?? 0) >= endH ? 'mørke' : 'maks reisetid', a.d);
    }
    const brg = bearing(a, b);
    const za = inp.zAt(a.d), zb = inp.zAt(b.d);
    const grade = za != null && zb != null ? (zb - za) / L : 0;
    const w = inp.wind(new Date(t), a, a.d);
    const twa = angleDiff(brg, w.dirFrom);
    const rho = airDensity(w.tempC ?? p.tempC, za ?? 1100);
    const walk = inp.walkRanges.some(([x, y]) => (a.d + b.d) / 2 >= x && (a.d + b.d) / 2 <= y);
    let legH: number;
    const leg: SimLeg = { d0: a.d, d1: b.d, t0: t, t1: t, day, routeBearing: brg, twa, course: courseClass(twa), wind: w, mode: 'kite', groundKmh: 0, progressKmh: 0, sailedM: L, tacks: 0, tackSec: 0, fracUnder: 0, fracOver: 0 };
    if (walk) {
      leg.mode = 'gå (bratt/nedstigning)';
      legH = L / 1000 / p.walkSteepKmh;
      leg.groundKmh = leg.progressKmh = p.walkSteepKmh;
      tot.walkH += legH;
    } else {
      const qs = windQuantiles(w, p.variability);
      const gustRatio = w.speed > 0 ? Math.max(1, w.gust / w.speed) : 1.3;
      const gF = grade > 0 ? Math.max(0.3, 1 - grade * 4) : Math.min(1.25, 1 + -grade * 2); // enkel stigningskorreksjon
      const share = 1 / qs.length;
      /** Tid for etappen hvis rytteren har ÉN kite oppe (kvantiler der kiten ikke virker → ski/storm). */
      const evalKite = (k: KiteInput) => {
        let hours = 0, kiteH = 0, skiH = 0, stormH = 0, tackH = 0, sailed = 0, ground = 0, under = 0, over = 0, def = 0;
        let cm: CourseMode | undefined;
        for (const q of qs) {
          const Wk = q * hf;
          const gust = q * gustRatio * hf;
          let state: 'ok' | 'under' | 'over' = 'ok';
          let defensive = false;
          if (k.personal) {
            if (q > k.personal.high) state = 'over';
            else if (q < k.personal.low) state = 'under';
            else defensive = q * gustRatio > k.personal.high;
          } else if (overpowered(k, p, rho, Wk)) state = 'over';
          else if (!canStart(k, p, rho, Wk)) state = 'under';
          else defensive = overpowered(k, p, rho, gust);
          let r = state === 'ok' ? bestVMG(polar(k, p, rho), Wk, twa) : null;
          if (r && r.vmg * gF < 0.3) r = null;
          if (r) {
            const dF = defensive ? p.defensiveFactor : 1;
            const vmg = r.vmg * gF * dF;
            const h = L / vmg / 3600;
            const tacks = r.offset > 3 ? Math.max(1, Math.round((L * Math.tan((r.offset * Math.PI) / 180)) / p.corridorM)) : 0;
            const th = (tacks * p.tackSec) / 3600;
            hours += share * (h + th);
            kiteH += share * h;
            tackH += share * th;
            sailed += share * (L / Math.cos((r.offset * Math.PI) / 180));
            ground += share * r.V * gF * dF * 3.6;
            if (defensive) def++;
            if (r.mode !== 'direkte') cm = r.mode;
          } else if (state === 'over') {
            over++;
            const h = L / 1000 / (p.skiKmh * p.stormWalkFactor);
            hours += share * h;
            stormH += share * h;
            sailed += share * L;
            ground += share * p.skiKmh * p.stormWalkFactor;
          } else {
            under++;
            const h = L / 1000 / p.skiKmh;
            hours += share * h;
            skiH += share * h;
            sailed += share * L;
            ground += share * p.skiKmh;
          }
        }
        return { id: k.id, hours, kiteH, skiH, stormH, tackH, sailed, ground, under, over, def, cm };
      };
      const evals = inp.kites.map(evalKite);
      const noKite = evalKite({ id: '-', area: 0.01, cF: 0, glide: 1, depower: 0, dynBoost: 0, calib: 1, personal: { low: 999, high: 1000 } });
      const bestE = [...evals].sort((x, y) => x.hours - y.hours)[0] ?? noKite;
      const cur = evals.find((e) => e.id === lastKite);
      // hold på nåværende kite med mindre en annen sparer mer enn byttetid + 10 %
      const changeH = p.kiteChangeMin / 60;
      const chosen = cur && bestE.id !== cur.id && cur.hours - bestE.hours < Math.max(changeH, cur.hours * 0.1) ? cur : bestE;
      let hours = chosen.hours;
      const usesKite = chosen.kiteH > 0;
      const topKite = usesKite ? chosen.id : undefined;
      const under = chosen.under, over = chosen.over;
      leg.courseMode = chosen.cm ?? (usesKite ? 'direkte' : undefined);
      leg.mode = !usesKite ? (over > under ? 'storm (for mye vind)' : 'ski (for lite vind)') : over >= 3 ? 'storm (for mye vind)' : under >= 3 ? 'ski (for lite vind)' : 'kite';
      leg.kiteId = topKite;
      leg.fracUnder = under / qs.length;
      leg.fracOver = over / qs.length;
      leg.fracDefensive = chosen.def / qs.length;
      leg.sailedM = chosen.sailed;
      leg.groundKmh = chosen.ground;
      leg.tacks = Math.round((chosen.tackH * 3600) / Math.max(1, p.tackSec));
      leg.tackSec = chosen.tackH * 3600;
      tot.kiteH += chosen.kiteH;
      tot.skiH += chosen.skiH;
      tot.stormH += chosen.stormH;
      tot.tackH += chosen.tackH;
      if (topKite && lastKite && topKite !== lastKite) {
        hours += changeH;
        tot.overheadH += changeH;
      }
      if (topKite) lastKite = topKite;
      leg.progressKmh = L / 1000 / Math.max(1e-6, hours);
      if (leg.fracOver > 0.5) warnings.add('Perioder med mer vind enn kiten tåler (etter modellen) – mindre kite eller venting');
      if (leg.fracUnder > 0.5) warnings.add('Perioder med for lite vind for kitene – skigåing');
      if ((leg.fracDefensive ?? 0) > 0.3) warnings.add('Kast over kitens grense: modellen regner defensiv kjøring (redusert fremdrift)');
      legH = hours;
    }
    const nav = legH * (inp.rules.navMinPerHour / 60);
    tot.overheadH += nav;
    const total = legH + nav;
    tot.movingH += legH;
    tot.sailedKm += leg.sailedM / 1000;
    movingToday += legH;
    t += total * 3600000;
    leg.t1 = t;
    legs.push(leg);
    reachedD = b.d;
  }
  if (completed) dayEnds.push({ day, d: reachedD, t, reason: 'mål nådd' });
  return { legs, dayEnds, start: legs[0]?.t0 ?? 0, end: t, reachedD, completed: completed && reachedD >= inp.toD - 1, totals: tot, warnings: [...warnings] };
}

// ---------- Usikkerhet (Monte Carlo) ----------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const normal = (r: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());

export interface Uncertainty { p10: number; p50: number; p90: number; n: number; arrivals: number[] }

/**
 * Varierer usikre antakelser: c_F ±15 %, glidetall ±15 %, komfortfart ±10 %, vindstyrke ±(variabilitet) og
 * vindretning ±15°. Returnerer P10/P50/P90 for total varighet (timer fra start til mål, inkl. netter).
 */
export async function monteCarlo(inp: SimInput, n = 20, onProgress?: (f: number) => void): Promise<Uncertainty> {
  const r = rng(12345);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const kf = 1 + 0.15 * normal(r), gf = 1 + 0.15 * normal(r), cf = 1 + 0.1 * normal(r), wf = 1 + inp.params.variability * 0.6 * normal(r), df = 15 * normal(r);
    const kites = inp.kites.map((k) => ({ ...k, cF: k.cF * Math.max(0.6, kf), glide: k.glide * Math.max(0.6, gf) }));
    const params = { ...inp.params, comfortKmh: inp.params.comfortKmh * Math.max(0.7, cf) };
    const wind: WindProvider = (t, p, d) => {
      const w = inp.wind(t, p, d);
      const s = Math.max(0, w.speed * wf);
      return { ...w, speed: s, gust: w.gust * Math.max(0.5, wf), dirFrom: (w.dirFrom + df + 360) % 360 };
    };
    const res = simulate({ ...inp, kites, params, wind, legM: 1500 });
    out.push(res.completed ? (res.end - res.start) / 3600000 : Infinity);
    onProgress?.((i + 1) / n);
    if (i % 4 === 3) await new Promise((res2) => setTimeout(res2, 0));
  }
  const s = [...out].sort((a, b) => a - b);
  const q = (x: number) => s[Math.min(s.length - 1, Math.floor(x * s.length))];
  return { p10: q(0.1), p50: q(0.5), p90: q(0.9), n, arrivals: out };
}

/** Standard dagsregler fra sol (borgerlig skumring − leirtid). */
export function sunRules(startHour: number, campSetupH: number, maxMovingH: number, launchMin: number, navMinPerHour: number): DayRules {
  return {
    startHour,
    endHour: (dateStr, p) => (hourOf(sunDay(dateStr, p).civilDusk) ?? 19) - campSetupH,
    maxMovingH,
    launchMin,
    navMinPerHour,
  };
}

/** Posisjon langs simuleringen ved tidspunkt t (for animasjon). */
export function positionAt(res: SimResult, t: number): { d: number; leg?: SimLeg } {
  if (!res.legs.length) return { d: 0 };
  if (t <= res.legs[0].t0) return { d: res.legs[0].d0, leg: res.legs[0] };
  for (const l of res.legs) {
    if (t >= l.t0 && t <= l.t1) return { d: l.d0 + ((t - l.t0) / Math.max(1, l.t1 - l.t0)) * (l.d1 - l.d0), leg: l };
    if (t < l.t0) return { d: l.d0, leg: l }; // natt/pause
  }
  const last = res.legs[res.legs.length - 1];
  return { d: last.d1, leg: last };
}
