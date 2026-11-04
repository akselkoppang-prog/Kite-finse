import L from 'leaflet';
import { densify, destination, type LatLon } from './geo';

/**
 * Offline-støtte:
 *  - Service worker (public/sw.js) cacher appen og Kartverket-fliser som er lastet eller forhåndslastet.
 *  - Forhåndslasting henter KUN fliser i en korridor langs ruten (begrenset zoom/antall) for å respektere
 *    Kartverkets cache-tjeneste (CC BY 4.0, «rimelig bruk»). Ikke bruk dette til massenedlasting.
 */
export const TILE_CACHE = 'kv-tiles-v1';

export function cachedTileLayer(url: string, opts: L.TileLayerOptions) {
  // Fliser går via vanlig <img>; service workeren svarer fra cache når nettet mangler.
  return L.tileLayer(url, opts);
}

export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.hostname === 'localhost' && location.port === '5173') return; // ikke i dev-server
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW-registrering feilet', e));
}

function lon2x(lon: number, z: number) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function lat2y(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

export function corridorTiles(route: LatLon[], urlTpl: string, zMin: number, zMax: number, bufferM: number): string[] {
  const set = new Set<string>();
  const pts = densify(route, 400);
  for (let z = zMin; z <= zMax; z++) {
    for (const p of pts) {
      for (const b of [0, 90, 180, 270, 45, 135, 225, 315]) {
        const q = destination(p, bufferM, b);
        for (const r of [p, q]) set.add(`${z}/${lat2y(r.lat, z)}/${lon2x(r.lon, z)}`);
      }
    }
  }
  return [...set].map((k) => {
    const [z, y, x] = k.split('/');
    return urlTpl.replace('{z}', z).replace('{y}', y).replace('{x}', x);
  });
}

export async function prefetchTiles(urls: string[], onProgress: (done: number, failed: number) => void, signal?: AbortSignal) {
  if (!('caches' in window)) throw new Error('Nettleseren støtter ikke Cache API');
  const cache = await caches.open(TILE_CACHE);
  let done = 0, failed = 0, i = 0;
  const worker = async () => {
    while (i < urls.length) {
      if (signal?.aborted) return;
      const u = urls[i++];
      try {
        if (!(await cache.match(u))) {
          // CORS først (da kan flisen også brukes i PDF-kart offline), ellers opakt svar (holder for <img>)
          let res: Response;
          try {
            res = await fetch(u, { mode: 'cors' });
            if (!res.ok) throw new Error(String(res.status));
          } catch {
            res = await fetch(u, { mode: 'no-cors' });
          }
          await cache.put(u, res);
        }
        done++;
      } catch {
        failed++;
      }
      onProgress(done, failed);
      await new Promise((r) => setTimeout(r, 25)); // skånsom takt
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

export async function cachedTileCount(): Promise<number> {
  if (!('caches' in window)) return 0;
  const c = await caches.open(TILE_CACHE);
  return (await c.keys()).length;
}

export async function clearTiles() {
  if ('caches' in window) await caches.delete(TILE_CACHE);
}
