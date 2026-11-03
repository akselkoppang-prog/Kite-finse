import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Camp, Place, Route, Waypoint, Zone } from '../types';
import type { Dir8 } from '../lib/geo';
import type { NveHydro, PolyFeature } from '../lib/api/nve';
import type { TerrainAnalysis } from '../lib/analysis/terrain';
import type { Snow, Terrain, Goal } from '../lib/analysis/kite';
import { uid } from '../lib/geo';

export type Tab = 'kart' | 'vind' | 'kite' | 'sikkerhet' | 'dagplan' | 'tidslinje' | 'kilder';
export type EditMode = 'none' | 'add' | 'insert' | 'zone' | 'camp';

export interface LayerToggles {
  base: 'topo' | 'graatone' | 'raster';
  nveWms: boolean;
  skredWms: boolean;
  reservoirs: boolean;
  lakes: boolean;
  places: boolean;
  routes: boolean;
  alternatives: boolean;
  camps: boolean;
  zones: boolean;
  windColor: boolean;
  steep: boolean;
}

export interface WmsConfig { url: string; layers: string }

export interface State {
  tab: Tab;
  routes: Route[];
  activeRouteId: string | null;
  places: Record<string, Place>;
  zones: Zone[];
  draftZone: { lat: number; lon: number }[];
  camps: Camp[];
  hydro: NveHydro | null;
  lakes: Record<string, { lakes: PolyFeature[]; fetchedAt: string; layer: string }>;
  terrain: Record<string, TerrainAnalysis>;
  userVerifiedLakes: Record<string, string>;
  windFrom: Dir8;
  windSpeed: number;
  windGust: number;
  snow: Snow;
  terrainKind: Terrain;
  goal: Goal;
  pulkKg: number;
  riderKg: number;
  tripDate: string;
  kiteOverrides: Record<string, { low: number; high: number }>;
  checklist: Record<string, boolean>;
  timeline: Record<string, boolean>;
  acks: Record<string, string>;
  layers: LayerToggles;
  wms: { nve: WmsConfig; skred: WmsConfig };
  editMode: EditMode;
  focus: { lat: number; lon: number; zoom?: number; t: number } | null;
  selectedWp: string | null;

  set: (p: Partial<State>) => void;
  setTab: (t: Tab) => void;
  activeRoute: () => Route | undefined;
  upsertRoute: (r: Route) => void;
  removeRoute: (id: string) => void;
  updateWaypoints: (routeId: string, wps: Waypoint[]) => void;
  moveWaypoint: (routeId: string, wpId: string, lat: number, lon: number) => void;
  deleteWaypoint: (routeId: string, wpId: string) => void;
  renameWaypoint: (routeId: string, wpId: string, name: string) => void;
  addWaypoint: (routeId: string, lat: number, lon: number) => void;
  insertWaypoint: (routeId: string, lat: number, lon: number) => void;
  duplicateRoute: (id: string) => void;
  setLayer: <K extends keyof LayerToggles>(k: K, v: LayerToggles[K]) => void;
  focusOn: (lat: number, lon: number, zoom?: number) => void;
}

