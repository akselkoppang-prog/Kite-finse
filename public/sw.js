// Service worker for offline-bruk av ekspedisjonsplanleggeren.
// - App-filer: nettverk først, cache som reserve.
// - Kartverket-fliser: cache først (fyll cache når de lastes).
// - API-kall (NVE, MET, Kartverket høyde/stedsnavn, Varsom) caches IKKE – offline vises lagrede data fra planen.
const APP_CACHE = 'kite-app-v1';
const TILE_CACHE = 'kv-tiles-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(['./', './index.html', './data/Finse_Rjukan_kite_27.gpx']).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname === 'cache.kartverket.no') {
    e.respondWith(
      caches.open(TILE_CACHE).then(async (c) => {
        const hit = await c.match(e.request.url);
        // Kart i <img> (Leaflet) kan bruke et «opakt» svar, men PDF-eksporten tegner flisen på et lerret og
        // trenger et CORS-svar. Har vi bare en opak kopi, hent en lesbar kopi fra nettet og erstatt den.
        if (hit && (hit.type !== 'opaque' || e.request.mode !== 'cors')) return hit;
        try {
          const res = await fetch(e.request);
          if (res.ok || res.type === 'opaque') c.put(e.request.url, res.clone());
          return res;
        } catch (err) {
          return hit ?? Response.error();
        }
      }),
    );
    return;
  }
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(APP_CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))),
    );
  }
});
