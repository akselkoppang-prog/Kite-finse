import { densify, type LatLon } from '../geo';
import type { WindLeg } from './wind';

/**
 * SNOWKITE-reisemodell. Beregner faktisk FREMDRIFT LANGS RUTEN (ikke kitefart) etappe for etappe:
 *  - kurs mot vinden (fra rutegeometri + valgt vindretning) → fremdriftsfart (VMG) for motvind/kryss/slør/medvind
 *  - andel tid med brukbar vind, le/turbulens (DTM) reduserer brukbarheten
 *  - strekk som må gås (bratt terreng, sluttnedstigning) går på ski/til fots
 *  - faste tidstap: oppskyting/landing, navigasjonspauser, værstans, tretthet
 * Alle parametre er antagelser du kan endre. Kalibrer dem mot egne GPS-logger.
 */
export interface TravelParams {
  reachKmh: number; // fremdrift på slør/halvvind med full pulk
  broadKmh: number; // bredslør
  closeKmh: number; // kryss høyt mot vinden (fremdrift langs ruten)
  upwindVmgKmh: number; // motvind: fremdrift langs ruten med stagvendinger
  downwindVmgKmh: number; // rett medvind: fremdrift med jibber/sikk-sakk
  skiKmh: number; // ski med pulk uten kite (flatt/kupert)
  walkSteepKmh: number; // bratte strekk / nedstigning med pulk
  launchMin: number; // minutter per oppskyting+landing
  launchesPerDay: number;
  navMinPerHour: number; // navigasjon/kart/drikke per bevegelsestime
  fatiguePctPerDay: number; // fartsreduksjon per påfølgende dag
  startHour: number; // planlagt start (lokal tid)
  campSetupH: number; // tid til leir, smelting, middag – må være ferdig før mørket
  maxMovingH: number; // maks effektiv reisetid per dag
}

export const DEFAULT_PARAMS: TravelParams = {
  reachKmh: 18,
  broadKmh: 16,
  closeKmh: 12,
  upwindVmgKmh: 7,
  downwindVmgKmh: 11,
  skiKmh: 3.5,
  walkSteepKmh: 2.5,
  launchMin: 12,
  launchesPerDay: 4,
  navMinPerHour: 6,
  fatiguePctPerDay: 4,
  startHour: 8,
  campSetupH: 1.5,
  maxMovingH: 9,
};

export interface Scenario {
  id: 'A' | 'B' | 'C';
  name: string;
  text: string;
  usableWind: number; // andel av distansen med brukbar kitevind (0–1)
  snowFactor: number; // fartsfaktor fra snøforhold
  visFactor: number; // fartsfaktor fra sikt/navigasjon
  downtimeH: number; // værstans per dag (venting på vind, whiteout)
  restDays: number; // hele liggedager
}

export const DEFAULT_SCENARIOS: Scenario[] = [
  { id: 'A', name: 'Utmerkede forhold', text: 'Stabil brukbar vind, fast snø, god sikt, minimalt med gåing. Tre-dagersmålet.', usableWind: 0.9, snowFactor: 1, visFactor: 1, downtimeH: 0.5, restDays: 0 },
  { id: 'B', name: 'Varierende forhold', text: 'Perioder uten brukbar vind, blanding av kiting og ski, lengre dager. Mulig ekstra dag.', usableWind: 0.6, snowFactor: 0.9, visFactor: 0.9, downtimeH: 1.5, restDays: 0 },
  { id: 'C', name: 'Dårlige forhold', text: 'For lite vind, tung snø, dårlig sikt, sikkerhetsstans. Lengre tur eller tidlig avbrudd.', usableWind: 0.3, snowFactor: 0.75, visFactor: 0.75, downtimeH: 3, restDays: 1 },
];

export interface LegTime {
  d0: number;
  d1: number;
  mode: 'kite+ski' | 'gå (bratt/nedstigning)';
  kiteH: number;
  skiH: number;
  course: WindLeg['course'];
}

export function courseSpeed(p: TravelParams, c: WindLeg['course']): number {
  return c === 'slør' ? p.reachKmh : c === 'bredslør' ? p.broadKmh : c === 'kryss' ? p.closeKmh : c === 'motvind' ? p.upwindVmgKmh : p.downwindVmgKmh;
}

