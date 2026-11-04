import { uid } from '../geo';
import type { PackItem } from '../../data/packing';

/* =====================================================================================
 * Planleggingsdata som henger sammen med scenarioene: krysninger, utstyrslister, mat,
 * team, oppgaver og utgifter. Alt er prosjektdata (lagres per prosjekt i IndexedDB).
 * ===================================================================================== */

/* ---------- krysninger (ferje, bro, elv, båt, vei, is …) ---------- */
export type CrossingKind = 'ferje' | 'båt' | 'bro' | 'elv' | 'vei' | 'is' | 'grense' | 'annet';
export const CROSSING_TEXT: Record<CrossingKind, string> = { ferje: 'Ferje', båt: 'Båttransport', bro: 'Bro', elv: 'Elvekryssing', vei: 'Vei/jernbane', is: 'Iskryssing', grense: 'Grense/sjekkpunkt', annet: 'Annet' };
export interface Crossing {
  id: string;
  name: string;
  kind: CrossingKind;
  lat: number;
  lon: number;
  /** fast tidsbruk ved krysningen (minutter) – f.eks. ta av ski, bære pulk */
  transferMin: number;
  /** forventet ventetid uten rutetabell (minutter) */
  waitMin: number;
  /** avganger «08:00, 12:30, 16:00» – tom = ingen rutetabell */
  schedule?: string;
  /** i drift fra–til (MM-DD), tom = hele året */
  seasonFrom?: string;
  seasonTo?: string;
  note?: string;
  /** hvor tallene kommer fra (rutetabell-lenke, egen erfaring …) */
  source?: string;
}

/** Neste avgang etter et klokkeslett (desimaltimer) – null hvis ingen flere den dagen. */
export function nextDeparture(schedule: string | undefined, atH: number): number | null {
  if (!schedule?.trim()) return atH;
  const times = schedule
    .split(/[,;\s]+/)
    .map((t) => /^(\d{1,2})[:.](\d{2})$/.exec(t.trim()))
    .filter(Boolean)
    .map((m) => +m![1] + +m![2] / 60)
    .sort((a, b) => a - b);
  return times.find((t) => t >= atH - 1e-6) ?? null;
}

export function inSeason(c: Pick<Crossing, 'seasonFrom' | 'seasonTo'>, date: string): boolean {
  if (!c.seasonFrom || !c.seasonTo) return true;
  const md = date.slice(5);
  return c.seasonFrom <= c.seasonTo ? md >= c.seasonFrom && md <= c.seasonTo : md >= c.seasonFrom || md <= c.seasonTo;
}

/** Ventetid + overgang ved ankomst. `blocked` = kan ikke krysses denne dagen (sesong/ingen flere avganger). */
export function crossingDelay(c: Crossing, date: string, arriveH: number): { waitH: number; transferH: number; departH: number; blocked: string | null } {
  if (!inSeason(c, date)) return { waitH: 0, transferH: 0, departH: arriveH, blocked: `${c.name}: ikke i drift ${date.slice(8, 10)}.${date.slice(5, 7)} (sesong ${c.seasonFrom}–${c.seasonTo})` };
  const transferH = Math.max(0, c.transferMin) / 60;
  if (c.schedule?.trim()) {
    const dep = nextDeparture(c.schedule, arriveH);
    if (dep == null) return { waitH: 0, transferH, departH: arriveH, blocked: `${c.name}: ingen flere avganger etter ${hh(arriveH)}` };
    return { waitH: dep - arriveH, transferH, departH: dep + transferH, blocked: null };
  }
  const waitH = Math.max(0, c.waitMin) / 60;
  return { waitH, transferH, departH: arriveH + waitH + transferH, blocked: null };
}
const hh = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;

/* ---------- utstyr ---------- */
export const GEAR_CATS = ['Ly og telt', 'Sovesystem', 'Klær', 'Kjøkken og brensel', 'Navigasjon', 'Sikkerhet', 'Elektronikk', 'Reparasjon', 'Kite og ski', 'Pulk og transport', 'Hygiene og diverse'] as const;
export interface GearItem {
  id: string;
  name: string;
  cat: string;
  /** vekt per stk (kg) */
  kg?: number;
  qty: number;
  /** 'felles' eller id til et teammedlem */
  owner?: string;
  carry: 'pulk' | 'kropp';
  packed: boolean;
  /** komforttemperatur for sovepose/klær (°C) */
  ratingC?: number;
  /** antall personer (telt) */
  capacity?: number;
  /** nøkkelord for anbefalinger (telt, sovepose, skredsøker …) – fylles automatisk fra navnet */
  tags?: string[];
  note?: string;
}
export interface GearList { id: string; name: string; items: GearItem[]; updatedAt?: string }

