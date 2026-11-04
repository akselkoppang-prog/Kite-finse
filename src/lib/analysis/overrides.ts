import * as turf from '@turf/turf';
import type { LakeOverride } from '../../types';
import type { Crossing } from './barriers';
import type { Feature } from 'geojson';

/**
 * Overstyringsregler (whitelist). En overstyring betyr at DU har akseptert kryssingen i planen.
 * Den endrer ALDRI NVE-status, og den overstyrer aldri andre farer (dam, inntak, egne forbudte soner).
 */
export type OverrideState = 'aktiv' | 'utløpt' | 'utenfor periode' | 'deaktivert' | 'utløper før avreise';

export function overrideState(o: LakeOverride, tripDate: string, today = new Date().toISOString().slice(0, 10)): OverrideState {
  if (!o.active) return 'deaktivert';
  if (o.expires && o.expires < today) return 'utløpt';
  if (o.scope === 'tur' && o.tripDate && o.tripDate !== tripDate) return 'utenfor periode';
  if (o.scope === 'sesong' && o.seasonFrom && o.seasonTo) {
    const md = tripDate.slice(5);
    const inside = o.seasonFrom <= o.seasonTo ? md >= o.seasonFrom && md <= o.seasonTo : md >= o.seasonFrom || md <= o.seasonTo;
    if (!inside) return 'utenfor periode';
  }
  if (o.expires && o.expires < tripDate) return 'utløper før avreise';
  return 'aktiv';
}

export function reviewPending(o: LakeOverride): boolean {
  return o.reviewRequired && !o.reviewedAt;
}

export interface CrossingEval extends Crossing {
  override?: LakeOverride;
  overrideState?: OverrideState;
  /** Farer som en overstyring IKKE fjerner */
  hazards: string[];
  blocking: boolean;
  label: 'VIKTIG' | 'BRUKERGODKJENT' | 'ADVARSEL';
}

export function evaluateCrossings(
  crossings: Crossing[],
  overrides: LakeOverride[],
  ctx: { routeId: string; tripDate: string; dams: Feature[] },
): CrossingEval[] {
  return crossings.map((c) => {
    const hazards: string[] = [];
    // Dammer/inntak nær kryssingen (innen 500 m)
    try {
      const line = turf.lineString([[c.entry.lon, c.entry.lat], [c.exit.lon, c.exit.lat]]);
      for (const d of ctx.dams) {
        const pt = d.geometry.type === 'Point' ? (d as Feature<GeoJSON.Point>) : turf.centroid(d as never);
        const dist = turf.pointToLineDistance(pt, line, { units: 'meters' });
        if (dist < 500) hazards.push(`Dam/inntak ${Math.round(dist)} m fra kryssingen – strøm, råker og usikker is`);
      }
    } catch {
      /* ugyldig geometri */
    }
    if (c.barrier.kind === 'sone' && c.barrier.status === 'RØD') hazards.push('Egen forbudt sone – kan ikke overstyres');
    const candidates = overrides.filter((o) => o.barrierKey === c.barrier.id);
    const matching = candidates.filter((o) => {
      if (!o.segment) return true;
      if (o.segment.routeId !== ctx.routeId) return false;
      return c.fromD / 1000 <= o.segment.toKm && c.toD / 1000 >= o.segment.fromKm;
    });
    // Aktiv overstyring først, ellers den nyeste (for å vise riktig status, f.eks. «utløpt»)
    const applicable = matching.find((o) => overrideState(o, ctx.tripDate) === 'aktiv') ?? [...matching].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const st = applicable ? overrideState(applicable, ctx.tripDate) : undefined;
    const overrideOk = !!applicable && (st === 'aktiv') && c.barrier.kind !== 'sone';
    const red = c.barrier.status === 'RØD';
    const blocking = red && (!overrideOk || hazards.length > 0);
    const label = blocking ? 'VIKTIG' : overrideOk ? 'BRUKERGODKJENT' : 'ADVARSEL';
    return { ...c, override: applicable, overrideState: st, hazards, blocking, label };
  });
}
