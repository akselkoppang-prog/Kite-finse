import type { ForecastRow } from '../api/met';
import { windChill } from '../api/met';
import type { RouteForecastPoint } from '../sim/wind';
import type { DayOutcome } from '../sim/expedition';
import { hourOf } from '../sun';

/** Nærmeste prognosepunkt (langs ruten) og nærmeste time. null utenfor prognosens tidsrom. */
export function rowAt(points: RouteForecastPoint[] | null | undefined, t: number, d: number): { row: ForecastRow; label: string } | null {
  if (!points?.length) return null;
  const pt = points.reduce((b, x) => (Math.abs(x.d - d) < Math.abs(b.d - d) ? x : b), points[0]);
  const rows = pt.fc.rows;
  if (!rows.length) return null;
  const first = Date.parse(rows[0].time), last = Date.parse(rows[rows.length - 1].time);
  if (t < first - 3600000 || t > last + 3 * 3600000) return null;
  const row = rows.reduce((b, x) => (Math.abs(Date.parse(x.time) - t) < Math.abs(Date.parse(b.time) - t) ? x : b), rows[0]);
  return { row, label: pt.label };
}

/** Ute av prognosen? (hele dagen) */
export function covers(points: RouteForecastPoint[] | null | undefined, t: number): boolean {
  return !!points?.some((p) => p.fc.rows.length && Date.parse(p.fc.rows[p.fc.rows.length - 1].time) >= t - 3600000);
}

/**
 * Hvor mye vær utover vind bremser: dårlig sikt (navigasjon, kitekontroll) og kraftig nedbør/snøfall (tung snø).
 * Konservative, dokumenterte faktorer – vises i forklaringen per dag.
 */
export function weatherSpeedFactor(rows: ForecastRow[]): { factor: number; reasons: string[] } {
  if (!rows.length) return { factor: 1, reasons: [] };
  const vis = Math.min(...rows.map((r) => r.visibility ?? (r.fog != null && r.fog > 50 ? 800 : 20000)));
  const snow = Math.max(...rows.map((r) => r.snow ?? 0));
  const pr = Math.max(...rows.map((r) => r.precip ?? 0));
  let f = 1;
  const reasons: string[] = [];
  if (vis < 500) { f *= 0.55; reasons.push(`sikt under 500 m (×0,55)`); }
  else if (vis < 1000) { f *= 0.7; reasons.push(`sikt under 1 km (×0,7)`); }
  else if (vis < 3000) { f *= 0.88; reasons.push(`nedsatt sikt ${(vis / 1000).toFixed(1)} km (×0,88)`); }
  if (snow >= 1) { f *= 0.85; reasons.push(`kraftig snøfall ${snow.toFixed(1)} cm/t (×0,85)`); }
  else if (pr >= 2) { f *= 0.9; reasons.push(`kraftig nedbør ${pr.toFixed(1)} mm/t (×0,9)`); }
  return { factor: Math.max(0.5, f), reasons };
}

export type Rel = 'motvind' | 'sidevind' | 'medvind';
export const relWind = (twa: number): Rel => (twa < 60 ? 'motvind' : twa > 120 ? 'medvind' : 'sidevind');

export interface WxHour { t: number; hour: number; d: number; label: string; row: ForecastRow; rel: Rel; chill?: number }
export interface DayWx {
  day: number;
  hours: WxHour[];
  covered: boolean;
  avgWind: number | null;
  maxGust: number | null;
  minTemp: number | null;
  minChill: number | null;
  precipMm: number;
  snowCm: number;
  minVis: number | null;
  headShare: number;
  hazards: { level: 'viktig' | 'advarsel' | 'info'; text: string }[];
}

