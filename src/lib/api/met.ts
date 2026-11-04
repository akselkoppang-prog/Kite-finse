import { fetchJson, validLatLon } from './http';
import type { LatLon } from '../geo';

export interface ForecastRow {
  time: string;
  windSpeed?: number;
  windGust?: number;
  windFrom?: number;
  windP10?: number;
  windP90?: number;
  temp?: number;
  cloud?: number;
  precip?: number;
  precipMin?: number;
  precipMax?: number;
  symbol?: string;
  fog?: number;
  pressure?: number;
  /** sikt (m) – fra modeller som har det (Open-Meteo) */
  visibility?: number;
  /** snøfall (cm/t) */
  snow?: number;
}

export interface Forecast {
  point: LatLon & { label: string };
  updatedAt?: string;
  fetchedAt: string;
  rows: ForecastRow[];
}

interface MetTs {
  time: string;
  data: {
    instant: { details: Record<string, number> };
    next_1_hours?: { summary?: { symbol_code?: string }; details?: Record<string, number> };
    next_6_hours?: { summary?: { symbol_code?: string }; details?: Record<string, number> };
  };
}

export async function forecast(p: LatLon & { label: string }): Promise<Forecast> {
  if (!validLatLon(p.lat, p.lon)) throw new Error(`Ugyldig koordinat ${p.lat}, ${p.lon}`);
  // MET ber om maks 4 desimaler (bedre caching) og at Expires respekteres – fetchJson cacher etter Expires.
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${p.lat.toFixed(4)}&lon=${p.lon.toFixed(4)}`;
  const json = await fetchJson<{ properties: { meta: { updated_at: string }; timeseries: MetTs[] } }>('met-forecast', url, undefined, {
    cacheMs: 30 * 60000,
    nature: 'prognose',
    dataTime: (j) => (j as { properties?: { meta?: { updated_at?: string } } }).properties?.meta?.updated_at,
  });
  if (!json?.properties?.timeseries?.length) throw new Error('Uventet svar fra MET (mangler timeseries)');
  const rows = json.properties.timeseries.map((t) => {
    const d = t.data.instant.details;
    const n = t.data.next_1_hours ?? t.data.next_6_hours;
    return {
      time: t.time,
      windSpeed: d.wind_speed,
      pressure: d.air_pressure_at_sea_level,
      windGust: d.wind_speed_of_gust,
      windFrom: d.wind_from_direction,
      windP10: d.wind_speed_percentile_10,
      windP90: d.wind_speed_percentile_90,
      temp: d.air_temperature,
      cloud: d.cloud_area_fraction,
      fog: d.fog_area_fraction,
      precip: n?.details?.precipitation_amount,
      precipMin: n?.details?.precipitation_amount_min,
      precipMax: n?.details?.precipitation_amount_max,
      symbol: n?.summary?.symbol_code,
    };
  });
  return { point: p, updatedAt: json.properties.meta.updated_at, fetchedAt: new Date().toISOString(), rows };
}

/** Effektiv temperatur (vindavkjøling, JAG/TI-formelen brukt av MET/Environment Canada). Gyldig for T ≤ 10 °C og vind > 1,3 m/s. */
export function windChill(tempC?: number, windMs?: number): number | undefined {
  if (tempC == null || windMs == null || tempC > 10 || windMs < 1.34) return tempC;
  const v = Math.pow(windMs * 3.6, 0.16);
  return 13.12 + 0.6215 * tempC - 11.37 * v + 0.3965 * tempC * v;
}

/** Sist mulige tidspunkt i prognosen. */
export function forecastEnd(f: Forecast): string | undefined {
  return f.rows[f.rows.length - 1]?.time;
}

// ---------- Klimatologi: MET Frost (krever gratis klient-ID fra frost.met.no) ----------

export interface ClimateStat {
  station: string;
  stationId: string;
  distKm?: number;
  years: string;
  n: number;
  meanWind?: number;
  p75Wind?: number;
  meanMaxGust?: number;
  meanTemp?: number;
  minTemp?: number;
}

const quantile = (a: number[], q: number) => {
  if (!a.length) return undefined;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

export async function frostClimate(clientId: string, p: LatLon, monthFrom = 3, monthTo = 4): Promise<ClimateStat> {
  const auth = { headers: { Authorization: `Basic ${btoa(`${clientId}:`)}` } };
  const src = await fetchJson<{ data: { id: string; name: string; distance?: number }[] }>('met-frost', `https://frost.met.no/sources/v0.jsonld?types=SensorSystem&geometry=nearest(POINT(${p.lon.toFixed(4)} ${p.lat.toFixed(4)}))&nearestmaxcount=1&elements=mean(wind_speed%20P1D)`, auth);
  const st = src.data[0];
  if (!st) throw new Error('Ingen stasjon med vinddata funnet');
  const elements = ['mean(wind_speed P1D)', 'max(wind_speed_of_gust P1D)', 'mean(air_temperature P1D)'].map(encodeURIComponent).join(',');
  const y1 = new Date().getUTCFullYear() - 1;
  const y0 = y1 - 9;
  const obs = await fetchJson<{ data: { referenceTime: string; observations: { elementId: string; value: number }[] }[] }>(
    'met-frost',
    `https://frost.met.no/observations/v0.jsonld?sources=${st.id}&referencetime=${y0}-01-01/${y1}-12-31&elements=${elements}&timeoffsets=default&levels=default`,
    auth,
  );
  const wind: number[] = [], gust: number[] = [], temp: number[] = [];
  for (const d of obs.data) {
    const m = Number(d.referenceTime.slice(5, 7));
    if (m < monthFrom || m > monthTo) continue;
    for (const o of d.observations) {
      if (o.elementId.startsWith('mean(wind_speed')) wind.push(o.value);
      else if (o.elementId.startsWith('max(wind_speed_of_gust')) gust.push(o.value);
      else if (o.elementId.startsWith('mean(air_temperature')) temp.push(o.value);
    }
  }
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : undefined);
  return { station: st.name, stationId: st.id, distKm: st.distance, years: `${y0}–${y1}`, n: wind.length, meanWind: avg(wind), p75Wind: quantile(wind, 0.75), meanMaxGust: avg(gust), meanTemp: avg(temp), minTemp: temp.length ? Math.min(...temp) : undefined };
}