/** Nøkkelord gjenkjent fra navnet – brukes av anbefalingene. */
const TAG_RULES: [string, RegExp][] = [
  ['telt', /\btelt\b|stormtelt|tunneltelt|kuppeltelt/i],
  ['sovepose', /sovepose/i],
  ['underlag', /underlag/i],
  ['brenner', /brenner|primus|stove/i],
  ['brensel', /brensel|drivstoff|bensin|rødsprit|gass/i],
  ['kjele', /kjele|gryte/i],
  ['skredsøker', /skredsøker|sender\/mottaker/i],
  ['søkestang', /søkestang/i],
  ['spade', /spade/i],
  ['snøsag', /snøsag/i],
  ['ispigger', /ispigg|isbrodd|isprodd/i],
  ['kasteline', /kasteline|redningsline|tau\b/i],
  ['førstehjelp', /førstehjelp/i],
  ['nødpeiler', /inreach|plb|satellitt|nødpeil/i],
  ['gps', /\bgps\b/i],
  ['kart', /\bkart\b|n50/i],
  ['kompass', /kompass/i],
  ['strøm', /powerbank|batteri|solcelle/i],
  ['dunjakke', /dunjakke|varmejakke|primaloft/i],
  ['skall', /skall/i],
  ['votter', /votte|hansk/i],
  ['briller', /briller|goggles/i],
  ['ansiktsmaske', /ansiktsmaske|balaclava/i],
  ['vindsekk', /vindsekk|bivy|nødbivuakk/i],
  ['reparasjon', /reparasjon|reservedel|tape|verktøy/i],
  ['hjelm', /hjelm/i],
  ['kite', /\bkite/i],
  ['hodelykt', /hodelykt|lykt/i],
  ['solkrem', /solkrem|leppepomade/i],
  ['snøfester', /snøplugg|snøfeste|bardun/i],
];
export function autoTags(name: string): string[] {
  return TAG_RULES.filter(([, r]) => r.test(name)).map(([t]) => t);
}
export const tagsOf = (g: GearItem) => [...new Set([...(g.tags ?? []), ...autoTags(g.name)])];

const CAT_MAP: Record<string, string> = { Telt: 'Ly og telt', Sovesystem: 'Sovesystem', Klær: 'Klær', Mat: 'Kjøkken og brensel', Brensel: 'Kjøkken og brensel', Navigasjon: 'Navigasjon', Skredutstyr: 'Sikkerhet', Nødkommunikasjon: 'Sikkerhet', 'Batteri og lading': 'Elektronikk', Kites: 'Kite og ski', 'Barer og liner': 'Kite og ski', Skiutstyr: 'Kite og ski', Pulk: 'Pulk og transport' };
const TYPICAL_KG: Record<string, number> = { telt: 4.2, sovepose: 2.0, underlag: 0.6, brenner: 0.5, brensel: 0.8, kjele: 0.4, skredsøker: 0.25, søkestang: 0.3, spade: 0.7, snøsag: 0.4, førstehjelp: 0.4, nødpeiler: 0.15, gps: 0.25, kart: 0.15, kompass: 0.05, strøm: 0.4, dunjakke: 0.7, skall: 0.9, votter: 0.3, briller: 0.2, ansiktsmaske: 0.1, vindsekk: 0.4, reparasjon: 0.5, hjelm: 0.4, kite: 2.5 };

/** Gjør den gamle pakkelisten om til en utstyrsliste (ingen data går tapt – teksten blir navnet). */
export function gearFromPacking(packing: PackItem[]): GearItem[] {
  return packing.map((p) => {
    const tags = autoTags(p.text);
    return {
      id: p.id,
      name: p.text,
      cat: CAT_MAP[p.cat] ?? p.cat,
      kg: p.kg,
      qty: 1,
      owner: 'felles',
      carry: CAT_MAP[p.cat] === 'Klær' ? 'kropp' : 'pulk',
      packed: p.packed,
      tags,
      ratingC: /sovepose/i.test(p.text) ? -20 : undefined,
      capacity: /\btelt\b/i.test(p.text) ? 2 : undefined,
    };
  });
}

