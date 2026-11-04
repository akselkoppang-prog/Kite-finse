import type { State } from '../state/store';

/**
 * Hvilke felt i app-tilstanden som lagres hvor.
 * Hver «slice» er en egen IndexedDB-post, så en endring i f.eks. teltplasser skriver bare den lille posten.
 * Ruter lagres én post per rute (routes-lageret). Cache-data (kan hentes på nytt) ligger i caches-lageret.
 */
export const SLICES: Record<string, (keyof State)[]> = {
  routeIndex: ['activeRouteId'],
  trip: ['tripDate', 'tripDays', 'altDates', 'dayNotes', 'windFrom', 'windSpeed', 'windGust', 'snow', 'terrainKind', 'goal', 'pulkKg', 'riderKg', 'travel', 'scenarios', 'scenarioId'],
  places: ['places'],
  zones: ['zones'],
  camps: ['camps'],
  markers: ['markers', 'customCategories', 'hiddenCategories'],
  overrides: ['lakeOverrides', 'userVerifiedLakes', 'acks'],
  kites: ['quivers', 'activeQuiverId', 'kiteNotes', 'kiteOverrides', 'kiteModelEdits', 'kiteSpecEdits'],
  sim: ['sim', 'simParams', 'itineraries', 'daily', 'sunCfg'],
  calib: ['calibTracks'],
  lists: ['checklist', 'timeline', 'packing', 'food'],
  ui: ['tab', 'layers', 'wms', 'frostClientId'],
  history: ['history'],
  plan: ['plans', 'activePlanId', 'compareIds'],
};

/** Data som kan hentes på nytt fra Kartverket/NVE/MET – lagres separat og kan ryddes uten tap. */
export const CACHE_KEYS = ['hydro', 'lakes', 'terrain', 'routeForecast'] as const;
export type CacheKey = (typeof CACHE_KEYS)[number];

/** Kortvarig UI-tilstand som ikke lagres. */
export const TRANSIENT: (keyof State)[] = ['focus', 'editMode', 'draftZone', 'selectedWp', 'selectedMarker', 'selectedBarrier', 'selectedCamp', 'forecastHour', 'windPoints', 'simPlay', 'dailyView'];

/** Felt som verken er lagret, cache eller kortvarig – skal alltid være tom (testes). */
export function uncoveredKeys(state: Record<string, unknown>): string[] {
  const covered = new Set<string>([...Object.values(SLICES).flat(), ...CACHE_KEYS, ...TRANSIENT, 'routes']);
  return Object.keys(state).filter((k) => typeof state[k] !== 'function' && !covered.has(k));
}

export function pick(state: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k of keys) if (state[k] !== undefined) o[k] = state[k];
  return o;
}
