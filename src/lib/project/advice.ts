import { tagsOf, type GearList } from './model';
import type { Camp } from '../../types';

/**
 * Utstyrsråd for ett scenario. Reglene er enkle og forklarer alltid HVORFOR – du bestemmer selv.
 * Inndata kommer fra scenarioet (netter og overnattingstype), prognosen (kulde, vind), ruten
 * (bratt terreng, vann/is, krysninger) og teamet (antall personer).
 */
export interface GearContext {
  people: number;
  nights: number;
  /** overnattingstype per natt (undefined = ikke valgt → regn med telt) */
  nightKinds: (Camp['kind'] | undefined)[];
  minTempC: number;
  maxGustMs: number | null;
  steepTerrain: boolean;
  waterCrossings: number;
  iceCrossings: number;
  quiverKites: string[];
  days: number;
}
export interface Advice { key: string; tag?: string; level: 'mangler' | 'uegnet' | 'unødvendig' | 'tips'; text: string; why: string; cat?: string }

const has = (list: GearList | undefined, tag: string) => (list?.items ?? []).filter((g) => tagsOf(g).includes(tag));
const qty = (list: GearList | undefined, tag: string) => has(list, tag).reduce((a, g) => a + Math.max(0, g.qty), 0);

export function gearAdvice(list: GearList | undefined, c: GearContext): Advice[] {
  const out: Advice[] = [];
  const need = (tag: string, text: string, why: string, cat: string, min = 1) => {
    if (qty(list, tag) < min) out.push({ key: `m-${tag}`, tag, level: 'mangler', text: min > 1 ? `${text} (${qty(list, tag)}/${min})` : text, why, cat });
  };
  const tentNights = c.nightKinds.filter((k) => k == null || k === 'telt' || k === 'leirplass').length;
  const allHut = c.nights > 0 && c.nightKinds.every((k) => k === 'hytte');
  // alltid
  need('førstehjelp', 'Førstehjelpsutstyr', 'Alltid med på vidda', 'Sikkerhet');
  need('nødpeiler', 'Nødpeiler / satellittkommunikator', 'Mobildekning er dårlig på Hardangervidda', 'Sikkerhet');
  need('kart', 'Papirkart', 'Reserve når GPS/batteri svikter', 'Navigasjon');
  need('kompass', 'Kompass', 'Navigasjon i dårlig sikt', 'Navigasjon');
  need('vindsekk', 'Vindsekk / nødbivuakk', 'Ly hvis noen blir skadet eller været snur', 'Sikkerhet');
  need('briller', 'Briller/goggles', 'Snøblindhet og fokksnø', 'Klær', c.people);
  need('reparasjon', 'Reparasjonssett', `${c.days} dager med kite, ski og pulk`, 'Reparasjon');
  if (c.days >= 2) need('strøm', 'Powerbank/batterier', 'Kulde tapper batterier raskt', 'Elektronikk');
  // overnatting
  if (tentNights > 0) {
    const tentCap = has(list, 'telt').reduce((a, g) => a + (g.capacity ?? 2) * Math.max(0, g.qty), 0);
    if (tentCap < c.people) out.push({ key: 'm-telt', tag: 'telt', level: 'mangler', text: tentCap ? `Teltplass til ${c.people} (har ${tentCap})` : 'Telt', why: `${tentNights} natt/netter i telt eller uten valgt hytte`, cat: 'Ly og telt' });
    need('spade', 'Snøspade', 'Teltplass, le-mur og redning', 'Sikkerhet');
    need('brenner', 'Brenner', 'Snøsmelting og varm mat i telt', 'Kjøkken og brensel');
    need('brensel', 'Brensel', 'Se matplanen for mengde', 'Kjøkken og brensel');
    need('kjele', 'Kjele', 'Snøsmelting', 'Kjøkken og brensel');
    need('underlag', `Liggeunderlag${c.minTempC < -10 ? ' (2 per person i streng kulde)' : ''}`, `Isolasjon mot snø ned mot ${Math.round(c.minTempC)} °C`, 'Sovesystem', c.people * (c.minTempC < -10 ? 2 : 1));
    if ((c.maxGustMs ?? 0) >= 15) need('snøfester', 'Ekstra snøfester/barduner', `Vindkast opptil ${Math.round(c.maxGustMs!)} m/s i prognosen`, 'Ly og telt');
  } else if (allHut && has(list, 'telt').length) {
    out.push({ key: 'u-telt', tag: 'telt', level: 'unødvendig', text: 'Telt', why: 'Alle netter er på hytte – men vurder telt eller vindsekk som reserve hvis dere ikke rekker frem' });
  }
  if (c.nights > 0) need('sovepose', 'Sovepose', 'Overnatting', 'Sovesystem', allHut ? 0 : c.people);
  for (const g of has(list, 'sovepose')) if (g.ratingC != null && g.ratingC > c.minTempC + 5)
    out.push({ key: `x-${g.id}`, tag: 'sovepose', level: 'uegnet', text: `${g.name}: komfort ${g.ratingC} °C`, why: `Ned mot ${Math.round(c.minTempC)} °C forventet – velg komfort ≤ ${Math.round(c.minTempC + 5)} °C eller legg til innerpose/dunjakke` });
  // kulde og vind
  if (c.minTempC <= -15) {
    need('dunjakke', 'Dunjakke / varmejakke', `Ned mot ${Math.round(c.minTempC)} °C`, 'Klær', c.people);
    need('ansiktsmaske', 'Ansiktsmaske / balaclava', 'Vindavkjøling og frostskader i ansiktet', 'Klær', c.people);
  }
  need('votter', 'Votter (+ reserve)', 'Kitebar og kulde', 'Klær', c.people);
  // terreng og vann
  if (c.steepTerrain) {
    need('skredsøker', 'Skredsøker', 'Ruten passerer bratt terreng (≥ 30°)', 'Sikkerhet', c.people);
    need('søkestang', 'Søkestang', 'Skredterreng', 'Sikkerhet', c.people);
  }
  if (c.waterCrossings + c.iceCrossings > 0) {
    need('ispigger', 'Ispigger', `${c.waterCrossings + c.iceCrossings} vann-/iskryssing(er) på ruten`, 'Sikkerhet', c.people);
    need('kasteline', 'Kasteline', 'Redning ved gjennombrudd i isen', 'Sikkerhet');
  }
  // kites
  if (c.quiverKites.length && !has(list, 'kite').length) out.push({ key: 'm-kite', tag: 'kite', level: 'tips', text: `Kites: ${c.quiverKites.join(', ')}`, why: 'Kitene du har valgt er ikke med i utstyrslisten (vekten telles ikke)' });
  // uten vekt
  const noKg = (list?.items ?? []).filter((g) => g.kg == null).length;
  if (noKg) out.push({ key: 'kg', level: 'tips', text: `${noKg} ting uten vekt`, why: 'Typisk vekt brukes i beregningen til du legger inn din egen' });
  return out;
}