/** Typisk vekt brukt i beregninger når du ikke har lagt inn vekt (vises som «antatt»). */
export function assumedKg(g: GearItem): number | undefined {
  if (g.kg != null) return g.kg;
  for (const t of tagsOf(g)) if (TYPICAL_KG[t] != null) return TYPICAL_KG[t];
  return undefined;
}

export interface GearTotals { pulkKg: number; bodyKg: number; assumedKg: number; unknown: number; perOwner: Record<string, number>; packedPct: number; count: number }
export function gearTotals(list: GearList | undefined): GearTotals {
  const t: GearTotals = { pulkKg: 0, bodyKg: 0, assumedKg: 0, unknown: 0, perOwner: {}, packedPct: 0, count: 0 };
  if (!list) return t;
  let packed = 0;
  for (const g of list.items) {
    const kg = assumedKg(g);
    const w = (kg ?? 0) * Math.max(0, g.qty);
    if (kg == null) t.unknown++;
    else if (g.kg == null) t.assumedKg += w;
    if (g.carry === 'pulk') t.pulkKg += w;
    else t.bodyKg += w;
    const o = g.owner || 'felles';
    t.perOwner[o] = (t.perOwner[o] ?? 0) + w;
    if (g.packed) packed++;
  }
  t.count = list.items.length;
  t.packedPct = list.items.length ? packed / list.items.length : 0;
  return t;
}

/* ---------- mat ---------- */
export type MealSlot = 'frokost' | 'lunsj' | 'middag' | 'snacks';
export const SLOTS: MealSlot[] = ['frokost', 'lunsj', 'middag', 'snacks'];
export const SLOT_TEXT: Record<MealSlot, string> = { frokost: 'Frokost', lunsj: 'Lunsj', middag: 'Middag', snacks: 'Snacks og drikke' };
export interface FoodItem { id: string; name: string; kcal: number; protein: number; fat: number; carbs: number; /** ml per 100 g (pakkevolum) */ ml: number; /** g per pakning (handleliste) */ packG?: number }
export interface MealTemplate { id: string; name: string; slot: MealSlot; items: { foodId: string; g: number }[] }
export interface FoodDay { meals: Partial<Record<MealSlot, string>> }
export type Activity = 'rolig' | 'normal' | 'hard' | 'ekstrem';
export const ACTIVITY_KCAL: Record<Activity, number> = { rolig: 3000, normal: 3800, hard: 4600, ekstrem: 5500 };
export interface FoodPlan { activity: Activity; reserveDays: number; days: FoodDay[]; /** l brensel per person per dag (snøsmelting) */ fuelLPerPersonDay: number; waterLPerPersonDay: number }

