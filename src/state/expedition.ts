import { createContext, createElement, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useStore } from './store';
import { useProfile } from './derived';
import { runExpedition, newDay, type DayPlan, type PlanScenario } from '../lib/sim/expedition';
import { buildPlanContext, routeOf, runPlan, type PlanRun } from '../lib/plan/context';
import { uid } from '../lib/geo';

export function useActivePlan(): PlanScenario {
  const plans = useStore((s) => s.plans);
  const id = useStore((s) => s.activePlanId);
  return plans.find((p) => p.id === id) ?? plans[0];
}

/** Felt i tilstanden som påvirker beregningen (alt annet ignoreres → færre omberegninger). */
function useCalcInputs() {
  return useStore((s) => [s.routes, s.activeRouteId, s.terrain, s.quivers, s.activeQuiverId, s.simParams, s.riderKg, s.pulkKg, s.snow, s.tripDate, s.routeForecast, s.travel, s.kiteModelEdits, s.calibTracks, s.kiteOverrides] as const, (a, b) => a.every((x, i) => x === b[i]));
}

function useExpeditionCompute() {
  const plan = useActivePlan();
  const inputs = useCalcInputs();
  const route = useStore((s) => routeOf(s, plan));
  // laster DTM-høyder for ruten; når de kommer, regnes planen ut på nytt
  const { profile } = useProfile(route);
  const ctx = useMemo(() => (route ? buildPlanContext(useStore.getState(), route) : null), [route, profile, ...inputs]); // eslint-disable-line react-hooks/exhaustive-deps
  const days = useMemo(() => (ctx && plan ? runExpedition(plan, ctx) : []), [plan, ctx]);
  return { plan, ctx, days, route };
}

type Exp = ReturnType<typeof useExpeditionCompute>;
const ExpCtx = createContext<Exp | null>(null);

/** Holder aktivt scenario og aktiv rute i takt: å åpne et scenario viser ruten det bruker, og bytter du rute, følger scenarioet med. */
function useScenarioRouteSync() {
  const activePlanId = useStore((s) => s.activePlanId);
  const activeRouteId = useStore((s) => s.activeRouteId);
  useEffect(() => {
    const st = useStore.getState();
    const p = st.plans.find((x) => x.id === activePlanId);
    if (p?.routeId && p.routeId !== st.activeRouteId && st.routes.some((r) => r.id === p.routeId)) st.set({ activeRouteId: p.routeId });
  }, [activePlanId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const st = useStore.getState();
    const p = st.plans.find((x) => x.id === st.activePlanId);
    if (p && activeRouteId && p.routeId !== activeRouteId) st.set({ plans: st.plans.map((x) => (x.id === p.id ? { ...x, routeId: activeRouteId } : x)) });
  }, [activeRouteId]);
}

/** Beregner aktivt scenario ÉN gang for hele appen (kart, dagplan, varsler, toppfelt deler resultatet). */
export function ExpeditionProvider({ children }: { children: ReactNode }) {
  useScenarioRouteSync();
  const v = useExpeditionCompute();
  return createElement(ExpCtx.Provider, { value: v }, children);
}

/** Resultat for aktivt scenario – oppdateres umiddelbart når du endrer noe. */
export function useExpedition(): Exp {
  const v = useContext(ExpCtx);
  if (!v) throw new Error('useExpedition brukt utenfor ExpeditionProvider');
  return v;
}

