import { useStore, routeHash, type State } from '../../state/store';
import { flush, isDirty, useSave } from '../../storage/persistence';
import { runPlan, routeProfile, profileStats, summarize, type PlanRun, type ProfilePt, type PlanSummary } from '../plan/context';
import { computeBarrierCheck, type BarrierCheck } from '../../state/derived';
import { computeWarnings, type Warning } from '../warnings';
import { addDays } from '../sun';
import type { ExportPrefs } from '../project/meta';
import type { Camp, Route } from '../../types';

/**
 * Øyeblikksbilde for eksport. Alt i en eksport kommer herfra: ÉN tilstand (fryst referanse), ETT scenario,
 * ruten det scenarioet bruker og en fersk beregning. Det du redigerer etterpå påvirker ikke filen,
 * og eksport endrer aldri prosjektet.
 */
export interface ExportSnapshot {
  st: State;
  generatedAt: string;
  projectId: string;
  run: PlanRun;
  summary: PlanSummary;
  route: Route | undefined;
  /** Rute for «Hovedrute/alternativ rute»-valget (kan være en annen enn scenarioets) */
  profile: ProfilePt[];
  stats: ReturnType<typeof profileStats>;
  check: BarrierCheck;
  warnings: Warning[];
  usedCamps: Camp[];
  endDate: string;
  prefs: ExportPrefs;
  savedOk: boolean;
}

export interface SnapshotOpts { planId: string; routeId?: string; prefs: ExportPrefs }

/** Lagrer først (venter på bekreftelse fra IndexedDB). Returnerer false hvis lagring feilet. */
export async function saveBeforeExport(): Promise<boolean> {
  try {
    await flush();
  } catch {
    /* status vises i lagringsindikatoren */
  }
  return !isDirty() && useSave.getState().state !== 'failed';
}

export function takeSnapshot(o: SnapshotOpts, savedOk = true): ExportSnapshot {
  const st = useStore.getState();
  const plan0 = st.plans.find((p) => p.id === o.planId) ?? st.plans.find((p) => p.id === st.mainPlanId) ?? st.plans[0];
  // valgt rute overstyrer scenarioets rute bare i denne eksporten (prosjektet endres ikke)
  const plan = o.routeId && o.routeId !== plan0.routeId ? { ...plan0, routeId: o.routeId } : plan0;
  const run = runPlan(st, plan);
  const route = run.route;
  const profile = route ? routeProfile(route, 200) : [];
  const check = computeBarrierCheck(st, route);
  const terrain = route ? st.terrain[routeHash(route)] : undefined;
  const warnings = computeWarnings({ check, terrain, days: run.days, acks: st.acks, overrides: st.lakeOverrides, tripDate: st.tripDate, destination: st.project.destination });
  const campIds = new Set(plan.days.map((d) => d.campId).filter(Boolean) as string[]);
  return {
    st,
    generatedAt: new Date().toISOString(),
    projectId: useSave.getState().projectId,
    run,
    summary: summarize(run),
    route,
    profile,
    stats: profileStats(profile),
    check,
    warnings,
    usedCamps: st.camps.filter((c) => campIds.has(c.id)),
    endDate: st.project.endDate ?? addDays(st.tripDate, plan.days.length - 1),
    prefs: o.prefs,
    savedOk,
  };
}