const now = () => new Date().toISOString();

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      tab: 'kart',
      routes: [],
      activeRouteId: null,
      places: {},
      zones: [],
      draftZone: [],
      camps: [],
      hydro: null,
      lakes: {},
      terrain: {},
      userVerifiedLakes: {},
      windFrom: 'SV',
      windSpeed: 8,
      windGust: 11,
      snow: 'pakket',
      terrainKind: 'kupert',
      goal: 'effektiv',
      pulkKg: 40,
      riderKg: 70,
      tripDate: '2027-03-25',
      kiteOverrides: {},
      checklist: {},
      timeline: {},
      acks: {},
      layers: { base: 'topo', nveWms: false, skredWms: false, reservoirs: true, lakes: true, places: true, routes: true, alternatives: true, camps: true, zones: true, windColor: false, steep: true },
      wms: {
        nve: { url: 'https://nve.geodataonline.no/arcgis/services/Vannkraft1/MapServer/WmsServer', layers: '' },
        skred: { url: 'https://nve.geodataonline.no/arcgis/services/Bratthet/MapServer/WMSServer', layers: '' },
      },
      editMode: 'none',
      focus: null,
      selectedWp: null,

      set: (p) => set(p),
      setTab: (tab) => set({ tab }),
      activeRoute: () => get().routes.find((r) => r.id === get().activeRouteId),
      upsertRoute: (r) =>
        set((s) => {
          const exists = s.routes.some((x) => x.id === r.id);
          return { routes: exists ? s.routes.map((x) => (x.id === r.id ? r : x)) : [...s.routes, r], activeRouteId: s.activeRouteId ?? r.id };
        }),
      removeRoute: (id) => set((s) => ({ routes: s.routes.filter((r) => r.id !== id), activeRouteId: s.activeRouteId === id ? (s.routes.find((r) => r.id !== id)?.id ?? null) : s.activeRouteId })),
      updateWaypoints: (routeId, wps) => set((s) => ({ routes: s.routes.map((r) => (r.id === routeId ? { ...r, waypoints: wps, updatedAt: now() } : r)) })),
      moveWaypoint: (routeId, wpId, lat, lon) =>
        set((s) => ({
          routes: s.routes.map((r) =>
            r.id === routeId
              ? { ...r, updatedAt: now(), waypoints: r.waypoints.map((w) => (w.id === wpId ? { ...w, lat, lon, eleGpx: undefined, dataKind: 'forslag', source: `${w.source} → flyttet manuelt ${now().slice(0, 10)}` } : w)) }
              : r,
          ),
        })),
      deleteWaypoint: (routeId, wpId) => set((s) => ({ routes: s.routes.map((r) => (r.id === routeId ? { ...r, updatedAt: now(), waypoints: r.waypoints.filter((w) => w.id !== wpId) } : r)) })),
      renameWaypoint: (routeId, wpId, name) =>
        set((s) => ({ routes: s.routes.map((r) => (r.id === routeId ? { ...r, waypoints: r.waypoints.map((w) => (w.id === wpId ? { ...w, name, kind: name ? 'stopp' : w.kind } : w)) } : r)) })),
      addWaypoint: (routeId, lat, lon) =>
        set((s) => ({
          routes: s.routes.map((r) =>
            r.id === routeId ? { ...r, updatedAt: now(), waypoints: [...r.waypoints, { id: uid('wp'), lat, lon, kind: 'via', source: 'Klikket i kart', dataKind: 'forslag' }] } : r,
          ),
        })),
      insertWaypoint: (routeId, lat, lon) =>
        set((s) => ({
          routes: s.routes.map((r) => {
            if (r.id !== routeId || r.waypoints.length < 2) return r;
            // sett inn i segmentet som gir minst ekstra lengde
            let best = 1, bestCost = Infinity;
            const d = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 55);
            for (let i = 1; i < r.waypoints.length; i++) {
              const a = r.waypoints[i - 1], b = r.waypoints[i];
              const cost = d(a, { lat, lon }) + d({ lat, lon }, b) - d(a, b);
              if (cost < bestCost) { bestCost = cost; best = i; }
            }
            const wps = [...r.waypoints];
            wps.splice(best, 0, { id: uid('wp'), lat, lon, kind: 'via', source: 'Satt inn manuelt i kart', dataKind: 'forslag' });
            return { ...r, updatedAt: now(), waypoints: wps };
          }),
        })),
      duplicateRoute: (id) =>
        set((s) => {
          const r = s.routes.find((x) => x.id === id);
          if (!r) return {};
          const copy: Route = { ...r, id: uid('rt'), name: `${r.name} (kopi)`, kind: 'egen', color: '#f472b6', createdAt: now(), updatedAt: now(), waypoints: r.waypoints.map((w) => ({ ...w, id: uid('wp') })) };
          return { routes: [...s.routes, copy], activeRouteId: copy.id };
        }),
      setLayer: (k, v) => set((s) => ({ layers: { ...s.layers, [k]: v } })),
      focusOn: (lat, lon, zoom) => set({ focus: { lat, lon, zoom, t: Date.now() }, tab: 'kart' }),
    }),
    {
      name: 'kite.plan.v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { focus, editMode, draftZone, selectedWp, set: _s, ...rest } = s;
        return Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v !== 'function')) as Partial<State>;
      },
    },
  ),
);

export function routeHash(r: Route | undefined): string {
  if (!r) return 'none';
  let h = 0;
  const s = r.waypoints.map((w) => `${w.lat.toFixed(5)},${w.lon.toFixed(5)}`).join(';');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `${r.id}:${h}`;
}
