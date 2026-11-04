import type { Kite } from '../../data/kites';

/**
 * Kitevalg-modell. BEREGNET og forenklet – IKKE sikkerhetsgrenser.
 *
 * Idé: kraft fra kite ∝ areal × v² × ytelsesfaktor. Nødvendig trekk ∝ (rytter+pulk) × friksjon (+ helning).
 * Vi skalerer et referansevindu for en 10 m² foil med 110 kg på pakket snø (5,5–12 m/s, faglig tommelfingerregel)
 * til hver kite. Du kan overstyre vinduet per kite med egen erfaring/produsentdata.
 */
export type Snow = 'skare' | 'pakket' | 'løs' | 'dyp';
export const SNOW_MU: Record<Snow, { mu: number; text: string }> = {
  skare: { mu: 0.035, text: 'Skare / hardpakket' },
  pakket: { mu: 0.05, text: 'Vindpakket / fast' },
  løs: { mu: 0.09, text: 'Løs nysnø (≤20 cm)' },
  dyp: { mu: 0.14, text: 'Dyp / våt snø' },
};
export type Terrain = 'flatt' | 'kupert' | 'motbakke';
export const TERRAIN_ADD: Record<Terrain, { grade: number; text: string }> = {
  flatt: { grade: 0, text: 'Flat vidde' },
  kupert: { grade: 0.015, text: 'Kupert (±3 %)' },
  motbakke: { grade: 0.05, text: 'Lang motbakke (≈8 %)' },
};
export type Goal = 'rolig' | 'effektiv' | 'fart';

export interface KiteInput {
  wind: number;
  gust: number;
  courseAngle: number; // vinkel mellom kurs og vind (0 = rett mot)
  snow: Snow;
  pulkKg: number;
  riderKg: number;
  terrain: Terrain;
  goal: Goal;
}

export interface KiteWindow { low: number; high: number; custom: boolean }

export function defaultWindow(k: Kite, totalKg: number, snow: Snow, terrain: Terrain): KiteWindow {
  const ref = { low: 5.5, high: 12, area: 10, kg: 110, mu: SNOW_MU.pakket.mu };
  const need = (totalKg * (SNOW_MU[snow].mu + TERRAIN_ADD[terrain].grade)) / (ref.kg * ref.mu);
  const typeAdj = k.type === 'tube (LEI)' ? 1.08 : k.type === 'åpen-celle foil' ? 1.03 : 1;
  const f = Math.sqrt((ref.area / (k.size * k.perf)) * need) * typeAdj;
  // høy grense skalerer mindre med last (overpower styres av areal, ikke pulk)
  const fh = Math.sqrt(ref.area / (k.size * k.perf)) * typeAdj;
  return { low: +(ref.low * f).toFixed(1), high: +(ref.high * fh).toFixed(1), custom: false };
}

export interface KiteVerdict {
  kite: Kite;
  window: KiteWindow;
  status: 'aktuell' | 'grensetilfelle' | 'for lite trekk' | 'overpower';
  score: number;
  reasons: string[];
}

export function evaluate(kites: Kite[], input: KiteInput, overrides: Record<string, { low: number; high: number }>): KiteVerdict[] {
  const totalKg = input.riderKg + input.pulkKg;
  const gustRatio = input.wind > 0 ? input.gust / input.wind : 1;
  const upwindNeed = input.courseAngle < 70 ? (70 - input.courseAngle) / 70 : 0; // 0–1
  return kites
    .map((k) => {
      const o = overrides[k.id];
      const w: KiteWindow = o ? { ...o, custom: true } : defaultWindow(k, totalKg, input.snow, input.terrain);
      const reasons: string[] = [];
      let status: KiteVerdict['status'] = 'aktuell';
      let score = 0;
      const span = Math.max(0.1, w.high - w.low);
      const pos = (input.wind - w.low) / span; // 0 = nedre grense, 1 = øvre
      if (input.wind < w.low) {
        status = input.wind > w.low - 1 ? 'grensetilfelle' : 'for lite trekk';
        reasons.push(`Middelvind ${input.wind} m/s under beregnet nedre grense ${w.low} m/s for ${totalKg} kg på «${SNOW_MU[input.snow].text}».`);
      } else if (input.gust > w.high * 1.1) {
        status = input.wind > w.high ? 'overpower' : 'grensetilfelle';
        reasons.push(`Kast ${input.gust} m/s over beregnet øvre grense ${w.high} m/s (+10 %).`);
      } else {
        reasons.push(`Innenfor beregnet vindu ${w.low}–${w.high} m/s.`);
      }
      // Sweet spot avhenger av mål: rolig = nedre/midt, fart = øvre-midt
      const target = input.goal === 'rolig' ? 0.45 : input.goal === 'effektiv' ? 0.35 : 0.55;
      score = 1 - Math.min(1, Math.abs(pos - target) * 1.4);
      if (gustRatio > 1.4) {
        score -= 0.15 * (k.size / 10);
        reasons.push(`Byget vind (kast/middel ${gustRatio.toFixed(2)}) – mindre kite gir bedre kontroll; store flater straffes.`);
      }
      if (upwindNeed > 0) {
        score += (k.upwind - 0.7) * upwindNeed;
        reasons.push(`Kurs ${Math.round(input.courseAngle)}° mot vinden: upwind-evne vektlegges (faglig vurdering ${Math.round(k.upwind * 100)} %).`);
      }
      if (k.type === 'tube (LEI)') {
        score -= 0.1;
        reasons.push('Tube-kite: husk pumpe, kulde (stive blærer) og ekstra vekt – vurdering, ikke utelukkelse.');
      }
      if (k.type === 'åpen-celle foil' && gustRatio > 1.5) reasons.push('Åpen-celle kan kollapse i turbulens – fly unna lefronter.');
      if (status === 'for lite trekk' || status === 'overpower') score = Math.min(score, 0) - 1;
      return { kite: k, window: w, status, score, reasons };
    })
    .sort((a, b) => b.score - a.score);
}