export const DEFAULT_FOODS: FoodItem[] = [
  { id: 'havregryn', name: 'Havregryn/müsli', kcal: 380, protein: 12, fat: 8, carbs: 62, ml: 220, packG: 1000 },
  { id: 'melkepulver', name: 'Helmelkspulver', kcal: 500, protein: 26, fat: 27, carbs: 38, ml: 200, packG: 500 },
  { id: 'turmiddag', name: 'Frysetørket turmiddag', kcal: 480, protein: 20, fat: 18, carbs: 58, ml: 450, packG: 150 },
  { id: 'potetmos', name: 'Potetmospulver', kcal: 360, protein: 8, fat: 1, carbs: 78, ml: 250, packG: 200 },
  { id: 'knekkebrod', name: 'Knekkebrød', kcal: 360, protein: 11, fat: 5, carbs: 64, ml: 450, packG: 250 },
  { id: 'ost', name: 'Hard ost', kcal: 400, protein: 27, fat: 32, carbs: 0, ml: 110, packG: 500 },
  { id: 'spekepolse', name: 'Spekepølse', kcal: 460, protein: 25, fat: 40, carbs: 2, ml: 110, packG: 300 },
  { id: 'smor', name: 'Smør/olje', kcal: 740, protein: 0.5, fat: 82, carbs: 0.5, ml: 110, packG: 250 },
  { id: 'notter', name: 'Nøtter', kcal: 620, protein: 20, fat: 54, carbs: 14, ml: 160, packG: 300 },
  { id: 'sjokolade', name: 'Sjokolade', kcal: 540, protein: 7, fat: 31, carbs: 57, ml: 110, packG: 200 },
  { id: 'bar', name: 'Energibar', kcal: 420, protein: 10, fat: 15, carbs: 60, ml: 130, packG: 50 },
  { id: 'suppe', name: 'Pulversuppe', kcal: 380, protein: 9, fat: 10, carbs: 62, ml: 250, packG: 70 },
  { id: 'kakao', name: 'Kakaopulver', kcal: 400, protein: 6, fat: 4, carbs: 82, ml: 200, packG: 500 },
  { id: 'sportsdrikk', name: 'Sportsdrikkpulver', kcal: 380, protein: 0, fat: 0, carbs: 95, ml: 170, packG: 500 },
];
export const DEFAULT_MEALS: MealTemplate[] = [
  { id: 'm-frokost', name: 'Havregryn med melk og nøtter', slot: 'frokost', items: [{ foodId: 'havregryn', g: 130 }, { foodId: 'melkepulver', g: 40 }, { foodId: 'notter', g: 30 }, { foodId: 'smor', g: 15 }] },
  { id: 'm-lunsj', name: 'Knekkebrød, ost og pølse', slot: 'lunsj', items: [{ foodId: 'knekkebrod', g: 80 }, { foodId: 'ost', g: 70 }, { foodId: 'spekepolse', g: 70 }, { foodId: 'smor', g: 20 }] },
  { id: 'm-middag', name: 'Turmiddag + suppe', slot: 'middag', items: [{ foodId: 'suppe', g: 35 }, { foodId: 'turmiddag', g: 160 }, { foodId: 'smor', g: 25 }, { foodId: 'potetmos', g: 40 }] },
  { id: 'm-snacks', name: 'Nøtter, sjokolade, bar og drikke', slot: 'snacks', items: [{ foodId: 'notter', g: 80 }, { foodId: 'sjokolade', g: 100 }, { foodId: 'bar', g: 100 }, { foodId: 'kakao', g: 40 }, { foodId: 'sportsdrikk', g: 60 }] },
];
export const defaultDay = (): FoodDay => ({ meals: { frokost: 'm-frokost', lunsj: 'm-lunsj', middag: 'm-middag', snacks: 'm-snacks' } });
export const newFoodPlan = (days: number): FoodPlan => ({ activity: 'hard', reserveDays: 1, days: Array.from({ length: days }, defaultDay), fuelLPerPersonDay: 0.2, waterLPerPersonDay: 4 });

export interface Nutrition { kcal: number; protein: number; fat: number; carbs: number; g: number; ml: number }
const ZERO: Nutrition = { kcal: 0, protein: 0, fat: 0, carbs: 0, g: 0, ml: 0 };
export function mealNutrition(t: MealTemplate | undefined, foods: FoodItem[]): Nutrition {
  if (!t) return { ...ZERO };
  return t.items.reduce((a, it) => {
    const f = foods.find((x) => x.id === it.foodId);
    if (!f) return a;
    const k = it.g / 100;
    return { kcal: a.kcal + f.kcal * k, protein: a.protein + f.protein * k, fat: a.fat + f.fat * k, carbs: a.carbs + f.carbs * k, g: a.g + it.g, ml: a.ml + f.ml * k };
  }, { ...ZERO });
}
export function dayNutrition(day: FoodDay | undefined, meals: MealTemplate[], foods: FoodItem[]): Nutrition {
  const n = { ...ZERO };
  for (const s of SLOTS) {
    const m = mealNutrition(meals.find((x) => x.id === day?.meals[s]), foods);
    (Object.keys(n) as (keyof Nutrition)[]).forEach((k) => (n[k] += m[k]));
  }
  return n;
}

/** Energibehov per person per dag: aktivitet + kulde (+5 % per 10 °C under 0) + kroppsvekt. */
export function kcalTarget(activity: Activity, minTempC: number | null, bodyKg = 75): number {
  const cold = minTempC != null && minTempC < 0 ? 1 + (0.05 * -minTempC) / 10 : 1;
  return Math.round((ACTIVITY_KCAL[activity] * cold * (bodyKg / 75) ** 0.75) / 50) * 50;
}

export interface FoodSummary {
  people: number;
  days: number; // reisedager i scenarioet
  totalDays: number; // inkl. reserve
  perDay: Nutrition[]; // per person
  target: number;
  totalKg: number;
  totalL: number;
  waterLPerDay: number;
  fuelL: number;
  /** kg mat igjen ved START av hver dag (etter eventuell påfylling) */
  remainingKgByDay: number[];
  shopping: { food: FoodItem; g: number; packs: number | null }[];
  shortDays: number[]; // dager under 85 % av behovet
}

