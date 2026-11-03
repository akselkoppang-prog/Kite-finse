import { useStore, routeHash } from '../state/store';
import { PLACE_QUERIES, ROUTE_CHAINS } from '../data/places';
import { resolvePlace } from './api/kartverket';
import { loadHydropower, lakesAlong } from './api/nve';
import { analyseTerrain } from './analysis/terrain';
import { parseGpx } from './gpx';
import { bbox, densify, uid } from './geo';
import type { Route } from '../types';

const now = () => new Date().toISOString();

export async function loadInitialGpx() {
  const st = useStore.getState();
  if (st.routes.some((r) => r.kind === 'gpx')) return;
  const res = await fetch('data/Finse_Rjukan_kite_27.gpx');
  const xml = await res.text();
  const parsed = parseGpx(xml, 'Brukers GPX «Finse Rjukan kite 27» (Garmin Explore, 2026-11-03)');
  const t = parsed.tracks[0];
  if (!t) return;
  t.points[0].name = 'Start (GPX)';
  t.points[t.points.length - 1].name = 'Slutt Rjukan (GPX)';
  const route: Route = {
    id: 'gpx-original',
    name: 'Din GPX: Finse–Rjukan',
    kind: 'gpx',
    color: '#ef4444',
    description: 'Opprinnelig skisse fra Garmin Explore. Lange rette linjer er ikke terrengtilpasset.',
    waypoints: t.points,
    visible: true,
    createdAt: now(),
    updatedAt: now(),
  };
  useStore.getState().upsertRoute(route);
  useStore.getState().set({ activeRouteId: route.id });
}

export async function importGpxFile(file: File) {
  const xml = await file.text();
  const parsed = parseGpx(xml, `Importert GPX «${file.name}» ${now().slice(0, 10)}`);
  const st = useStore.getState();
  parsed.tracks.forEach((t, i) => {
    if (t.points.length < 2) return;
    const r: Route = {
      id: uid('rt'),
      name: t.name || `${file.name} #${i + 1}`,
      kind: 'egen',
      color: ['#f472b6', '#34d399', '#60a5fa', '#fbbf24'][i % 4],
      description: `Importert fra ${file.name}`,
      waypoints: t.points,
      visible: true,
      createdAt: now(),
      updatedAt: now(),
    };
    st.upsertRoute(r);
    useStore.getState().set({ activeRouteId: r.id });
  });
  return parsed.tracks.length;
}

export async function resolveAllPlaces(onMsg?: (m: string) => void) {
  const out: Record<string, NonNullable<Awaited<ReturnType<typeof resolvePlace>>['place']>> = { ...useStore.getState().places };
  const missing: string[] = [];
  for (const q of PLACE_QUERIES) {
    onMsg?.(`Slår opp «${q.query}» …`);
    try {
      const { place } = await resolvePlace(q);
      if (place) out[q.key] = place;
      else missing.push(q.query);
    } catch (e) {
      missing.push(`${q.query} (${(e as Error).message})`);
    }
  }
  useStore.getState().set({ places: out });
  return missing;
}

export function buildChainRoutes(): { built: string[]; missing: string[] } {
  const st = useStore.getState();
  const built: string[] = [];
  const missing: string[] = [];
  ROUTE_CHAINS.forEach((c) => {
    const pts = c.keys.map((k) => st.places[k]);
    const lacking = c.keys.filter((_k, i) => !pts[i]);
    if (lacking.length) {
      missing.push(`${c.name}: mangler ${lacking.join(', ')}`);
      return;
    }
    const r: Route = {
      id: `chain-${c.id}`,
      name: c.name,
      kind: c.id === 'konsept' ? 'konsept' : 'alternativ',
      color: c.color,
      description: `${c.description} Koordinater: Kartverket stedsnavn-API. Linjer: rette streker (FORESLÅTT).`,
      waypoints: pts.map((p) => ({ id: uid('wp'), lat: p!.lat, lon: p!.lon, name: p!.name, kind: 'stopp', source: `${p!.source} (${p!.type}), hentet ${p!.fetchedAt.slice(0, 10)}`, dataKind: 'kartdata' })),
      visible: true,
      createdAt: now(),
      updatedAt: now(),
    };
    st.upsertRoute(r);
    built.push(c.name);
  });
  return { built, missing };
}

export async function loadHydro() {
  const st = useStore.getState();
  const all = st.routes.flatMap((r) => r.waypoints);
  const b = all.length ? bbox(all, 0.08) : ([7.3, 59.8, 8.8, 60.7] as [number, number, number, number]);
  const hydro = await loadHydropower(b);
  useStore.getState().set({ hydro });
  return hydro;
}

export async function checkLakesForActive() {
  const st = useStore.getState();
  const r = st.routes.find((x) => x.id === st.activeRouteId);
  if (!r) throw new Error('Ingen aktiv rute');
  // Forenklet linje (hver 100 m) for spørringen
  const line = densify(r.waypoints, 150);
  const res = await lakesAlong(line);
  useStore.getState().set({ lakes: { ...useStore.getState().lakes, [routeHash(r)]: { lakes: res.lakes, fetchedAt: res.fetchedAt, layer: res.layer.name } } });
  return res.lakes.length;
}

export async function runTerrainForActive(stepM: number, onProgress: (f: number) => void) {
  const st = useStore.getState();
  const r = st.routes.find((x) => x.id === st.activeRouteId);
  if (!r) throw new Error('Ingen aktiv rute');
  const h = routeHash(r);
  const res = await analyseTerrain(r.waypoints, stepM, h, onProgress);
  // behold bare analyser for ruter som finnes (begrens lagring)
  const keep = Object.fromEntries(Object.entries(useStore.getState().terrain).filter(([k]) => useStore.getState().routes.some((x) => k.startsWith(`${x.id}:`)) && k !== h).slice(-4));
  useStore.getState().set({ terrain: { ...keep, [h]: res } });
  return res;
}

export function exportPlanJson(): string {
  const s = useStore.getState();
  const { routes, zones, camps, places, userVerifiedLakes, checklist, timeline, acks, kiteOverrides, tripDate, windFrom, windSpeed, windGust } = s;
  return JSON.stringify({ format: 'kite-finse-rjukan-plan', version: 1, exportedAt: now(), routes, zones, camps, places, userVerifiedLakes, checklist, timeline, acks, kiteOverrides, tripDate, windFrom, windSpeed, windGust }, null, 2);
}

export function importPlanJson(txt: string) {
  const j = JSON.parse(txt);
  if (j.format !== 'kite-finse-rjukan-plan') throw new Error('Ukjent filformat');
  const { format: _f, version: _v, exportedAt: _e, ...rest } = j;
  void _f; void _v; void _e;
  useStore.getState().set({ ...rest, activeRouteId: rest.routes?.[0]?.id ?? null });
}
