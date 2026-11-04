/**
 * Kite-spesifikasjoner med kilde for HVER verdi. Research gjort 2026-11-04 via websøk (utviklingsmiljøet
 * kunne ikke åpne produsentsidene direkte, så verdiene er lest fra søkeresultater som siterer sidene).
 *
 * kind:
 *  produsent  – fra produsentens egne sider/tabeller
 *  forhandler – fra forhandler som gjengir produsentdata (kan avvike / gjelde annen årsmodell)
 *  test       – uavhengig test/anmeldelse
 *  beregnet   – utledet fra andre verdier
 *  antakelse  – modellantakelse (ikke data)
 *  ukjent     – ikke funnet
 *  manuell    – lagt inn av deg
 *
 * Vindområder fra produsenter gjelder normalt kitesurf på vann med ~75–80 kg rytter, IKKE snø med pulk.
 */
export type SpecKind = 'produsent' | 'forhandler' | 'test' | 'beregnet' | 'antakelse' | 'ukjent' | 'manuell';
export interface SpecValue {
  v: string | number | null;
  kind: SpecKind;
  src?: string; // ref-id
  note?: string;
}

export const REFS: Record<string, { name: string; url: string }> = {
  'fs-sonic4': { name: 'Flysurfer – SONIC⁴ datatabell', url: 'https://flysurfer.com/?p=50251' },
  's2as-sonic': { name: 'S2AS – Flysurfer Sonic (spesifikasjoner)', url: 'https://s2as.com/products/sonic' },
  'pks-sonicfr': { name: 'Powerkiteshop – vindtabell-merknad (75 kg)', url: 'https://powerkiteshop.com/flysurfer-sonic-fr.htm' },
  'fs-peak5': { name: 'Flysurfer – PEAK5 datatabell (via oversettelsesproxy)', url: 'https://flysurfer-com.translate.goog/project/peak5/?_x_tr_sl=en&_x_tr_tl=es&_x_tr_hl=es&_x_tr_pto=tc' },
  'pks-peak': { name: 'Powerkiteshop – «Flysurfer Peak» (modell uklar)', url: 'https://powerkiteshop.com/products/flysurfer-peak' },
  'varuste-peak5': { name: 'Varuste.net – Peak5 4.0 (kategori: åpne/single-skin)', url: 'https://varuste.net/p115663/flysurfer-peak5-4-0-kite-only' },
  'maxtrack-hl1': { name: 'Maxtrack – Ozone Hyperlink V1', url: 'https://maxtrack.com/product/ozone-hyperlink-v1/' },
  'varuste-hl1': { name: 'Varuste.net – Hyperlink V1 (kategori: lukkede celler)', url: 'https://varuste.net/en/p82654/ozone-hyperlink-v1-complete-5m²' },
  'oz-hl1-cat': { name: 'Ozone Hyperlink V1 katalog (Nauticexpo)', url: 'https://pdf.nauticexpo.com/pdf/ozone/hyperlink-v1/26469-100726.html' },
  'fs-stoke2': { name: 'Flysurfer – STOKE2', url: 'https://wp.flysurfer.com/project/stoke2/' },
  's2as-stoke2': { name: 'S2AS – Flysurfer Stoke 2', url: 'https://www.s2as.com/products/flysurfer-stoke-2-kitesurf-kite' },
  'ik-stoke2': { name: 'IKSURFMAG – Stoke 2 10m 2019 test', url: 'https://www.iksurfmag.com/?p=83472' },
  'naish-pivot': { name: 'Naish – Pivot (gjeldende modell)', url: 'https://www.naish.com/products/pivot' },
  'naish-pivot-ltd': { name: 'Naish – Pivot LTD', url: 'https://www.naish.com/products/pivot-ltd' },
  'naish-nvision': { name: 'Naish – Pivot Nvision 2026', url: 'https://www.naish.com/products/pivot-nvision-2026' },
  'fs-soul': { name: 'Flysurfer – SOUL (1. generasjon) datatabell', url: 'https://flysurfer.com/project/soul/' },
  'tksc-soul': { name: 'The Kitesurf Centre – Flysurfer Soul', url: 'https://www.thekitesurfcentre.com/product/flysurfer-soul' },
  'fs-soul2': { name: 'Flysurfer – SOUL2', url: 'https://flysurfer.com/project/soul2/' },
  'pks-soul2': { name: 'Powerkiteshop – Flysurfer Soul 2', url: 'https://powerkiteshop.com/products/flysurfer-soul-2' },
  'bs-soul2': { name: 'Boardsports.eu – Flysurfer Soul 2', url: 'https://www.boardsports.eu/flysurfer-soul-2-kite-only' },
};