/** Været du faktisk møter: prognosen der og når simuleringen sier du er langs ruten (en prøve per etappe-time). */
export function dayWeather(day: DayOutcome, points: RouteForecastPoint[] | null | undefined): DayWx {
  const hours: WxHour[] = [];
  let lastHour = -1;
  for (const l of day.result.legs) {
    const t = (l.t0 + l.t1) / 2;
    const hr = Math.floor(t / 3600000);
    if (hr === lastHour) continue;
    lastHour = hr;
    const a = rowAt(points, t, (l.d0 + l.d1) / 2);
    if (!a) continue;
    hours.push({ t, hour: hourOf(new Date(t)) ?? 0, d: (l.d0 + l.d1) / 2, label: a.label, row: a.row, rel: relWind(l.twa), chill: windChill(a.row.temp, a.row.windSpeed) });
  }
  const num = (xs: (number | undefined)[]) => xs.filter((x): x is number => x != null && Number.isFinite(x));
  const winds = num(hours.map((h) => h.row.windSpeed));
  const gusts = num(hours.map((h) => h.row.windGust));
  const temps = num(hours.map((h) => h.row.temp));
  const chills = num(hours.map((h) => h.chill));
  const vis = num(hours.map((h) => h.row.visibility));
  const head = hours.filter((h) => h.rel === 'motvind' && (h.row.windSpeed ?? 0) >= 6).length;
  const out: DayWx = {
    day: day.day,
    hours,
    covered: hours.length > 0,
    avgWind: winds.length ? winds.reduce((a, b) => a + b, 0) / winds.length : null,
    maxGust: gusts.length ? Math.max(...gusts) : null,
    minTemp: temps.length ? Math.min(...temps) : null,
    minChill: chills.length ? Math.min(...chills) : null,
    precipMm: num(hours.map((h) => h.row.precip)).reduce((a, b) => a + b, 0),
    snowCm: num(hours.map((h) => h.row.snow)).reduce((a, b) => a + b, 0),
    minVis: vis.length ? Math.min(...vis) : null,
    headShare: hours.length ? head / hours.length : 0,
    hazards: [],
  };
  out.hazards = hazardsFor(out);
  return out;
}

/** Farlige eller krevende forhold, med nivå. Terskler er vanlige for snowkite med pulk. */
export function hazardsFor(w: Omit<DayWx, 'hazards'>): DayWx['hazards'] {
  const h: DayWx['hazards'] = [];
  if (!w.covered) return h;
  if (w.maxGust != null && w.maxGust >= 20) h.push({ level: 'viktig', text: `Storm i kastene: opptil ${w.maxGust.toFixed(0)} m/s` });
  else if (w.maxGust != null && w.maxGust >= 15) h.push({ level: 'advarsel', text: `Kraftige vindkast: opptil ${w.maxGust.toFixed(0)} m/s` });
  if (w.avgWind != null && w.avgWind >= 14) h.push({ level: 'viktig', text: `Sterk vind i snitt ${w.avgWind.toFixed(0)} m/s` });
  if (w.headShare >= 0.4) h.push({ level: 'advarsel', text: `Motvind ≥ 6 m/s i ${Math.round(w.headShare * 100)} % av timene` });
  if (w.minChill != null && w.minChill <= -30) h.push({ level: 'viktig', text: `Ekstrem vindavkjøling ${w.minChill.toFixed(0)} °C – frostskaderisiko` });
  else if (w.minChill != null && w.minChill <= -20) h.push({ level: 'advarsel', text: `Kald vindavkjøling ${w.minChill.toFixed(0)} °C` });
  if (w.minVis != null && w.minVis < 1000) h.push({ level: w.minVis < 300 ? 'viktig' : 'advarsel', text: `Dårlig sikt ned mot ${Math.round(w.minVis)} m` });
  if (w.snowCm >= 10) h.push({ level: 'advarsel', text: `Mye nysnø: ${w.snowCm.toFixed(0)} cm i reisetiden` });
  else if (w.precipMm >= 10) h.push({ level: 'advarsel', text: `Mye nedbør: ${w.precipMm.toFixed(0)} mm i reisetiden` });
  if (w.avgWind != null && w.avgWind < 4) h.push({ level: 'info', text: `Lite vind (${w.avgWind.toFixed(1)} m/s) – regn med ski uten kite` });
  return h;
}
