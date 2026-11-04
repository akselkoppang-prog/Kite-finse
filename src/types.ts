import type { LatLon } from './lib/geo';

/**
 * Verifiseringsstatus (se Sikkerhet-fanen):
 *  GRØNN – kontrollert mot angitt kilde og dato (betyr IKKE automatisk trygt)
 *  GUL   – usikkerhet eller manglende opplysninger
 *  RØD   – kjent barriere, uakseptabel risiko eller forbudt i planen
 *  GRÅ   – ingen tilgjengelige data
 *  BRUKER – din egen overstyring/godkjenning (IKKE uavhengig verifisert)
 */
export type Status = 'GRØNN' | 'GUL' | 'RØD' | 'GRÅ' | 'BRUKER';

/** Hvilken kategori en dataverdi tilhører – vises alltid i UI. */
export type DataKind =
  | 'kartdata' // 1. faktiske kartdata (Kartverket/NVE/MET)
  | 'forslag' // 2. foreslått rute/punkt
  | 'beregnet' // 3. beregnede verdier
  | 'uverifisert' // 4. uverifiserte forhold
  | 'sjekk-selv'; // 5. må kontrolleres nærmere av deg

export type WaypointKind = 'via' | 'stopp' | 'omvei' | 'delmål';

/** Brukerens egen vurdering av et punkt. «brukergodkjent» er ALDRI det samme som verifisert. */
export type Verification = 'uverifisert' | 'advarsel' | 'brukergodkjent' | 'verifisert' | 'blokkert';

export interface Attachment {
  id: string;
  name: string;
  /** Lenke (https://…). For bilder: tom – bildet ligger som Blob i IndexedDB (blobId/thumbId). Gamle planer kan ha data-URL. */
  href: string;
  kind: 'lenke' | 'bilde';
  addedAt: string;
  blobId?: string;
  thumbId?: string;
  size?: number;
  width?: number;
  height?: number;
}

/** Felles notat-felter for rutepunkter og egne markører. */
export interface Annotated {
  category?: string;
  description?: string;
  notes?: string;
  attachments?: Attachment[];
  verification?: Verification;
  createdAt?: string;
  updatedAt?: string;
}

export interface Waypoint extends LatLon, Annotated {
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

/** Egen markør i kartet (ikke del av rutelinjen). */
export interface Marker extends LatLon, Annotated {
  id: string;
  name: string;
  category: string;
  source: string;
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
  /** Dagsskift som avstand (m) fra start. Lengde = antall dager − 1. */
  dayBreaks?: number[];
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
  approved?: boolean;
  role?: 'foretrukket' | 'reserve';
  notes?: string;
  attachments?: Attachment[];
  createdAt?: string;
  updatedAt?: string;
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

// ---------- Vann-overstyring (whitelist) ----------

export type OverrideScope = 'permanent' | 'tur' | 'sesong';

export interface LakeOverride {
  id: string;
  /** Stabil nøkkel for vannet (NVE-id eller navn). */
  barrierKey: string;
  name: string;
  /** Opprinnelig klassifisering ved overstyring – endres aldri av overstyringen. */
  originalKind: 'magasin' | 'innsjø';
  originalLabel: string;
  centroid: LatLon;
  /** GeoJSON-geometri (polygon) slik den var da overstyringen ble laget */
  geometry?: unknown;
  scope: OverrideScope;
  /** Sesong: gyldig mellom disse (MM-DD) hvert år */
  seasonFrom?: string;
  seasonTo?: string;
  /** Tur: gjelder kun turdatoene (lagres som avreisedato) */
  tripDate?: string;
  expires?: string;
  reviewRequired: boolean;
  reviewedAt?: string;
  note: string;
  sourceLink?: string;
  /** Hvilken rute og strekning (km) den gjelder. Tom = alle kryssinger av vannet. */
  segment?: { routeId: string; routeName: string; fromKm: number; toKm: number };
  createdAt: string;
  active: boolean;
}

export interface HistoryEntry {
  at: string;
  kind: 'rute' | 'overstyring' | 'kite' | 'dato' | 'annet';
  text: string;
}

export interface Quiver {
  id: string;
  name: string;
  kiteIds: string[];
  primary?: string;
  secondary?: string;
  storm?: string;
  note?: string;
}