/** Kjør flere scenarioer (sammenligning) – hvert mot sin egen rute. */
export function usePlanRuns(ids: string[]): PlanRun[] {
  const plans = useStore((s) => s.plans);
  const inputs = useCalcInputs();
  const key = ids.join('|');
  return useMemo(() => {
    const st = useStore.getState();
    return ids.map((id) => plans.find((p) => p.id === id)).filter((p): p is PlanScenario => !!p).map((p) => runPlan(st, p));
  }, [key, plans, ...inputs]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Endre aktivt scenario (uforanderlig oppdatering + synk av antall turdager). Andre scenarioer røres aldri. */
export function updatePlan(fn: (p: PlanScenario) => PlanScenario) {
  const st = useStore.getState();
  const cur = st.plans.find((p) => p.id === st.activePlanId) ?? st.plans[0];
  const next = { ...fn(cur), updatedAt: new Date().toISOString() };
  st.set({ plans: st.plans.map((p) => (p.id === cur.id ? next : p)), tripDays: next.days.length });
}

export function updateDay(i: number, patch: Partial<DayPlan>) {
  updatePlan((p) => ({ ...p, days: p.days.map((d, j) => (j === i ? { ...d, ...patch } : d)) }));
}

export function setDayCount(n: number) {
  updatePlan((p) => {
    const days = [...p.days];
    while (days.length < n) days.push(newDay({ ...days[days.length - 1], id: uid('day'), target: { mode: 'auto' }, campId: undefined }));
    return { ...p, days: days.slice(0, n) };
  });
}

/* ---------- scenarioer ---------- */

/** Kopi av et scenario (dype kopier – endringer i kopien påvirker aldri originalen). */
export function duplicatePlan(id: string, name?: string, open = true): string {
  const st = useStore.getState();
  const src = st.plans.find((p) => p.id === id) ?? st.plans[0];
  const nid = uid('plan');
  const now = new Date().toISOString();
  const copy: PlanScenario = { ...structuredClone(src), id: nid, name: name ?? `${src.name} (kopi)`, createdAt: now, updatedAt: now, routeId: src.routeId ?? st.activeRouteId ?? undefined };
  copy.days = copy.days.map((d) => ({ ...d, id: uid('day') }));
  st.set({ plans: [...st.plans, copy], ...(open ? { activePlanId: nid } : {}) });
  return nid;
}

/** «Lagre som nytt scenario»: kopi av aktivt scenario. Det aktive beholdes uendret. */
export function savePlanAs(name: string): string {
  return duplicatePlan(useStore.getState().activePlanId, name, false);
}

export function renamePlan(id: string, name: string) {
  const st = useStore.getState();
  if (!name.trim()) return;
  st.set({ plans: st.plans.map((p) => (p.id === id ? { ...p, name: name.trim(), updatedAt: new Date().toISOString() } : p)) });
}

export function setPlanNote(id: string, note: string) {
  const st = useStore.getState();
  st.set({ plans: st.plans.map((p) => (p.id === id ? { ...p, note, updatedAt: new Date().toISOString() } : p)) });
}

export function setMainPlan(id: string) {
  const st = useStore.getState();
  if (st.plans.some((p) => p.id === id)) {
    st.set({ mainPlanId: id });
    st.log('annet', `Satte «${st.plans.find((p) => p.id === id)!.name}» som hovedplan`);
  }
}

/** Slett et scenario. Hovedplanen kan ikke slettes (velg en annen hovedplan først). */
export function deletePlan(id: string): boolean {
  const st = useStore.getState();
  if (id === st.mainPlanId || st.plans.length < 2) return false;
  const plans = st.plans.filter((p) => p.id !== id);
  st.set({ plans, compareIds: st.compareIds.filter((x) => x !== id), activePlanId: st.activePlanId === id ? st.mainPlanId : st.activePlanId });
  st.log('annet', `Slettet scenario «${st.plans.find((p) => p.id === id)?.name}»`);
  return true;
}

export const SCENARIO_FORMAT = 'kite-scenario';

/** Del et scenario: egen fil med scenarioet, ruten det bruker og teltplassene det peker på. */
export function scenarioFile(id: string) {
  const st = useStore.getState();
  const plan = st.plans.find((p) => p.id === id);
  if (!plan) throw new Error('Fant ikke scenarioet');
  const route = routeOf(st, plan);
  const campIds = new Set(plan.days.map((d) => d.campId).filter(Boolean));
  return {
    format: SCENARIO_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    project: st.project.name,
    tripDate: st.tripDate,
    plan: { ...plan, routeId: route?.id },
    route,
    camps: st.camps.filter((c) => campIds.has(c.id)).map((c) => ({ ...c, attachments: undefined })),
  };
}

/** Importer et delt scenario som NYTT scenario (ruten legges til som ny rute hvis den mangler). Ingenting overskrives. */
export function importScenario(json: string): string {
  const f = JSON.parse(json);
  if (f.format !== SCENARIO_FORMAT || !f.plan) throw new Error('Ikke en scenariofil');
  const st = useStore.getState();
  const idMap = new Map<string, string>();
  let routes = st.routes;
  let routeId: string | undefined = undefined;
  if (f.route) {
    const same = st.routes.find((r) => r.id === f.route.id && JSON.stringify(r.waypoints.map((w) => [w.lat, w.lon])) === JSON.stringify(f.route.waypoints.map((w: { lat: number; lon: number }) => [w.lat, w.lon])));
    if (same) routeId = same.id;
    else {
      routeId = uid('route');
      routes = [...routes, { ...f.route, id: routeId, name: `${f.route.name} (fra scenario)`, visible: true }];
    }
  }
  const camps = [...st.camps];
  for (const c of f.camps ?? []) {
    const nid = uid('camp');
    idMap.set(c.id, nid);
    camps.push({ ...c, id: nid, name: `${c.name}`, role: c.role });
  }
  const now = new Date().toISOString();
  const id = uid('plan');
  const plan: PlanScenario = { ...f.plan, id, name: `${f.plan.name} (importert)`, routeId, createdAt: now, updatedAt: now, days: f.plan.days.map((d: DayPlan) => ({ ...d, id: uid('day'), campId: d.campId ? idMap.get(d.campId) : undefined })) };
  st.set({ routes, camps, plans: [...st.plans, plan] });
  st.log('annet', `Importerte scenario «${plan.name}»`);
  return id;
}
