import { haversine, nearestOnRoute, uid, type LatLon } from '../geo';
import type { Route, Waypoint } from '../../types';

/**
 * Ruteveiviseren: én rute = START → (mellompunkter i rekkefølge) → MÅL.
 * Start og mål er alltid første og siste punkt i den lagrede ruten – det er det GPX, kart, dagsetapper,
 * vær og overnatting leser. Her ligger ren logikk (ingen React/Zustand), så den kan testes.
 */
export type PtSource = 'kart' | 'søk' | 'koordinater' | 'rute';
export interface DraftPt extends LatLon { id: string; name?: string; src: PtSource; /** opprinnelig rutepunkt (bevarer navn, notater, høyde …) */ orig?: Waypoint }
export interface DraftShape { start?: DraftPt; finish?: DraftPt; via: DraftPt[]; /** detaljert geometri fra en eksisterende rute (mange punkter) som beholdes mellom start og mål */ kept?: Waypoint[] }
export type Step = 1 | 2 | 3 | 4 | 5 | 6;
export interface RouteDraft extends DraftShape {
  editId?: string;
  name: string;
  /** 'rett' = rette linjer mellom punktene; ellers id til en rute hvis linje følges der punktene ligger nær den */
  geometry: string;
  step: Step;
  useInScenario: boolean;
  /** satt etter lagring – steg 6 (eksport) vises */
  savedAt?: string;
  past: DraftShape[];
  future: DraftShape[];
}

export const MAX_EDITABLE_VIA = 40;
export const FOLLOW_MAX_M = 3000;

export const shapeOf = (d: DraftShape): DraftShape => ({ start: d.start, finish: d.finish, via: d.via, kept: d.kept });
export const pt = (lat: number, lon: number, src: PtSource, name?: string): DraftPt => ({ id: uid('dp'), lat, lon, src, name });

export function newDraft(name = 'Ny rute'): RouteDraft {
  return { name, via: [], geometry: 'rett', step: 1, useInScenario: true, past: [], future: [] };
}

/** Lager et utkast av en lagret rute: første punkt = start, siste = mål. Store GPX-ruter beholder linjen uendret. */
export function draftFromRoute(r: Route): RouteDraft {
  const w = r.waypoints;
  const toPt = (x: Waypoint): DraftPt => ({ id: uid('dp'), lat: x.lat, lon: x.lon, name: x.name, src: 'rute', orig: x });
  const middle = w.slice(1, -1);
  const many = middle.length > MAX_EDITABLE_VIA;
  return {
    ...newDraft(r.name),
    editId: r.id,
    start: w[0] ? toPt(w[0]) : undefined,
    finish: w.length > 1 ? toPt(w[w.length - 1]) : undefined,
    via: many ? [] : middle.map(toPt),
    kept: many ? middle : undefined,
    step: w.length > 1 ? 5 : w.length === 1 ? 2 : 1,
  };
}

export const validLat = (v: number) => Number.isFinite(v) && v >= -90 && v <= 90;
export const validLon = (v: number) => Number.isFinite(v) && v >= -180 && v <= 180;

/**
 * Tolker koordinater skrevet for hånd. Godtar «60.6012, 7.5034», «60,6012 7,5034», «60.6 ; 7.5»,
 * «N 60.6012 E 7.5034», «60°36'4"N 7°30'12"E» og «60°36.07'N 7°30.2'E». Bredde (lat) først, med mindre N/S/Ø/E/V/W sier noe annet.
 */
