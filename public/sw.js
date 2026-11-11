// Service worker for offline-bruk av ekspedisjonsplanleggeren.
// Versjon og fil-liste settes inn ved bygging (vite.config.ts). Hver ny versjon får sin egen app-cache:
//  - installasjon: ALLE app-filer hentes (hele appen virker uten nett, også sider du ikke har åpnet)
//  - aktivering: gamle app-cacher slettes (ingen opphoping, ingen blanding av versjoner)
//  - Kartverket-fliser: cache først. API-kall (NVE, MET, Open-Meteo …) caches IKKE her – appen lagrer data selv.
const VERSION = '__APP_VERSION__';
const PRECACHE = "__PRECACHE__";
const BUILT = !VERSION.startsWith('__');
const APP_PREFIX = 'kite-app-';
const APP_CACHE = APP_PREFIX + (BUILT ? VERSION : 'dev');
const TILE_CACHE = 'kv-tiles-v1';

self.addEventListener('install', (e) => {
  const files = BUILT ? PRECACHE : ['./', './index.html'];
  e.waitUntil(
    caches
      .open(APP_CACHE)
      // én og én fil: en enkelt feil skal ikke stoppe installasjonen
      .then((c) => Promise.allSettled(files.map((f) => fetch(f, { cache: 'reload' }).then((res) => (res.ok ? c.put(f, res) : undefined)))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(APP_PREFIX) && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);

self.addEventListener('message', (e) => {
  if (e.data === 'version') e.source?.postMessage({ type: 'version', version: VERSION });
});

async function fromCache(request) {
  const c = await caches.open(APP_CACHE);
  return (await c.match(request)) || (await c.match(request, { ignoreSearch: true }));
}

async function networkFirst(request, fallbackUrl) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const copy = res.clone();
      caches.open(APP_CACHE).then((c) => c.put(request, copy));
    }
    return res;
  } catch (err) {
    const hit = (await fromCache(request)) || (fallbackUrl ? await fromCache(fallbackUrl) : undefined);
    return hit || Response.error();
  }
}

async function cacheFirst(request) {
  const hit = await fromCache(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    const copy = res.clone();
    caches.open(APP_CACHE).then((c) => c.put(request, copy));
  }
  return res;
}

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
  if (url.origin !== self.location.origin) return;
  // versjonssjekken skal alltid spørre nettet (appen tåler at den feiler uten nett)
  if (url.pathname.endsWith('/version.json')) return;
  // sidenavigasjon: nett først (nye versjoner kommer straks), ellers lagret app
  if (e.request.mode === 'navigate') {
    e.respondWith(networkFirst(e.request, './index.html'));
    return;
  }
  // filer med innholds-hash i navnet endrer seg aldri: cache først
  if (url.pathname.includes('/assets/')) {
    e.respondWith(cacheFirst(e.request).catch(() => Response.error()));
    return;
  }
  e.respondWith(networkFirst(e.request));
});
