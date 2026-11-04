import SunCalc from 'suncalc';
import type { LatLon } from './geo';

/**
 * Sol-beregninger via SunCalc (basert på astronomiske formler fra Astronomy Answers / NOAA-lignende metode,
 * nøyaktighet ~1 min). Ingen tider er hardkodet. Tidssone: Europe/Oslo (sommertid fra 28.03.2027).
 */
export const TZ = 'Europe/Oslo';

export interface SunDay {
  date: string; // YYYY-MM-DD (lokal dato)
  at: LatLon;
  civilDawn: Date | null;
  sunrise: Date | null;
  goldenEnd: Date | null; // slutt på morgenens gylne time
  noon: Date;
  goldenStart: Date | null; // start på kveldens gylne time
  sunset: Date | null;
  civilDusk: Date | null;
  daylightH: number; // soloppgang→solnedgang
  civilH: number; // borgerlig demring→skumring (brukbart lys)
}

const valid = (d: Date) => (Number.isFinite(d.getTime()) ? d : null);
const hours = (a: Date | null, b: Date | null) => (a && b ? (b.getTime() - a.getTime()) / 3600000 : 0);

/** Lokal dato (YYYY-MM-DD) tolkes som middag lokal tid for å treffe riktig døgn. */
export function sunDay(dateStr: string, at: LatLon): SunDay {
  const noonGuess = atLocalHour(dateStr, 12);
  const t = SunCalc.getTimes(noonGuess, at.lat, at.lon);
  const r: SunDay = {
    date: dateStr,
    at,
    civilDawn: valid(t.dawn),
    sunrise: valid(t.sunrise),
    goldenEnd: valid(t.goldenHourEnd),
    noon: t.solarNoon,
    goldenStart: valid(t.goldenHour),
    sunset: valid(t.sunset),
    civilDusk: valid(t.dusk),
    daylightH: 0,
    civilH: 0,
  };
  r.daylightH = hours(r.sunrise, r.sunset);
  r.civilH = hours(r.civilDawn, r.civilDusk);
  return r;
}

export function fmtClock(d: Date | null | undefined): string {
  if (!d) return '–';
  return d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

export function tzLabel(d: Date): string {
  const parts = new Intl.DateTimeFormat('nb-NO', { timeZone: TZ, timeZoneName: 'short' }).formatToParts(d);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? TZ;
}

/** Klokkeslett (lokal Oslo-tid) for en dato + desimaltimer, f.eks. 8.5 → 08:30. */
export function atLocalHour(dateStr: string, h: number): Date {
  return new Date(zonedMidnight(dateStr).getTime() + h * 3600000);
}

function zonedMidnight(dateStr: string): Date {
  // Finn UTC-tidspunktet som tilsvarer 00:00 i Oslo den datoen
  const guess = new Date(`${dateStr}T00:00:00Z`);
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  const [hh, mm] = fmt.format(guess).split(':').map(Number);
  const offsetMin = hh * 60 + mm; // Oslo er foran UTC → 01:00 eller 02:00
  return new Date(guess.getTime() - (offsetMin > 720 ? offsetMin - 1440 : offsetMin) * 60000);
}

export function hourOf(d: Date | null): number | null {
  if (!d) return null;
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  const [hh, mm] = fmt.format(d).split(':').map(Number);
  return hh + mm / 60;
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86400000);
}