export function parseCoords(input: string): { lat: number; lon: number; note?: string } | { error: string } {
  const s = input.trim().replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  if (!s) return { error: 'Skriv inn koordinater, f.eks. 60.6012, 7.5034 (bredde, lengde).' };
  // grader/minutter/sekunder med himmelretning
  const dms = /(-?\d+(?:[.,]\d+)?)\s*°\s*(?:(\d+(?:[.,]\d+)?)\s*'\s*)?(?:(\d+(?:[.,]\d+)?)\s*"\s*)?([NSØEVW])?/gi;
  const parts = [...s.matchAll(dms)].filter((m) => m[0].includes('°'));
  let a: number, b: number;
  let latFirst = true;
  if (parts.length === 2) {
    const val = (m: RegExpMatchArray) => {
      const f = (x?: string) => (x ? Number(x.replace(',', '.')) : 0);
      const deg = f(m[1]);
      const v = Math.abs(deg) + f(m[2]) / 60 + f(m[3]) / 3600;
      const h = (m[4] ?? '').toUpperCase();
      return { v: (deg < 0 || h === 'S' || h === 'W' || h === 'V' ? -1 : 1) * v, h };
    };
    const p = val(parts[0]), q = val(parts[1]);
    if (/[EØWV]/.test(p.h) && /[NS]/.test(q.h)) latFirst = false;
    a = p.v; b = q.v;
  } else {
    // desimalgrader, ev. med N/E-bokstaver foran eller bak
    const hem = s.toUpperCase().match(/[NSØEVW]/g) ?? [];
    const clean = s.replace(/[NSØEVWnsøevw]/g, ' ').trim();
    let m = clean.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) m = clean.match(/^(-?\d+(?:,\d+)?)\s*[;\s]\s*(-?\d+(?:,\d+)?)$/);
    if (!m) return { error: 'Forstod ikke koordinatene. Skriv bredde og lengde i desimalgrader, f.eks. 60.6012, 7.5034.' };
    a = Number(m[1].replace(',', '.')); b = Number(m[2].replace(',', '.'));
    if (hem.length === 2 && /[EØWV]/.test(hem[0]) && /[NS]/.test(hem[1])) latFirst = false;
    if (hem[0] === 'S') a = -Math.abs(a);
    if (hem[1] === 'W' || hem[1] === 'V') b = -Math.abs(b);
  }
  const [lat, lon] = latFirst ? [a, b] : [b, a];
  if (!validLat(lat)) return { error: `Bredde (lat) må være mellom −90 og 90 – du skrev ${lat}. Har du byttet om bredde og lengde?` };
  if (!validLon(lon)) return { error: `Lengde (lon) må være mellom −180 og 180 – du skrev ${lon}.` };
  // vanlig feil i Norge: lengde først (7.5, 60.6)
  const note = lat < 30 && lon > 50 && lon <= 90 ? 'Ser ut som lengde og bredde er byttet om (Norge ligger rundt 58–71° nord). Sjekk at punktet havner riktig i kartet.' : undefined;
  return { lat, lon, note };
}

/** Rekkefølgen punktene kobles i. */
export const sequence = (d: DraftShape): DraftPt[] => [d.start, ...d.via, d.finish].filter((x): x is DraftPt => !!x);

/** Hvor et nytt mellompunkt hører hjemme: i etappen der det gir minst omvei. */
export function insertIndex(d: DraftShape, p: LatLon): number {
  const seq = [d.start, ...d.via, d.finish];
  if (!d.start || !d.finish) return d.via.length;
  let best = d.via.length, bestCost = Infinity;
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1]!, b = seq[i]!;
    const cost = haversine(a, p) + haversine(p, b) - haversine(a, b);
    if (cost < bestCost) { bestCost = cost; best = i - 1; }
  }
  return best;
}

/**
 * Bygger rutepunktene: start, (beholdt geometri eller mellompunkter), mål.
 * Med en referanserute følges dens linje på etapper der begge endene ligger innen 3 km fra den; ellers rett linje.
 */
