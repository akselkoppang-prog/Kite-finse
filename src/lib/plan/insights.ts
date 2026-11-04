import { routeHash, type State } from '../../state/store';
import { forecastFor, gearListOf, loadModel, minTempFor, scenarioFood } from './context';
import { computeBarrierCheck } from '../../state/derived';
import { classify } from '../analysis/terrain';
import { dayWeather, type DayWx } from '../weather/analysis';
import { gearAdvice, type Advice, type GearContext } from '../project/advice';
import { gearTotals } from '../project/model';
import { KITES } from '../../data/kites';
import { haversine } from '../geo';
import type { DayOutcome, PlanScenario } from '../sim/expedition';
import type { Camp, Route } from '../../types';

/**
 * Alt som henger sammen for ETT scenario, regnet ut ett sted: netter, vær langs ruten, utstyr,
 * mat og last. Gear-, mat-, overnatting- og statussidene og eksporten leser herfra, så tallene er like overalt.
 */
export interface Night {
  night: number; // 1 = natten etter dag 1
  date: string;
  camp: Camp | undefined;
  endD: number;
  arrival: number;
  distFromPrevKm: number;
  /** hvor langt teltplassen ligger fra dagens sluttpunkt (km) */
  offRouteKm: number | null;
  capacityOk: boolean | null;
  issues: string[];
}

export interface Insights {
  people: number;
  nights: Night[];
  wx: DayWx[];
  minTempC: number;
  maxGust: number | null;
  gear: ReturnType<typeof gearTotals>;
  gearCtx: GearContext;
  advice: Advice[];
  food: ReturnType<typeof scenarioFood>;
  load: ReturnType<typeof loadModel>;
  hazards: { day: number; level: 'viktig' | 'advarsel' | 'info'; text: string }[];
}

export function availableCamps(st: Pick<State, 'camps'>, planId: string): Camp[] {
  return st.camps.filter((c) => !c.scenarioIds?.length || c.scenarioIds.includes(planId));
}

export function scenarioInsights(st: State, plan: PlanScenario, days: DayOutcome[], route: Route | undefined): Insights {
  const people = Math.max(1, st.team.length);
  const fc = route ? forecastFor(st, route, plan).points : null;
  const wx = days.map((d) => dayWeather(d, fc));
  const minTempC = Math.min(minTempFor(st, route, plan), ...wx.map((w) => w.minTemp ?? Infinity));
  const gusts = wx.map((w) => w.maxGust).filter((x): x is number => x != null);
  const maxGust = gusts.length ? Math.max(...gusts) : plan.days.length ? Math.max(...plan.days.map((d) => (d.windMode === 'manuell' ? d.wind.gust : 0))) || null : null;
  const nights: Night[] = [];
  let prevD = 0;
  days.slice(0, -1).forEach((d, i) => {
    const pd = plan.days[i];
    const camp = st.camps.find((c) => c.id === pd?.campId);
    const issues: string[] = [];
    let capacityOk: boolean | null = null;
    if (camp?.capacity != null) {
      capacityOk = camp.capacity >= people;
      if (!capacityOk) issues.push(`${camp.name} har plass til ${camp.capacity}, dere er ${people}`);
    }
    if (!camp && !d.reason.startsWith('allerede')) issues.push('Ingen overnatting valgt');
    if (d.daylightLeftH != null && d.daylightLeftH < 0.5 && !d.reason.startsWith('allerede')) issues.push('Ankomst nær eller etter mørket');
    let offRouteKm: number | null = null;
    if (camp && route) {
      // avstand fra dagens sluttpunkt til teltplassen
      const p = route.waypoints.reduce((b, w) => (haversine(w, camp) < haversine(b, camp) ? w : b), route.waypoints[0]);
      offRouteKm = haversine(p, camp) / 1000;
    }
    nights.push({ night: i + 1, date: d.date, camp, endD: d.endD, arrival: d.arrival, distFromPrevKm: (d.endD - prevD) / 1000, offRouteKm, capacityOk, issues });
    prevD = d.endD;
  });
  const check = computeBarrierCheck(st, route);
  const terrain = route ? st.terrain[routeHash(route)] : undefined;
  const steepTerrain = !!terrain?.samples.some((t) => classify(t).cls === 'bratt');
  const q = st.quivers.find((x) => x.id === st.activeQuiverId);
  const list = gearListOf(st, plan);
  const gearCtx: GearContext = {
    people,
    nights: nights.length,
    nightKinds: nights.map((n) => n.camp?.kind),
    minTempC,
    maxGustMs: maxGust,
    steepTerrain,
    waterCrossings: check.crossings.length,
    iceCrossings: st.crossings.filter((c) => c.kind === 'is').length,
    quiverKites: (q?.kiteIds ?? []).map((id) => KITES.find((k) => k.id === id)?.name.split(' ').slice(1, 2).join(' ') + ` ${KITES.find((k) => k.id === id)?.size ?? ''} m²`),
    days: plan.days.length,
  };
  const hazards = wx.flatMap((w) => w.hazards.map((h) => ({ day: w.day, ...h })));
  return { people, nights, wx, minTempC, maxGust, gear: gearTotals(list), gearCtx, advice: gearAdvice(list, gearCtx), food: scenarioFood(st, plan, route), load: loadModel(st, plan, route), hazards };
}
