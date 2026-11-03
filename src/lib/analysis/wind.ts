import { angleDiff, bearing, densify, DIR_DEG, type Dir8, type LatLon } from '../geo';
import type { TerrainSample } from './terrain';

/**
 * Vind-/kursanalyse. BEREGNET: kursvinkel mot vind fra rutegeometri + (hvis kjørt) DTM-basert le-indikator.
 * Antagelser: vinden følger ikke terrenget (ingen strømningsmodell), retning er "vind fra".
 */
export type Course = 'motvind' | 'kryss' | 'slør' | 'bredslør' | 'medvind';

export interface WindLeg {
  from: LatLon;
  to: LatLon;
  d0: number;
  d1: number;
  heading: number;
  angle: number; // 0 = rett mot vinden
  course: Course;
  courseText: string;
  score: number; // 0–1 kite-egnethet (beregnet)
  lee: 'le' | 'turbulens' | 'eksponert' | null;
  notes: string[];
}

export function courseOf(angle: number): { course: Course; text: string; score: number } {
  if (angle < 45) return { course: 'motvind', text: 'Motvind – må krysse (stagvending), lav effektivitet med 40 kg pulk', score: 0.15 };
  if (angle < 70) return { course: 'kryss', text: 'Kryss høyt mot vinden – krever god upwind-kite og hard snø', score: 0.5 };
  if (angle < 140) return { course: 'slør', text: 'Halvvind/slør – mest effektivt', score: 1 };
  if (angle < 165) return { course: 'bredslør', text: 'Bredslør – bra, noe lavere kontroll i kast', score: 0.85 };
  return { course: 'medvind', text: 'Rett medvind – sikk-sakk nødvendig, kiten kan «falle» inn mot vinduskant', score: 0.6 };
}

export function windLegs(route: LatLon[], windFrom: Dir8, stepM = 1000, terrain?: TerrainSample[]): WindLeg[] {
  const s = densify(route, stepM);
  const legs: WindLeg[] = [];
  const wd = DIR_DEG[windFrom];
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1], b = s[i];
    if (b.d - a.d < 1) continue;
    const h = bearing(a, b);
    const angle = angleDiff(h, wd);
    const c = courseOf(angle);
    let score = c.score;
    const notes: string[] = [];
    let lee: WindLeg['lee'] = null;
    if (terrain?.length) {
      const mid = (a.d + b.d) / 2;
      const t = terrain.reduce((best, x) => (Math.abs(x.d - mid) < Math.abs(best.d - mid) ? x : best), terrain[0]);
      const rise = t.upwindRise[windFrom];
      if (rise != null && rise > 80) {
        lee = 'turbulens';
        score *= 0.35;
        notes.push(`Terreng ${Math.round(rise)} m høyere oppvind (≤1,5 km): sannsynlig vindskygge/rotor og kast`);
      } else if (rise != null && rise > 35) {
        lee = 'le';
        score *= 0.65;
        notes.push(`Delvis le: terreng ${Math.round(rise)} m høyere oppvind`);
      } else if ((t.tpi600 ?? 0) > 25) {
        lee = 'eksponert';
        notes.push('Eksponert rygg/topp: forvent sterkere vind og kast enn prognose');
      }
      if ((t.maxNearSlope ?? 0) >= 30) notes.push('Bratt terreng nær ruten – ikke kite inn i skredterreng');
    }
    legs.push({ from: a, to: b, d0: a.d, d1: b.d, heading: h, angle, course: c.course, courseText: c.text, score, lee, notes });
  }
  return legs;
}

export function summarize(legs: WindLeg[]) {
  const total = legs.reduce((s, l) => s + (l.d1 - l.d0), 0) || 1;
  const by = (f: (l: WindLeg) => boolean) => legs.filter(f).reduce((s, l) => s + (l.d1 - l.d0), 0) / total;
  return {
    good: by((l) => l.score >= 0.75),
    upwind: by((l) => l.course === 'motvind'),
    lee: by((l) => l.lee === 'le' || l.lee === 'turbulens'),
    exposed: by((l) => l.lee === 'eksponert'),
    meanScore: legs.reduce((s, l) => s + l.score * (l.d1 - l.d0), 0) / total,
  };
}

export const scoreColor = (s: number) => (s >= 0.75 ? '#22c55e' : s >= 0.5 ? '#eab308' : s >= 0.3 ? '#f97316' : '#ef4444');
