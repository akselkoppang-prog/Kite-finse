import type { LatLon } from './lib/geo';

/**
 * Verifiseringsstatus (se Sikkerhet-fanen):
 *  GRØNN – kontrollert mot angitt kilde og dato (betyr IKKE automatisk trygt)
 *  GUL   – usikkerhet eller manglende opplysninger
 *  RØD   – kjent barriere, uakseptabel risiko eller forbudt i planen
 *  GRÅ   – ingen tilgjengelige data
 */
export type Status = 'GRØNN' | 'GUL' | 'RØD' | 'GRÅ';

/** Hvilken kategori en dataverdi tilhører – vises alltid i UI. */
export type DataKind =
  | 'kartdata' // 1. faktiske kartdata (Kartverket/NVE/MET)
  | 'forslag' // 2. foreslått rute/punkt
  | 'beregnet' // 3. beregnede verdier
  | 'uverifisert' // 4. uverifiserte forhold
  | 'sjekk-selv'; // 5. må kontrolleres nærmere av deg

export type WaypointKind = 'via' | 'stopp' | 'omvei' | 'delmål';

export interface Waypoint extends LatLon {
  id: string;
  name?: string;
  kind: WaypointKind;
  /** Høyde fra GPX-filen (Garmin) – ikke DTM. */
  eleGpx?: number;
  /** Kilde for koordinaten. */
  source: string;
  dataKind: DataKind;
  note?: string;
}

export type RouteKind = 'gpx' | 'konsept' | 'alternativ' | 'egen';

export interface Route {
  id: string;
  name: string;
  kind: RouteKind;
  color: string;
  description: string;
  waypoints: Waypoint[];
  visible: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ZoneKind = 'forbudt' | 'usikker';
export interface Zone {
  id: string;
  name: string;
  kind: ZoneKind;
  ring: LatLon[];
  note?: string;
  createdAt: string;
}

export interface Camp extends LatLon {
  id: string;
  name: string;
  night: number;
  source: 'manuell' | 'beregnet kandidat';
  note?: string;
}

export interface Place extends LatLon {
  key: string;
  name: string;
  type: string;
  kommune?: string;
  source: string;
  fetchedAt: string;
  /** Rolle i planen */
  role: ('hytte' | 'avbrudd' | 'by' | 'transport')[];
}
