import type { Status } from '../types';

/**
 * Vannregister. Utgangspunkt: ALLE vann er «IKKE VERIFISERT – KRYSSING IKKE TILLATT I PLANEN»
 * til reguleringsstatus er dokumentert. Geometri hentes fra NVE i nettleseren (ingen tegnede omriss).
 *
 * hrv/lrv fylles KUN der det finnes en publisert kilde (se `source`). Tallene er fra sekundærkilder
 * og må bekreftes i NVE Atlas / magasinregisteret før avreise.
 */
export interface WaterEntry {
  key: string;
  name: string;
  /** Søkeord som matches mot navnefelt i NVE-data. */
  match: string[];
  regulated: 'ja' | 'ukjent';
  hrv?: number;
  lrv?: number;
  system?: string;
  status: Status;
  label: string;
  source: string;
  note: string;
}

export const NOT_VERIFIED = 'IKKE VERIFISERT – KRYSSING IKKE TILLATT I PLANEN';

export const WATERS: WaterEntry[] = [
  {
    key: 'marvatn',
    name: 'Mårvatn (Mår / «Mårfjorden»)',
    match: ['mårvatn', 'marvatn', 'mår'],
    regulated: 'ja',
    hrv: 1121,
    lrv: 1100,
    system: 'Mår kraftverk (Statkraft)',
    status: 'RØD',
    label: 'Regulert magasin – KRYSSING FORBUDT I PLANEN',
    source: 'SNL «Mår kraftverk» (sekundærkilde, hentet 2026-11-03). Må bekreftes mot NVE.',
    note: '21 m reguleringshøyde. Vinternedtapping gir usikker is, overvann, sprekker og hulrom langs strandsonen. Mårbu ligger ved magasinet.',
  },
  {
    key: 'kalhovd',
    name: 'Kalhovdfjorden',
    match: ['kalhovdfjorden', 'kalhovd'],
    regulated: 'ja',
    hrv: 1087,
    lrv: 1076,
    system: 'Mår kraftverk – sammenhengende med Gøystavatn',
    status: 'RØD',
    label: 'Regulert magasin – KRYSSING FORBUDT I PLANEN',
    source: 'SNL/Wikipedia «Kalhovdfjorden» (sekundærkilde, hentet 2026-11-03). Må bekreftes mot NVE.',
    note: 'Oppdemt til samme nivå som Gøystavatn; de to danner ett sammenhengende magasin.',
  },
  {
    key: 'goysta',
    name: 'Gøystavatn',
    match: ['gøystavatn', 'gøystavatnet', 'goystavatn', 'gøysta'],
    regulated: 'ja',
    hrv: 1087,
    lrv: 1076,
    system: 'Mår kraftverk – sammenhengende med Kalhovdfjorden',
    status: 'RØD',
    label: 'Regulert magasin – KRYSSING FORBUDT I PLANEN',
    source: 'Wikipedia «Kalhovdfjorden» (sekundærkilde): samme nivå som Kalhovdfjorden. Må bekreftes mot NVE.',
    note: 'HRV/LRV antatt lik Kalhovdfjorden fordi magasinene er sammenhengende – bekreft.',
  },
  ...['Strengetjønnan', 'Kilsfjorden', 'Sprogen', 'Geitebufjorden', 'Grytefjorden', 'Viervatnet'].map((n) => ({
    key: n.toLowerCase(),
    name: n,
    match: [n.toLowerCase()],
    regulated: 'ja' as const,
    system: 'Del av Kalhovd/Gøysta-magasinet (Mår)',
    status: 'RØD' as Status,
    label: 'Regulert (del av sammenhengende magasin) – KRYSSING FORBUDT I PLANEN',
    source: 'Wikipedia «Kalhovdfjorden» (sekundærkilde, hentet 2026-11-03). Må bekreftes mot NVE.',
    note: 'Oppgitt som del av samme magasin som Kalhovdfjorden/Gøystavatn. HRV/LRV ikke hentet.',
  })),
  {
    key: 'grottetjonn',
    name: 'Grottetjønn',
    match: ['grottetjønn', 'grotte'],
    regulated: 'ja',
    system: 'Mår kraftverk – inntak',
    status: 'RØD',
    label: 'Regulert / kraftinntak – KRYSSING FORBUDT I PLANEN',
    source: 'SNL/Wikipedia (tunnel fra Grottetjønn til Mår kraftverk). Må bekreftes mot NVE.',
    note: 'Inntaksområder kan ha åpne råker og svak is.',
  },
  {
    key: 'mosvatn',
    name: 'Møsvatn',
    match: ['møsvatn', 'mosvatn'],
    regulated: 'ja',
    system: 'Tinn/Vemork-systemet',
    status: 'RØD',
    label: 'Regulert magasin (kjent) – KRYSSING FORBUDT I PLANEN',
    source: 'Allment kjent stort reguleringsmagasin – reguleringshøyder IKKE hentet. Bekreft i NVE.',
    note: 'Relevant for sørlige varianter mot Rjukan Fjellstue.',
  },
];

/** Standard for vann som ikke står i registeret. */
export const UNKNOWN_WATER: Pick<WaterEntry, 'status' | 'label' | 'regulated'> = {
  status: 'RØD',
  label: NOT_VERIFIED,
  regulated: 'ukjent',
};

export function matchWater(name: string | undefined | null): WaterEntry | undefined {
  if (!name) return undefined;
  const n = name.toLowerCase();
  return WATERS.find((w) => w.match.some((m) => n.includes(m)));
}
