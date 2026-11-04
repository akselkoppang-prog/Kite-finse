import { useMemo } from 'react';
import { useStore } from './store';
import { useActiveRoute, useDayPlan, useProfile } from './derived';
import { KITES } from '../data/kites';
import { defaultModel } from '../data/kiteSpecs';
import type { KiteInput, SimParams } from '../lib/sim/physics';
import { simulate, sunRules, type SimInput, type SimResult } from '../lib/sim/route';
import { forecastProvider, manualProvider } from '../lib/sim/wind';
import { calibrationFor } from '../lib/sim/calibration';
import { addDays } from '../lib/sun';
import type { State } from './store';

/** Bygger modell-input for én kite fra spesifikasjoner + dine endringer + personlig kalibrering + dine vindgrenser. */
export function kiteInput(id: string, s: Pick<State, 'kiteModelEdits' | 'calibTracks' | 'simParams' | 'kiteOverrides'>): KiteInput {
  const k = KITES.find((x) => x.id === id)!;
  const m = { ...defaultModel(id, k.type), ...s.kiteModelEdits[id] };
  const cal = s.simParams.usePersonalCalibration ? calibrationFor(id, s.calibTracks)?.factor ?? 1 : 1;
  const personal = s.kiteOverrides[id];
  return { id, area: m.area ?? k.size, cF: m.cF, glide: m.glide, depower: m.depower, dynBoost: m.dynBoost, calib: cal, personal };
}

export function useSimSetup() {
  const s = useStore();
  const route = useActiveRoute();
  const { profile, stats } = useProfile(route);
  const plan = useDayPlan(route);
  const quiver = s.quivers.find((q) => q.id === s.activeQuiverId);
  return useMemo(() => {
    const params: SimParams = { ...s.simParams, riderKg: s.riderKg, pulkKg: s.pulkKg, snow: s.snow };
    const zAt = (d: number) => {
      if (!profile.length) return null;
      let lo = 0, hi = profile.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (profile[mid].d < d) lo = mid;
        else hi = mid;
      }
      const a = profile[lo], b = profile[hi];
      if (a.z == null || b.z == null) return a.z ?? b.z ?? null;
      const t = b.d === a.d ? 0 : (d - a.d) / (b.d - a.d);
      return a.z + (b.z - a.z) * Math.max(0, Math.min(1, t));
    };
    const manual = manualProvider(s.sim.manual);
    const wind = s.sim.useForecast && s.routeForecast?.points.length ? forecastProvider(s.routeForecast.points, manual) : manual;
    const rules = sunRules(s.sim.startHour, s.travel.campSetupH, s.travel.maxMovingH, s.travel.launchMin, s.travel.navMinPerHour);
    const quiverIds = quiver?.kiteIds.length ? quiver.kiteIds : ['sonic10'];
    const total = stats.total;
    const base = (o: Partial<SimInput> & { kiteIds?: string[] }): SimInput => ({
      route: route?.waypoints ?? [],
      fromD: (o.fromD ?? s.sim.fromKm * 1000),
      toD: o.toD ?? (s.sim.toKm != null ? s.sim.toKm * 1000 : total),
      startDate: o.startDate ?? addDays(s.tripDate, s.sim.startDay - 1),
      startHour: o.startHour ?? s.sim.startHour,
      kites: (o.kiteIds ?? (s.sim.kiteMode === 'single' ? [s.sim.kiteId] : quiverIds)).map((id) => kiteInput(id, s)),
      params: o.params ?? params,
      wind: o.wind ?? wind,
      rules: o.rules ?? rules,
      walkRanges: plan.walkRanges,
      zAt,
      dayTargets: o.dayTargets,
      maxDays: o.maxDays ?? (s.sim.multiDay ? 10 : 1),
    });
    const run = (o: Partial<SimInput> & { kiteIds?: string[] } = {}): SimResult | null => (route && total > 0 ? simulate(base(o)) : null);
    return { route, total, params, base, run, quiverIds, wind, rules, zAt, plan };
  }, [route, profile, stats.total, plan, quiver, s.simParams, s.riderKg, s.pulkKg, s.snow, s.sim, s.routeForecast, s.travel, s.tripDate, s.kiteModelEdits, s.calibTracks, s.kiteOverrides]); // eslint-disable-line react-hooks/exhaustive-deps
}
