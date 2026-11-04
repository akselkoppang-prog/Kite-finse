import { forecast as metForecast, type Forecast, type ForecastRow } from '../api/met';
import { fetchJson, validLatLon } from '../api/http';
import { cumulative, pointAt, type LatLon } from '../geo';
import type { Observation, RouteWeather, WeatherAlert, WeatherProvider } from './types';

/* ---------- Open-Meteo (flere modeller, ingen nøkkel) ---------- */
interface OmResp {
  hourly?: { time: string[]; [k: string]: (number | null)[] | string[] };
  hourly_units?: Record<string, string>;
  generationtime_ms?: number;
  error?: boolean;
  reason?: string;
}
const OM_VARS = ['temperature_2m', 'precipitation', 'snowfall', 'cloud_cover', 'visibility', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m'];

/** Gjør et Open-Meteo-svar om til appens felles format (testbar uten nett). */
export function parseOpenMeteo(j: OmResp, p: LatLon & { label: string }): Forecast {
  if (j.error) throw new Error(j.reason ?? 'Open-Meteo svarte med feil');
  const h = j.hourly;
  if (!h?.time?.length) throw new Error('Uventet svar fra Open-Meteo (mangler hourly.time)');
  const col = (k: string) => (h[k] as (number | null)[] | undefined) ?? [];
  const v = (k: string, i: number) => {
    const x = col(k)[i];
    return x == null || !Number.isFinite(x) ? undefined : x;
  };
  const rows: ForecastRow[] = h.time.map((t, i) => ({
    time: t.endsWith('Z') ? t : `${t}Z`,
    windSpeed: v('wind_speed_10m', i),
    windGust: v('wind_gusts_10m', i),
    windFrom: v('wind_direction_10m', i),
    temp: v('temperature_2m', i),
    cloud: v('cloud_cover', i),
    precip: v('precipitation', i),
    snow: v('snowfall', i),
    visibility: v('visibility', i),
  }));
  // fjern timer der modellen ikke har vind (slutten av horisonten for regionale modeller)
  const valid = rows.filter((r) => r.windSpeed != null);
  if (!valid.length) throw new Error('Modellen har ingen vinddata for punktet');
  return { point: p, fetchedAt: new Date().toISOString(), updatedAt: undefined, rows: valid };
}

function openMeteo(id: string, model: string, label: string, short: string, horizonDays: number): WeatherProvider {
  return {
    id,
    label,
    short,
    horizonDays,
    attribution: `Open-Meteo.com (CC BY 4.0) – modell: ${label}`,
    link: (p) => `https://open-meteo.com/en/docs#latitude=${p.lat.toFixed(3)}&longitude=${p.lon.toFixed(3)}&models=${model}`,
    fetch: async (p) => {
      if (!validLatLon(p.lat, p.lon)) throw new Error('Ugyldig koordinat');
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(4)}&longitude=${p.lon.toFixed(4)}&hourly=${OM_VARS.join(',')}&wind_speed_unit=ms&timezone=GMT&forecast_days=${horizonDays}&models=${model}`;
      const j = await fetchJson<OmResp>('open-meteo', url, undefined, { cacheMs: 60 * 60000, nature: 'prognose' });
      return parseOpenMeteo(j, p);
    },
  };
}

export const PROVIDERS: WeatherProvider[] = [
  {
    id: 'met',
    label: 'Yr / MET Norge (Locationforecast)',
    short: 'Yr/MET',
    horizonDays: 9,
    attribution: 'MET Norge (CC BY 4.0) – samme data som Yr',
    link: (p) => `https://www.yr.no/nb/værvarsel/daglig-tabell/${p.lat.toFixed(3)},${p.lon.toFixed(3)}`,
    fetch: (p) => metForecast(p),
  },
  openMeteo('om-ecmwf', 'ecmwf_ifs025', 'ECMWF IFS (via Open-Meteo)', 'ECMWF', 15),
  openMeteo('om-icon', 'icon_seamless', 'DWD ICON (via Open-Meteo)', 'ICON', 7),
  openMeteo('om-metno', 'metno_seamless', 'MET Nordic (via Open-Meteo)', 'MET Nordic', 3),
];
export const providerById = (id?: string) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];

/** Windy (kart). Windy sitt punkt-API krever betalt nøkkel som ikke kan skjules på en statisk side – vi bruker deres offisielle innbyggingskart og lenker. */
export const windyEmbed = (p: LatLon, zoom = 8) => `https://embed.windy.com/embed.html?type=map&location=coordinates&metricWind=m%2Fs&metricTemp=%C2%B0C&zoom=${zoom}&overlay=wind&product=ecmwf&level=surface&lat=${p.lat.toFixed(3)}&lon=${p.lon.toFixed(3)}&detailLat=${p.lat.toFixed(3)}&detailLon=${p.lon.toFixed(3)}&detail=true&message=true`;
export const windyLink = (p: LatLon) => `https://www.windy.com/${p.lat.toFixed(3)}/${p.lon.toFixed(3)}?wind,${p.lat.toFixed(3)},${p.lon.toFixed(3)},9`;