export const SPEC_FIELDS: [string, string][] = [
  ['generation', 'Modell / generasjon'],
  ['type', 'Kitetype'],
  ['areaConvention', 'Arealkonvensjon'],
  ['projectedArea', 'Projisert areal (m²)'],
  ['aspectRatio', 'Aspect ratio (flat)'],
  ['cellsStruts', 'Celler / struts'],
  ['weightKg', 'Vekt (kg)'],
  ['bridle', 'Bridle / bar / liner'],
  ['windRangeKn', 'Vindområde produsent (knop)'],
  ['sweetSpotKn', 'Sweet spot (knop)'],
  ['refRider', 'Referanserytter'],
  ['intended', 'Tiltenkt bruk'],
  ['depower', 'Depower'],
  ['relaunch', 'Relansering'],
  ['turning', 'Svingegenskaper'],
  ['upwind', 'Upwind'],
  ['lowWind', 'Lettvind'],
  ['gusts', 'Kasthåndtering / stabilitet'],
  ['snow', 'Snøkite-egnethet'],
  ['limits', 'Begrensninger'],
];

const U: SpecValue = { v: null, kind: 'ukjent' };
const A = (v: string, note?: string): SpecValue => ({ v, kind: 'antakelse', note });

export const KITE_SPECS: Record<string, Record<string, SpecValue>> = {
  peak4: {
    generation: { v: 'PEAK5 (5. generasjon)', kind: 'manuell', note: 'Fra din inventarliste «Peak V5»' },
    type: { v: 'Foil – åpen celle / single-skin-kategori', kind: 'forhandler', src: 'varuste-peak5', note: 'Forhandlerkategori; bekreft mot manual' },
    areaConvention: { v: 'Flysurfer oppgir flat størrelse (4) og projisert areal separat', kind: 'produsent', src: 'fs-peak5' },
    projectedArea: { v: 3.2, kind: 'produsent', src: 'fs-peak5' },
    aspectRatio: { v: 4.0, kind: 'produsent', src: 'fs-peak5' },
    cellsStruts: { v: '29 celler', kind: 'produsent', src: 'fs-peak5' },
    weightKg: { v: 0.7, kind: 'produsent', src: 'fs-peak5', note: 'Duk + komplett bridle + mixer' },
    bridle: U,
    windRangeKn: { v: '15–28 ideelt (4–32 ytterpunkter)', kind: 'forhandler', src: 'pks-peak', note: 'Usikkert om tallene gjelder PEAK5; produsentens tabell er et bilde som ikke ble lest' },
    sweetSpotKn: U,
    refRider: { v: 'ca. 75 kg', kind: 'produsent', src: 'fs-peak5' },
    intended: A('Freeride/allround, kompakt sterkvindsfoil'),
    depower: A('Stort depower-område'),
    relaunch: A('God på snø'),
    turning: A('Middels'),
    upwind: A('Middels (lav AR 4,0)'),
    lowWind: A('Svak – liten flate'),
    gusts: A('Tolerant'),
    snow: A('God'),
    limits: A('Lite trekk med 110 kg under ca. 9–10 m/s'),
  },
  hyper7: {
    generation: { v: 'Hyperlink V1', kind: 'manuell' },
    type: { v: 'Foil – lukket celle', kind: 'forhandler', src: 'varuste-hl1' },
    areaConvention: { v: 'Nominell (flat) størrelse 7 m²', kind: 'antakelse' },
    projectedArea: U,
    aspectRatio: { v: 'middels («mid aspect»), tall ikke funnet', kind: 'forhandler', src: 'maxtrack-hl1' },
    cellsStruts: U,
    weightKg: U,
    bridle: { v: 'Minimal bridle; 5-line-sett finnes som tillegg', kind: 'forhandler', src: 'maxtrack-hl1' },
    windRangeKn: { v: '7–18 på land/snø · 11–20 på vann', kind: 'forhandler', src: 'maxtrack-hl1' },
    sweetSpotKn: U,
    refRider: { v: '80 kg', kind: 'forhandler', src: 'maxtrack-hl1' },
    intended: { v: 'Freeride vann og snø (størrelser 5/7/9/12)', kind: 'forhandler', src: 'maxtrack-hl1' },
    depower: A('Middels'),
    relaunch: A('God (lukket celle)'),
    turning: A('Middels–rask'),
    upwind: A('God'),
    lowWind: A('Middels'),
    gusts: A('Middels'),
    snow: A('God'),
    limits: U,
  },
  stoke9: {
    generation: { v: 'STOKE2 (2. generasjon)', kind: 'manuell' },
    type: { v: 'Tube (LEI), 3 struts', kind: 'produsent', src: 'fs-stoke2' },
    areaConvention: { v: 'Nominell (flat) størrelse 9 m²', kind: 'antakelse' },
    projectedArea: U,
    aspectRatio: U,
    cellsStruts: { v: '3 struts', kind: 'produsent', src: 'fs-stoke2' },
    weightKg: U,
    bridle: { v: 'Kort bridle', kind: 'produsent', src: 'fs-stoke2' },
    windRangeKn: { v: 'Zenith-parkering fra 6 knop (ikke et brukbart vindområde)', kind: 'forhandler', src: 's2as-stoke2' },
    sweetSpotKn: U,
    refRider: U,
    intended: { v: 'Wave/freestyle, «allrounder» i 9 m', kind: 'produsent', src: 'fs-stoke2' },
    depower: A('Stort (tube)'),
    relaunch: A('God på vann; på snø avhengig av vind'),
    turning: A('Rask'),
    upwind: A('Middels'),
    lowWind: A('Middels'),
    gusts: A('God'),
    snow: A('Brukbar; blærer stive i kulde, pumpe nødvendig'),
    limits: A('Vekt/volum, pumpe, punkteringsrisiko'),
  },
  sonic10: {
    generation: { v: 'SONIC⁴ (4. generasjon)', kind: 'manuell' },
    type: { v: 'Foil – lukket celle, høy ytelse', kind: 'produsent', src: 'fs-sonic4' },
    areaConvention: { v: 'Flysurfer: flat størrelse 10, projisert separat', kind: 'produsent', src: 'fs-sonic4' },
    projectedArea: { v: 8.32, kind: 'forhandler', src: 's2as-sonic' },
    aspectRatio: { v: 6.4, kind: 'forhandler', src: 's2as-sonic' },
    cellsStruts: { v: '45 celler', kind: 'produsent', src: 'fs-sonic4' },
    weightKg: { v: 1.78, kind: 'produsent', src: 'fs-sonic4', note: 'Duk + komplett bridle + mixer' },
    bridle: { v: 'Bar 52 cm (M), 20 m liner', kind: 'produsent', src: 'fs-sonic4' },
    windRangeKn: { v: '12–33', kind: 'produsent', src: 'fs-sonic4' },
    sweetSpotKn: { v: '15–25', kind: 'produsent', src: 'fs-sonic4' },
    refRider: { v: 'ca. 75 kg', kind: 'forhandler', src: 'pks-sonicfr' },
    intended: A('Freeride/race, effektiv distanse'),
    depower: A('Middels'),
    relaunch: A('God (lukket celle), krever teknikk'),
    turning: A('Middels'),
    upwind: A('Svært god (høy AR)'),
    lowWind: A('God'),
    gusts: A('Mindre tilgivende i rotor'),
    snow: A('God'),
    limits: A('Krever aktiv flyging i turbulens'),
  },
  pivot10: {
    generation: { v: 'Naish Pivot – årsmodell ikke oppgitt', kind: 'manuell', note: 'Legg inn årsmodell – spesifikasjonene varierer per år' },
    type: { v: 'Tube (LEI), 3 struts, middels AR', kind: 'produsent', src: 'naish-pivot' },
    areaConvention: { v: 'Nominell (flat) størrelse 10 m²', kind: 'antakelse' },
    projectedArea: U,
    aspectRatio: { v: '4,5 (LTD) – 4,68 (Nvision 2026)', kind: 'produsent', src: 'naish-pivot-ltd', note: 'Avhenger av årsmodell' },
    cellsStruts: { v: '3 struts', kind: 'produsent', src: 'naish-pivot' },
    weightKg: U,
    bridle: U,
    windRangeKn: { v: '14–28 (gjeldende modell)', kind: 'produsent', src: 'naish-pivot', note: 'Kan avvike for eldre årsmodeller' },
    sweetSpotKn: U,
    refRider: U,
    intended: { v: 'Allround («do-it-all»)', kind: 'test', src: 'naish-pivot' },
    depower: A('Stort'),
    relaunch: A('God (tube)'),
    turning: A('Rask, pivoterende'),
    upwind: A('Middels'),
    lowWind: A('Middels'),
    gusts: A('God'),
    snow: A('Brukbar; kulde, pumpe'),
    limits: A('Vekt/volum, pumpe'),
  },
  soul15: {
    generation: { v: 'SOUL (1. generasjon)', kind: 'manuell' },
    type: { v: 'Foil – lukket celle', kind: 'produsent', src: 'fs-soul' },
    areaConvention: { v: 'Flysurfer: flat størrelse 15, projisert separat', kind: 'produsent', src: 'fs-soul' },
    projectedArea: { v: 12.44, kind: 'produsent', src: 'fs-soul', note: 'Tabellen er udatert; antatt 1. generasjon' },
    aspectRatio: { v: 5.6, kind: 'produsent', src: 'fs-soul' },
    cellsStruts: { v: '41 celler', kind: 'produsent', src: 'fs-soul' },
    weightKg: { v: 2.74, kind: 'produsent', src: 'fs-soul', note: 'Duk + bridle + mixer' },
    bridle: { v: 'Bar 50 cm (60 cm også oppgitt)', kind: 'produsent', src: 'fs-soul' },
    windRangeKn: { v: null, kind: 'ukjent', note: 'Produsentens vindtabell er et bilde – ikke lest' },
    sweetSpotKn: U,
    refRider: { v: 'ca. 75 kg', kind: 'produsent', src: 'fs-soul' },
    intended: A('Lettvind/freeride'),
    depower: A('Middels–stort'),
    relaunch: A('God'),
    turning: A('Middels'),
    upwind: A('God'),
    lowWind: A('Svært god'),
    gusts: A('Stabil'),
    snow: A('God'),
    limits: { v: 'Profildybde 200 cm, spenn 921 cm', kind: 'forhandler', src: 'tksc-soul' },
  },
  soul18: {
    generation: { v: 'SOUL2 (2. generasjon)', kind: 'manuell' },
    type: { v: 'Foil – lukket celle', kind: 'produsent', src: 'fs-soul2' },
    areaConvention: { v: 'Flysurfer: flat størrelse 18, projisert separat', kind: 'produsent', src: 'fs-soul2' },
    projectedArea: { v: 14.93, kind: 'produsent', src: 'fs-soul2' },
    aspectRatio: { v: 5.8, kind: 'produsent', src: 'fs-soul2' },
    cellsStruts: { v: '41 celler', kind: 'produsent', src: 'fs-soul2' },
    weightKg: U,
    bridle: U,
    windRangeKn: { v: '8–14', kind: 'forhandler', src: 'pks-soul2', note: 'Referansetabell' },
    sweetSpotKn: U,
    refRider: U,
    intended: A('Lettvind'),
    depower: A('Middels'),
    relaunch: A('God, tung'),
    turning: A('Treg'),
    upwind: A('God'),
    lowWind: A('Svært god'),
    gusts: A('Krevende ved vindøkning'),
    snow: A('God på hard snø'),
    limits: { v: 'Profildybde 234 cm', kind: 'forhandler', src: 'bs-soul2' },
  },
};

