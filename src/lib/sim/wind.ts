import type { LatLon } from '../geo';
import type { Forecast } from '../api/met';
import { hourOf } from '../sun';
import type { WindProvider, WindSample } from './route';

export interface HourWind { hour: number; speed: number; gust: number; dir: number }

export interface ManualWind {
  dir: number;
  avg: number;
  min: number;
  max: number;
  gust: number;
  tempC: number;
  hourly: HourWind[]; // tom = konstant
}

/** Manuell vind: konstant, eller time-for-time (siste rad med time ≤ nåværende time gjelder). */
export function manualProvider(m: ManualWind): WindProvider {
  const rows = [...m.hourly].sort((a, b) => a.hour - b.hour);
  return (t) => {
    if (rows.length) {
      const h = hourOf(t) ?? 12;
      const r = [...rows].reverse().find((x) => x.hour <= h) ?? rows[0];
      return { speed: r.speed, gust: r.gust, dirFrom: r.dir, min: r.speed * (m.min / Math.max(0.1, m.avg)), max: r.speed * (m.max / Math.max(0.1, m.avg)), tempC: m.tempC, source: 'manuell time-for-time' };
    }
    return { speed: m.avg, gust: m.gust, dirFrom: m.dir, min: m.min, max: m.max, tempC: m.tempC, source: 'scenario' };
  };
}

export interface RouteForecastPoint extends LatLon { d: number; label: string; fc: Forecast }

/**
 * Prognose langs ruten: MET-punkt hver ~15 km. Metode (dokumentert): NÆRMESTE prognosepunkt langs ruten
 * og NÆRMESTE prognosetime – ingen romlig interpolasjon. Utenfor prognosens tidsrom brukes manuell vind og
 * kilden merkes deretter.
 */
export function forecastProvider(points: RouteForecastPoint[], fallback: WindProvider): WindProvider {
  return (t, p, d) => {
    if (!points.length) return fallback(t, p, d);
    const pt = points.reduce((b, x) => (Math.abs(x.d - d) < Math.abs(b.d - d) ? x : b), points[0]);
    const rows = pt.fc.rows;
    const tm = t.getTime();
    const first = Date.parse(rows[0].time), last = Date.parse(rows[rows.length - 1].time);
    if (tm < first - 3600000 || tm > last + 3600000) return { ...fallback(t, p, d), source: 'scenario' };
    const r = rows.reduce((b, x) => (Math.abs(Date.parse(x.time) - tm) < Math.abs(Date.parse(b.time) - tm) ? x : b), rows[0]);
    const s: WindSample = {
      speed: r.windSpeed ?? 0,
      gust: r.windGust ?? (r.windSpeed ?? 0) * 1.4,
      dirFrom: r.windFrom ?? 0,
      min: r.windP10,
      max: r.windP90,
      tempC: r.temp,
      source: 'prognose (MET)',
      pointLabel: pt.label,
    };
    return s;
  };
}