export function buildWaypoints(d: DraftShape & { geometry: string }, ref?: Route): Waypoint[] {
  if (!d.start || !d.finish) return [];
  const asWp = (p: DraftPt, role: 'start' | 'mål' | 'via'): Waypoint => {
    // uendret punkt fra en lagret rute: behold alt (navn, notater, kategori, høyde)
    if (p.orig && p.orig.lat === p.lat && p.orig.lon === p.lon) return { ...p.orig, name: p.name ?? p.orig.name };
    const src = { kart: 'valgt i kartet', søk: 'stedsnavnsøk (Kartverket)', koordinater: 'koordinater skrevet inn', rute: 'flyttet manuelt' }[p.src];
    return {
      ...(p.orig ?? {}),
      id: p.orig?.id ?? uid('wp'),
      lat: p.lat,
      lon: p.lon,
      name: p.name ?? (role === 'start' ? 'Start' : role === 'mål' ? 'Mål' : undefined),
      kind: role === 'via' ? (p.name ? 'stopp' : 'via') : 'stopp',
      eleGpx: undefined,
      source: `${role === 'start' ? 'Startpunkt' : role === 'mål' ? 'Mål' : 'Mellompunkt'} – ${src} ${new Date().toISOString().slice(0, 10)}`,
      dataKind: 'forslag',
    };
  };
  if (d.kept) return [asWp(d.start, 'start'), ...d.kept, asWp(d.finish, 'mål')];
  const seq = sequence(d);
  const out: Waypoint[] = [];
  seq.forEach((p, i) => {
    const role = i === 0 ? 'start' : i === seq.length - 1 ? 'mål' : 'via';
    if (i > 0 && ref && d.geometry === ref.id && ref.waypoints.length > 1) out.push(...followLeg(seq[i - 1], p, ref));
    out.push(asWp(p, role));
  });
  return out;
}

/** Punktene på referanseruten mellom a og b (i riktig retning), eller ingen hvis a/b ligger for langt unna. */
export function followLeg(a: LatLon, b: LatLon, ref: Route): Waypoint[] {
  const na = nearestOnRoute(ref.waypoints, a), nb = nearestOnRoute(ref.waypoints, b);
  if (na.dist > FOLLOW_MAX_M || nb.dist > FOLLOW_MAX_M) return [];
  const w = ref.waypoints;
  const pick = na.d <= nb.d ? w.slice(na.idx + 1, nb.idx + 1) : w.slice(nb.idx + 1, na.idx + 1).reverse();
  return pick.map((x) => ({ ...x, id: uid('wp'), name: undefined, kind: 'via' as const, category: undefined, description: undefined, notes: undefined, attachments: undefined, source: `Fulgt linjen i «${ref.name}»`, dataKind: 'forslag' as const }));
}

export function lengthM(pts: LatLon[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += haversine(pts[i - 1], pts[i]);
  return s;
}

/** Feil som hindrer lagring – med forklaring på hvordan de rettes. Tom liste = OK. */
export function validateDraft(d: RouteDraft): { step: Step; text: string }[] {
  const e: { step: Step; text: string }[] = [];
  const bad = (p?: DraftPt) => !!p && (!validLat(p.lat) || !validLon(p.lon));
  if (!d.start) e.push({ step: 1, text: 'Mangler startpunkt. Trykk i kartet, søk etter et sted eller skriv inn koordinater.' });
  else if (bad(d.start)) e.push({ step: 1, text: 'Startpunktet har ugyldige koordinater.' });
  if (!d.finish) e.push({ step: 2, text: 'Mangler mål. Trykk i kartet, søk etter et sted eller skriv inn koordinater.' });
  else if (bad(d.finish)) e.push({ step: 2, text: 'Målet har ugyldige koordinater.' });
  if (d.via.some(bad)) e.push({ step: 3, text: 'Et mellompunkt har ugyldige koordinater – slett eller flytt det.' });
  if (d.start && d.finish && !d.via.length && !d.kept?.length && haversine(d.start, d.finish) < 20) e.push({ step: 2, text: 'Start og mål er på samme sted. Velg et annet mål, eller legg inn mellompunkter for en rundtur.' });
  if (!d.name.trim()) e.push({ step: 5, text: 'Gi ruten et navn.' });
  return e;
}
