import { useStore, routeHash, type State } from '../../state/store';
import { fetchAlerts, fetchRouteWeather, providerById, samplePoints } from './providers';
import { dayWeather, covers } from './analysis';
import { routeOf, runPlan, forecastFor, summarize } from '../plan/context';
import { addDays } from '../sun';
import type { PlanScenario } from '../sim/expedition';
import type { Route } from '../../types';

/** Hent værdata langs ruten fra valgte leverandører (og farevarsler). Lagres som cache i prosjektet. */
export async function refreshWeather(route: Route, providerIds: string[], onProgress?: (msg: string) => void): Promise<string[]> {
  const errs: string[] = [];
  const key = routeHash(route);
  for (const id of providerIds) {
    const pr = providerById(id);
    onProgress?.(`${pr.short} …`);
    const rw = await fetchRouteWeather(pr, route.waypoints, key, (d, n) => onProgress?.(`${pr.short}: ${d}/${n} punkter`));
    if (!rw.points.length) errs.push(`${pr.short}: ${rw.errors[0] ?? 'ingen data'}`);
    const st = useStore.getState();
    const patch: Partial<State> = { weather: { ...st.weather, [id]: rw } };
    // MET-data brukes også av eldre visninger (Værmelding-fanen)
    if (id === 'met' && rw.points.length) patch.routeForecast = { points: rw.points, fetchedAt: rw.fetchedAt };
    st.set(patch);
  }
  try {
    onProgress?.('Farevarsler …');
    const pts = samplePoints(route.waypoints, 40000);
    const alerts = await fetchAlerts(pts);
    useStore.getState().set({ weatherAlerts: { fetchedAt: new Date().toISOString(), alerts } });
  } catch (e) {
    useStore.getState().set({ weatherAlerts: { fetchedAt: new Date().toISOString(), alerts: [], error: (e as Error).message } });
    errs.push(`Farevarsler: ${(e as Error).message}`);
  }
  return errs;
}

export interface DepartureOption {
  date: string;
  covered: boolean; // hele turen innenfor prognosen
  reached: boolean;
  arrivalDay: number | null;
  arrivalH: number | null;
  remainingKm: number;
  movingH: number;
  important: number;
  warnings: number;
  minDaylightH: number | null;
  score: number;
  summary: string;
}

/** Vurder én avreisedato for et scenario: samme plan, men vind fra prognosen der den finnes. */
export function evaluateDeparture(st: State, plan: PlanScenario, date: string): DepartureOption {
  const route = routeOf(st, plan);
  const fc = route ? forecastFor(st, route, plan).points : null;
  const lastMs = Date.parse(`${addDays(date, plan.days.length - 1)}T18:00:00Z`);
  const covered = !!fc && covers(fc, lastMs);
  const p: PlanScenario = { ...plan, tripDate: date, days: plan.days.map((d) => ({ ...d, windMode: fc ? 'prognose' : d.windMode })) };
  const run = runPlan(st, p);
  const sm = summarize(run);
  const wx = run.days.map((d) => dayWeather(d, fc));
  const important = wx.reduce((a, w) => a + w.hazards.filter((h) => h.level === 'viktig').length, 0);
  const warnings = wx.reduce((a, w) => a + w.hazards.filter((h) => h.level === 'advarsel').length, 0);
  const minDaylightH = run.days.reduce((m, d) => (d.daylightLeftH == null || d.reason.startsWith('allerede') ? m : Math.min(m ?? Infinity, d.daylightLeftH)), null as number | null);
  const reached = !!sm.doneDay;
  const arrivalDay = sm.doneDay?.day ?? null;
  const arrivalH = sm.doneDay?.arrival ?? null;
  // lavere = bedre: tid til mål, straff for farlige forhold, lite dagslys og manglende prognose
  const score = (reached ? (arrivalDay! - 1) * 24 + arrivalH! : 200 + sm.remainingKm * 3) + important * 12 + warnings * 3 + (minDaylightH != null && minDaylightH < 1 ? 6 : 0) + (covered ? 0 : 8);
  const summary = reached ? `Mål dag ${arrivalDay} kl. ${fmtH(arrivalH!)}` : `${sm.remainingKm.toFixed(0)} km igjen etter dag ${plan.days.length}`;
  return { date, covered, reached, arrivalDay, arrivalH, remainingKm: sm.remainingKm, movingH: sm.movingH, important, warnings, minDaylightH, score, summary };
}
const fmtH = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;

/** Prøv flere avreisedatoer (ventende, så siden ikke fryser). */
export async function findBestDepartures(plan: PlanScenario, dates: string[], onProgress?: (i: number, n: number) => void): Promise<DepartureOption[]> {
  const out: DepartureOption[] = [];
  for (let i = 0; i < dates.length; i++) {
    out.push(evaluateDeparture(useStore.getState(), plan, dates[i]));
    onProgress?.(i + 1, dates.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return out.sort((a, b) => a.score - b.score);
}
