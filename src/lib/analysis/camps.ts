import * as turf from '@turf/turf';
import { haversine, DIRS8, type Dir8, type LatLon } from '../geo';
import type { TerrainSample } from './terrain';
import type { Barrier } from './barriers';
import type { Place } from '../../types';

/** Teltplass-vurdering fra DTM + barrierer + avbruddspunkter. Alltid «beregnet kandidat – ikke befart». */
export interface CampEval {
  slope: number | null;
  z: number | null;
  shelter: { dir: Dir8; rise: number | null };
  exposure: string;
  avalanche: { level: 'lav' | 'middels' | 'høy' | 'ukjent'; text: string };
  waterDist: number | null;
  waterText: string;
  bail?: { name: string; distKm: number };
  score: number;
  flags: string[];
}

export function evaluateCamp(p: LatLon, t: TerrainSample | undefined, windFrom: Dir8, barriers: Barrier[], places: Place[]): CampEval {
  const flags: string[] = [];
  let score = 0.5;
  const slope = t?.slope ?? null;
  if (slope == null) flags.push('Ingen DTM-data – kjør terrenganalyse');
  else if (slope < 4) score += 0.2;
  else if (slope < 8) score += 0.05;
  else {
    score -= 0.3;
    flags.push(`Helning ${slope.toFixed(0)}° – krever mye snøarbeid`);
  }
  const rise = t?.upwindRise[windFrom] ?? null;
  let exposure = 'Ukjent';
  if (rise != null) {
    if (rise > 80) {
      exposure = `Kraftig le mot ${windFrom}-vind (${Math.round(rise)} m høyere terreng oppvind) – fare for fokk/drivsnø-akkumulering`;
      score += 0.05;
      flags.push('Lesider samler snø – sjekk at du ikke ligger under en lebratt skavl');
    } else if (rise > 20) {
      exposure = `Moderat le mot ${windFrom}-vind (+${Math.round(rise)} m)`;
      score += 0.2;
    } else {
      exposure = `Eksponert for ${windFrom}-vind`;
      score -= 0.1;
    }
  }
  if ((t?.tpi600 ?? 0) > 25) {
    score -= 0.15;
    flags.push('Rygg/topp – maksimal vindeksponering');
  }
  if ((t?.tpi600 ?? 0) < -40) flags.push('Dyp forsenkning – kaldluftsjø, mulig fokk');
  let avalanche: CampEval['avalanche'] = { level: 'ukjent', text: 'Ikke vurdert (mangler DTM)' };
  if (t?.maxNearSlope != null) {
    if (t.maxNearSlope >= 30) {
      avalanche = { level: 'høy', text: `Terreng ≥30° innen 150 m (${Math.round(t.maxNearSlope)}°) – mulig utløpsområde. IKKE leir her.` };
      score -= 1;
    } else if (t.maxNearSlope >= 25) {
      avalanche = { level: 'middels', text: `Terreng ${Math.round(t.maxNearSlope)}° innen 150 m – vurder utløp ovenfra` };
      score -= 0.3;
    } else avalanche = { level: 'lav', text: `Brattest ${Math.round(t.maxNearSlope)}° innen 150 m (kun DTM-ring – sjekk bratthetskart for lengre utløp)` };
  }
  let waterDist: number | null = null;
  let waterText = 'Vann/magasin ikke lastet – last NVE-data';
  const water = barriers.filter((b) => b.kind !== 'sone');
  if (water.length) {
    const pt = turf.point([p.lon, p.lat]);
    for (const b of water) {
      try {
        const inside = turf.booleanPointInPolygon(pt, b.feature);
        const lines = turf.polygonToLine(b.feature);
        const fc = lines.type === 'FeatureCollection' ? lines.features : [lines];
        const dist = inside ? 0 : Math.min(...fc.map((l) => turf.pointToLineDistance(pt, l as never, { units: 'meters' })));
        if (waterDist == null || dist < waterDist) {
          waterDist = dist;
          waterText = `${Math.round(dist)} m til «${b.name}» (${b.kind})`;
        }
      } catch {
        /* */
      }
    }
    if (waterDist != null && waterDist < 1) {
      score -= 2;
      flags.push('PÅ VANN/MAGASIN – utelukket');
    } else if (waterDist != null && waterDist < 150) {
      score -= 0.3;
      flags.push('Nær strand: overvann/svak is og kaldluft – trekk opp på land');
    }
  }
  const bail = places
    .filter((pl) => pl.role.includes('avbrudd'))
    .map((pl) => ({ name: pl.name, distKm: haversine(p, pl) / 1000 }))
    .sort((a, b) => a.distKm - b.distKm)[0];
  if (bail && bail.distKm < 8) score += 0.1;
  return { slope, z: t?.z ?? null, shelter: { dir: windFrom, rise }, exposure, avalanche, waterDist, waterText, bail, score, flags };
}

/** Kandidater rundt en måldistanse. Returnerer de beste spredte (≥1,5 km fra hverandre). */
export function campCandidates(samples: TerrainSample[], targetD: number, windowM: number, windFrom: Dir8, barriers: Barrier[], places: Place[], n = 3) {
  const pool = samples.filter((s) => Math.abs(s.d - targetD) <= windowM && s.z != null);
  const scored = pool.map((s) => ({ s, ev: evaluateCamp(s, s, windFrom, barriers, places) })).sort((a, b) => b.ev.score - a.ev.score);
  const chosen: typeof scored = [];
  for (const c of scored) {
    if (c.ev.score < 0) continue;
    if (chosen.every((x) => haversine(x.s, c.s) > 1500)) chosen.push(c);
    if (chosen.length >= n) break;
  }
  return chosen;
}

export { DIRS8 };
