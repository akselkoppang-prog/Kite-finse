import { fetchJson } from './http';
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
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${p.lat.toFixed(4)}&lon=${p.lon.toFixed(4)}`;
  const json = await fetchJson<{ properties: { meta: { updated_at: string }; timeseries: MetTs[] } }>('met-forecast', url);
  const rows = json.properties.timeseries.map((t) => {
    const d = t.data.instant.details;
    const n = t.data.next_1_hours ?? t.data.next_6_hours;
    return {
      time: t.time,
      windSpeed: d.wind_speed,
      windGust: d.wind_speed_of_gust,
      windFrom: d.wind_from_direction,
      windP10: d.wind_speed_percentile_10,
      windP90: d.wind_speed_percentile_90,
      temp: d.air_temperature,
      cloud: d.cloud_area_fraction,
      precip: n?.details?.precipitation_amount,
      precipMin: n?.details?.precipitation_amount_min,
      precipMax: n?.details?.precipitation_amount_max,
      symbol: n?.summary?.symbol_code,
    };
  });
  return { point: p, updatedAt: json.properties.meta.updated_at, fetchedAt: new Date().toISOString(), rows };
}
