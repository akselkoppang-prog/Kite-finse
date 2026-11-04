import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import { useStore } from './store';
import { useSimSetup, kiteInput } from './sim';
import { runExpedition, newDay, type DayPlan, type PlanContext, type PlanScenario } from '../lib/sim/expedition';
import { uid } from '../lib/geo';

/** Kontekst for å kjøre en plan (felles for aktiv plan og sammenligning). */
export function usePlanContext(): PlanContext | null {
  const s = useStore();
  const setup = useSimSetup();
  const quiver = s.quivers.find((q) => q.id === s.activeQuiverId);
  return useMemo(() => {
    if (!setup.route || setup.total <= 0) return null;
    return {
      route: setup.route.waypoints,
      total: setup.total,
      tripDate: s.tripDate,
      params: setup.params,
      quiver: quiver?.kiteIds.length ? quiver.kiteIds : ['sonic10'],
      kite: (id: string) => kiteInput(id, s),
      zAt: setup.zAt,
      walkRanges: setup.plan.walkRanges,
      forecast: s.routeForecast?.points ?? null,
      launchMin: s.travel.launchMin,
      navMinPerHour: s.travel.navMinPerHour,
    };
  }, [setup, s.tripDate, quiver, s.routeForecast, s.travel, s.kiteModelEdits, s.calibTracks, s.kiteOverrides]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useActivePlan(): PlanScenario {
  const plans = useStore((s) => s.plans);
  const id = useStore((s) => s.activePlanId);
  return plans.find((p) => p.id === id) ?? plans[0];
}

function useExpeditionCompute() {
  const plan = useActivePlan();
  const ctx = usePlanContext();
  const days = useMemo(() => (ctx && plan ? runExpedition(plan, ctx) : []), [plan, ctx]);
  return { plan, ctx, days };
}

type Exp = ReturnType<typeof useExpeditionCompute>;
const ExpCtx = createContext<Exp | null>(null);

/** Beregner aktiv plan ÉN gang for hele appen (kart, dagplan, varsler, toppfelt deler resultatet). */
export function ExpeditionProvider({ children }: { children: ReactNode }) {
  const v = useExpeditionCompute();
  return createElement(ExpCtx.Provider, { value: v }, children);
}

/** Resultat for aktiv plan – oppdateres umiddelbart når du endrer noe. */
export function useExpedition(): Exp {
  const v = useContext(ExpCtx);
  if (!v) throw new Error('useExpedition brukt utenfor ExpeditionProvider');
  return v;
}

/** Endre aktiv plan (uforanderlig oppdatering + synk av antall turdager). */
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

export function savePlanAs(name: string): string {
  const st = useStore.getState();
  const cur = st.plans.find((p) => p.id === st.activePlanId) ?? st.plans[0];
  const id = uid('plan');
  const now = new Date().toISOString();
  st.set({ plans: [...st.plans, { ...structuredClone(cur), id, name, createdAt: now, updatedAt: now }] });
  return id;
}