/** Tid per etappe (uten faste overheads). walkRanges = [fra m, til m] som må gås. */
export function legTimes(legs: WindLeg[], p: TravelParams, sc: Scenario, walkRanges: [number, number][], pulkFactor: number): LegTime[] {
  return legs.map((l) => {
    const dKm = (l.d1 - l.d0) / 1000;
    const mid = (l.d0 + l.d1) / 2;
    const walk = walkRanges.some(([a, b]) => mid >= a && mid <= b);
    if (walk) return { d0: l.d0, d1: l.d1, mode: 'gå (bratt/nedstigning)', kiteH: 0, skiH: dKm / (p.walkSteepKmh * sc.snowFactor), course: l.course };
    const leeF = l.lee === 'turbulens' ? 0.4 : l.lee === 'le' ? 0.7 : 1;
    const usable = Math.min(1, sc.usableWind * leeF);
    const kiteV = courseSpeed(p, l.course) * sc.snowFactor * sc.visFactor * pulkFactor;
    const skiV = p.skiKmh * sc.snowFactor * Math.min(1, pulkFactor);
    return { d0: l.d0, d1: l.d1, mode: 'kite+ski', kiteH: (usable * dKm) / kiteV, skiH: ((1 - usable) * dKm) / skiV, course: l.course };
  });
}

export interface DayResult {
  day: number;
  d0: number;
  d1: number;
  kiteH: number;
  skiH: number;
  overheadH: number; // oppskyting, navigasjon
  downtimeH: number;
  totalH: number;
  kmKite: number;
  kmSki: number;
}

/** Summerer etapper innenfor [d0,d1] til en dag. */
export function dayTotals(lt: LegTime[], d0: number, d1: number, day: number, p: TravelParams, sc: Scenario): DayResult {
  let kiteH = 0, skiH = 0, kmKite = 0, kmSki = 0;
  for (const l of lt) {
    const ov = Math.max(0, Math.min(l.d1, d1) - Math.max(l.d0, d0));
    if (ov <= 0) continue;
    const f = ov / (l.d1 - l.d0);
    kiteH += l.kiteH * f;
    skiH += l.skiH * f;
    const kmK = l.kiteH + l.skiH > 0 ? (ov / 1000) * (l.kiteH / (l.kiteH + l.skiH)) : 0;
    kmKite += kmK;
    kmSki += ov / 1000 - kmK;
  }
  const fatigue = 1 + (p.fatiguePctPerDay / 100) * (day - 1);
  kiteH *= fatigue;
  skiH *= fatigue;
  const moving = kiteH + skiH;
  const overheadH = (kiteH > 0.05 ? (p.launchesPerDay * p.launchMin) / 60 : 0) + (moving * p.navMinPerHour) / 60;
  return { day, d0, d1, kiteH, skiH, overheadH, downtimeH: sc.downtimeH, totalH: moving + overheadH + sc.downtimeH, kmKite, kmSki };
}

/** Hvor mange dager trengs med gitt tilgjengelig tid per dag? Fyller dager etappe for etappe. */
export function daysNeeded(lt: LegTime[], p: TravelParams, sc: Scenario, availH: (day: number) => number): { days: number; breaks: number[] } {
  const breaks: number[] = [];
  let day = 1;
  let used = sc.downtimeH + (p.launchesPerDay * p.launchMin) / 60;
  for (const l of lt) {
    const fatigue = 1 + (p.fatiguePctPerDay / 100) * (day - 1);
    let legH = (l.kiteH + l.skiH) * fatigue * (1 + p.navMinPerHour / 60);
    let d0 = l.d0;
    while (used + legH > availH(day) && day < 30) {
      const frac = Math.max(0, (availH(day) - used) / legH);
      const cut = d0 + (l.d1 - d0) * frac;
      breaks.push(cut);
      legH *= 1 - frac;
      d0 = cut;
      day++;
      used = sc.downtimeH + (p.launchesPerDay * p.launchMin) / 60;
    }
    used += legH;
  }
  return { days: day, breaks };
}

/** Lik fordeling av distansen på n dager. */
export function equalBreaks(totalM: number, n: number): number[] {
  return Array.from({ length: Math.max(0, n - 1) }, (_, i) => (totalM * (i + 1)) / n);
}

/** Sluttnedstigning: siste del av ruten der den faller > minDrop m mot slutten. */
export function finalDescent(route: LatLon[], z: (p: LatLon & { d: number }) => number | null, minDrop = 350): { fromD: number; toD: number; drop: number } | null {
  const s = densify(route, 100);
  const endZ = z(s[s.length - 1]);
  if (endZ == null) return null;
  let from = -1;
  for (let i = s.length - 1; i >= 0; i--) {
    const zi = z(s[i]);
    if (zi != null && zi - endZ >= minDrop) {
      // gå videre bakover til toppen av fallet
      from = i;
      let best = zi;
      for (let k = i; k >= 0 && s[i].d - s[k].d <= 4000; k--) {
        const zk = z(s[k]);
        if (zk != null && zk >= best) {
          best = zk;
          from = k;
        } else if (zk != null && zk < best - 30) break;
      }
      break;
    }
  }
  if (from < 0) return null;
  const top = z(s[from]) ?? endZ;
  return { fromD: s[from].d, toD: s[s.length - 1].d, drop: top - endZ };
}