/** Mat for et scenario. resupplyAfterDay = dager der dere fyller på ved overnattingen (hytte/depot). */
export function foodSummary(plan: FoodPlan, scenarioDays: number, people: number, meals: MealTemplate[], foods: FoodItem[], minTempC: number | null, resupplyAfterDay: number[] = [], bodyKg = 75): FoodSummary {
  const totalDays = scenarioDays + Math.max(0, plan.reserveDays);
  const dayAt = (i: number) => plan.days[i] ?? plan.days[plan.days.length - 1] ?? defaultDay();
  const perDay = Array.from({ length: totalDays }, (_, i) => dayNutrition(dayAt(i), meals, foods));
  const target = kcalTarget(plan.activity, minTempC, bodyKg);
  const kgDay = perDay.map((n) => (n.g * people) / 1000);
  const totalKg = kgDay.reduce((a, b) => a + b, 0);
  const totalL = perDay.reduce((a, n) => a + (n.ml * people) / 1000, 0);
  // kald tur: mer vann (og snø som må smeltes)
  const waterLPerDay = plan.waterLPerPersonDay * (minTempC != null && minTempC < -15 ? 1.1 : 1);
  const fuelL = plan.fuelLPerPersonDay * people * totalDays * (minTempC != null && minTempC < -15 ? 1.15 : 1);
  // gjenværende mat ved start av hver reisedag; påfyll etter angitte dager dekker resten av turen frem til neste påfyll
  const remaining: number[] = [];
  const segStart = [0, ...resupplyAfterDay.filter((d) => d > 0 && d < scenarioDays).sort((a, b) => a - b)];
  for (let i = 0; i < scenarioDays; i++) {
    const next = segStart.find((x) => x > i) ?? totalDays;
    let left = 0;
    for (let k = i; k < next; k++) left += kgDay[k] ?? 0;
    remaining.push(left);
  }
  const sums = new Map<string, number>();
  for (let i = 0; i < totalDays; i++)
    for (const sl of SLOTS) {
      const m = meals.find((x) => x.id === dayAt(i).meals[sl]);
      m?.items.forEach((it) => sums.set(it.foodId, (sums.get(it.foodId) ?? 0) + it.g * people));
    }
  const shopping = [...sums.entries()].map(([id, g]) => ({ food: foods.find((f) => f.id === id)!, g, packs: null as number | null })).filter((x) => x.food).map((x) => ({ ...x, packs: x.food.packG ? Math.ceil(x.g / x.food.packG) : null })).sort((a, b) => b.g - a.g);
  return { people, days: scenarioDays, totalDays, perDay, target, totalKg, totalL, waterLPerDay, fuelL, remainingKgByDay: remaining, shopping, shortDays: perDay.map((n, i) => (n.kcal < target * 0.85 ? i + 1 : 0)).filter(Boolean) };
}

/* ---------- team, oppgaver, utgifter, dokumenter ---------- */
export interface TeamMember { id: string; name: string; role: string; weightKg?: number; phone?: string; note?: string }
export type TaskLinkKind = 'scenario' | 'dag' | 'teltplass' | 'utstyr' | 'km' | 'krysning';
export interface Task {
  id: string;
  title: string;
  done: boolean;
  due?: string;
  assignee?: string;
  milestone?: boolean;
  priority?: 'lav' | 'normal' | 'høy';
  scenarioId?: string;
  link?: { kind: TaskLinkKind; id?: string; day?: number; km?: number };
  note?: string;
  createdAt: string;
  doneAt?: string;
}
export interface Expense { id: string; text: string; amount: number; cat: string; paidBy?: string; scenarioId?: string; date?: string; planned?: boolean }
export interface DocLink { id: string; name: string; url: string; note?: string }

export const DEFAULT_TASKS = (tripDate: string): Task[] => {
  const before = (days: number) => {
    const d = new Date(`${tripDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };
  const now = new Date().toISOString();
  const t = (title: string, days: number, milestone = false, priority: Task['priority'] = 'normal'): Task => ({ id: uid('task'), title, done: false, due: before(days), milestone, priority, createdAt: now });
  return [
    t('Ruten og alternativer gjennomgått (vann, skred, nedstigning)', 30, true, 'høy'),
    t('Transport til start og fra mål bestilt', 21),
    t('Utstyr testet på tur (telt, brenner, kites)', 21, true),
    t('Mat handlet og pakket i dagsposer', 7),
    t('Turplan levert til kontaktperson hjemme', 3, false, 'høy'),
    t('Sjekk værmelding, skredvarsel og is – endelig rute', 2, true, 'høy'),
  ];
};
