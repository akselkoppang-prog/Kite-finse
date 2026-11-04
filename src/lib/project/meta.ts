/** Prosjektets egne opplysninger (navn, beskrivelse, datoer, status, ikon, forsidebilde, notater). */
export type ProjectStatus = 'idé' | 'planlegging' | 'klar' | 'gjennomført';
export const STATUS_TEXT: Record<ProjectStatus, string> = { idé: 'Idé', planlegging: 'Planlegging', klar: 'Klar til tur', gjennomført: 'Gjennomført' };
export const PROJECT_ICONS = ['🪁', '🏔️', '❄️', '⛺', '🧭', '🗺️', '🌬️', '🎿', '🏕️', '⭐'];

export interface ProjectMeta {
  name: string;
  description: string;
  origin: string;
  destination: string;
  /** Sluttdato (valgfri). Startdato er tripDate. */
  endDate?: string;
  status: ProjectStatus;
  icon: string;
  notes: string;
  coverBlobId?: string;
  coverThumbId?: string;
  /** false = ikke last inn Finse–Rjukan-GPX automatisk (nye, tomme prosjekter) */
  seedGpx?: boolean;
  archived?: boolean;
  contacts: string;
}

export const DEFAULT_PROJECT: ProjectMeta = {
  name: 'Finse – Rjukan Snowkite Expedition 2027',
  description: 'Snowkite-ekspedisjon over Hardangervidda fra Finse til Rjukan.',
  origin: 'Finse',
  destination: 'Rjukan',
  status: 'planlegging',
  icon: '🪁',
  notes: '',
  contacts: 'Nødnummer: 112 (politi/redning) · 113 (ambulanse) · 110 (brann)\nHovedredningssentralen Sør-Norge: 51 64 60 00',
};

export type ExportPreset = 'kompakt' | 'full' | 'felt' | 'rute';
export interface ExportPrefs {
  preset: ExportPreset;
  maps: boolean;
  profile: boolean;
  weather: boolean;
  kites: boolean;
  camps: boolean;
  waypoints: boolean;
  safety: boolean;
  photos: boolean;
  assumptions: boolean;
  csvLocale: 'no' | 'int';
  landscapeMap: boolean;
}

export const PRESETS: Record<ExportPreset, { label: string; text: string; prefs: Partial<ExportPrefs> }> = {
  full: { label: 'Full ekspedisjonsplan', text: 'Alt: forside, oversikt, kart, dag for dag, teltplasser, utstyr, vær, terreng og sikkerhet.', prefs: { maps: true, profile: true, weather: true, kites: true, camps: true, waypoints: true, safety: true, photos: true, assumptions: true } },
  kompakt: { label: 'Kompakt oversikt', text: 'Forside, oversikt, kart og en tabell over dagene – 4–6 sider.', prefs: { maps: true, profile: true, weather: true, kites: true, camps: false, waypoints: false, safety: true, photos: false, assumptions: false } },
  felt: { label: 'Feltbrief', text: 'Til å ha med i lomma: dag for dag, nødinfo og nøkkeltall. Lite blekk.', prefs: { maps: true, profile: false, weather: true, kites: true, camps: true, waypoints: false, safety: true, photos: false, assumptions: false } },
  rute: { label: 'Kun rute', text: 'Kart, høydeprofil, rutepunkter med beskrivelser og teltplasser.', prefs: { maps: true, profile: true, weather: false, kites: false, camps: true, waypoints: true, safety: false, photos: false, assumptions: false } },
};

export const DEFAULT_EXPORT: ExportPrefs = { preset: 'full', csvLocale: 'no', landscapeMap: true, ...(PRESETS.full.prefs as Omit<ExportPrefs, 'preset' | 'csvLocale' | 'landscapeMap'>) };

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[æ]/g, 'ae')
    .replace(/[ø]/g, 'o')
    .replace(/[å]/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'prosjekt';