/** Punkter langs ruten (hver ~12 km + start og mål). */
export function samplePoints(route: LatLon[], spacingM = 12000): (LatLon & { d: number; label: string })[] {
  const cum = cumulative(route);
  const total = cum[cum.length - 1] ?? 0;
  const n = Math.max(2, Math.round(total / spacingM) + 1);
  return Array.from({ length: n }, (_, i) => {
    const d = (total * i) / (n - 1);
    const p = pointAt(route, cum, d);
    return { lat: p.lat, lon: p.lon, d, label: i === 0 ? 'Start' : i === n - 1 ? 'Mål' : `${(d / 1000).toFixed(0)} km` };
  });
}

/** Hent værdata langs ruten fra én leverandør. Feil på enkeltpunkter stopper ikke resten. */
export async function fetchRouteWeather(provider: WeatherProvider, route: LatLon[], routeKey: string, onProgress?: (done: number, total: number) => void): Promise<RouteWeather> {
  const pts = samplePoints(route);
  const out: RouteWeather = { provider: provider.id, routeKey, fetchedAt: new Date().toISOString(), points: [], errors: [] };
  let done = 0;
  const queue = [...pts];
  const worker = async () => {
    while (queue.length) {
      const p = queue.shift()!;
      try {
        const fc = await provider.fetch(p);
        out.points.push({ ...p, fc });
        if (fc.updatedAt && (!out.updatedAt || fc.updatedAt > out.updatedAt)) out.updatedAt = fc.updatedAt;
      } catch (e) {
        out.errors.push(`${p.label}: ${(e as Error).message}`);
      }
      onProgress?.(++done, pts.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  out.points.sort((a, b) => a.d - b.d);
  return out;
}

/* ---------- MET farevarsler ---------- */
interface AlertFeature { properties: { id?: string; title?: string; event?: string; eventAwarenessName?: string; awareness_level?: string; description?: string; instruction?: string; area?: string }; when?: { interval?: string[] } }
export function parseAlerts(j: { features?: AlertFeature[] }, at: string): WeatherAlert[] {
  return (j.features ?? []).map((f, i) => {
    const pr = f.properties ?? {};
    const lvl = /red|rød/i.test(pr.awareness_level ?? '') ? 'rød' : /orange|oransje/i.test(pr.awareness_level ?? '') ? 'oransje' : /yellow|gul/i.test(pr.awareness_level ?? '') ? 'gul' : 'ukjent';
    return { id: pr.id ?? `${at}-${i}`, title: pr.title ?? pr.eventAwarenessName ?? 'Farevarsel', event: pr.eventAwarenessName ?? pr.event ?? '', level: lvl, description: pr.description ?? '', instruction: pr.instruction, area: pr.area, onset: f.when?.interval?.[0], ends: f.when?.interval?.[1], at } as WeatherAlert;
  });
}
export async function fetchAlerts(points: (LatLon & { label: string })[]): Promise<WeatherAlert[]> {
  const all: WeatherAlert[] = [];
  for (const p of points) {
    const j = await fetchJson<{ features?: AlertFeature[] }>('met-alerts', `https://api.met.no/weatherapi/metalerts/2.0/current.json?lat=${p.lat.toFixed(3)}&lon=${p.lon.toFixed(3)}`, undefined, { cacheMs: 15 * 60000, nature: 'prognose' });
    for (const a of parseAlerts(j, p.label)) if (!all.some((x) => x.id === a.id)) all.push(a);
  }
  return all;
}

/* ---------- MET Frost: siste observasjoner (krever gratis klient-ID) ---------- */
export async function latestObservations(clientId: string, p: LatLon, max = 3): Promise<Observation[]> {
  const auth = { headers: { Authorization: `Basic ${btoa(`${clientId}:`)}` } };
  const src = await fetchJson<{ data: { id: string; name: string; distance?: number }[] }>('met-frost', `https://frost.met.no/sources/v0.jsonld?types=SensorSystem&geometry=nearest(POINT(${p.lon.toFixed(4)} ${p.lat.toFixed(4)}))&nearestmaxcount=${max}&elements=wind_speed`, auth);
  const out: Observation[] = [];
  for (const st of src.data ?? []) {
    try {
      const obs = await fetchJson<{ data: { referenceTime: string; observations: { elementId: string; value: number }[] }[] }>('met-frost', `https://frost.met.no/observations/v0.jsonld?sources=${st.id}&referencetime=latest&maxage=PT6H&elements=wind_speed,wind_from_direction,air_temperature,max(wind_speed_of_gust%20PT1H),surface_snow_thickness&limit=1`, auth);
      const latest = obs.data?.[obs.data.length - 1];
      if (!latest) continue;
      const get = (e: string) => latest.observations.find((o) => o.elementId === e)?.value;
      out.push({ station: st.name, distanceKm: st.distance, time: latest.referenceTime, windSpeed: get('wind_speed'), windFrom: get('wind_from_direction'), temp: get('air_temperature'), windGust: get('max(wind_speed_of_gust PT1H)'), snowDepthCm: get('surface_snow_thickness') });
    } catch {
      /* stasjonen har ikke ferske data – hopp over */
    }
  }
  return out;
}
