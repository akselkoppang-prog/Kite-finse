import type { Forecast } from '../api/met';
import type { RouteForecastPoint } from '../sim/wind';
import type { LatLon } from '../geo';

/**
 * Felles format for værdata fra alle leverandører. En ny leverandør trenger bare å implementere
 * WeatherProvider.fetch() og returnere en Forecast (timesrader) – resten av appen (simulering,
 * varsler, sammenligning, eksport) virker da automatisk.
 */
export interface WeatherProvider {
  id: string;
  label: string;
  short: string;
  /** dager frem i tid leverandøren dekker */
  horizonDays: number;
  attribution: string;
  /** lenke til leverandørens egen visning for et punkt */
  link?: (p: LatLon) => string;
  fetch: (p: LatLon & { label: string }) => Promise<Forecast>;
}

/** Værdata langs én rute fra én leverandør (lagres som cache – kan hentes på nytt). */
export interface RouteWeather {
  provider: string;
  routeKey: string;
  fetchedAt: string;
  /** modellens/tjenestens oppdateringstid (når prognosen ble laget) */
  updatedAt?: string;
  points: RouteForecastPoint[];
  errors: string[];
}

export interface WeatherAlert {
  id: string;
  title: string;
  event: string;
  level: 'gul' | 'oransje' | 'rød' | 'ukjent';
  description: string;
  instruction?: string;
  onset?: string;
  ends?: string;
  area?: string;
  at: string; // hvilket rutepunkt
}

export interface Observation {
  station: string;
  distanceKm?: number;
  time: string;
  windSpeed?: number;
  windGust?: number;
  windFrom?: number;
  temp?: number;
  snowDepthCm?: number;
}