/**
 * Modellparametre per kite (alle ANTAKELSER, redigerbare).
 *  cF       – kraftkoeffisient (horisontal trekkraft / (½ρ·A·W²)) med kiten i kraftposisjon
 *  glide    – systemets glidetall L/D inkl. liner (bestemmer hvor høyt mot tilsynelatende vind)
 *  depower  – andel av kraften som kan tas ut med depower
 *  dynBoost – ekstra kraft ved aktiv sinusflyging i lett vind (oppstart)
 * glide er utledet fra aspect ratio der den er kjent: glide ≈ 1,6 + 0,5·AR (foil) / 1,4 + 0,5·AR (tube).
 */
export interface KiteModel { cF: number; glide: number; depower: number; dynBoost: number }

export function defaultModel(kiteId: string, type: string): KiteModel & { glideKind: SpecKind } {
  const ar = KITE_SPECS[kiteId]?.aspectRatio;
  const tube = /tube|LEI/i.test(type);
  const arNum = typeof ar?.v === 'number' ? ar.v : kiteId === 'pivot10' ? 4.5 : kiteId === 'hyper7' ? 5.0 : tube ? 4.2 : 5.0;
  const glide = +((tube ? 1.4 : 1.6) + 0.5 * arNum).toFixed(2);
  const depower = kiteId === 'peak4' ? 0.6 : tube ? 0.65 : kiteId === 'sonic10' ? 0.5 : 0.55;
  return { cF: tube ? 0.8 : /åpen|single/i.test(String(KITE_SPECS[kiteId]?.type?.v)) ? 0.78 : 0.85, glide, depower, dynBoost: 1.4, glideKind: typeof ar?.v === 'number' ? 'beregnet' : 'antakelse' };
}

export const knToMs = (kn: number) => kn * 0.514444;
