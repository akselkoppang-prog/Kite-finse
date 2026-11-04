import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Camp, HistoryEntry, LakeOverride, Marker, Place, Quiver, Route, Waypoint, Zone } from '../types';
import type { Category } from '../data/categories';
import { DEFAULT_PARAMS, DEFAULT_SCENARIOS, type Scenario, type TravelParams } from '../lib/analysis/feasibility';
import type { Forecast } from '../lib/api/met';
import { DEFAULT_PACKING, type PackItem } from '../data/packing';
import type { Dir8 } from '../lib/geo';
import type { NveHydro, PolyFeature } from '../lib/api/nve';
import type { TerrainAnalysis } from '../lib/analysis/terrain';
import type { Snow, Terrain, Goal } from '../lib/analysis/kite';
import { uid } from '../lib/geo';

export type Tab = 'kart' | 'vind' | 'kite' | 'sikkerhet' | 'dagplan' | 'overstyring' | 'utstyr' | 'tidslinje' | 'kilder';
export type EditMode = 'none' | 'add' | 'insert' | 'zone' | 'camp' | 'marker';

export interface WindPoint { label: string; lat: number; lon: number; fc: Forecast }
export interface FoodPlan { kcalPerDay: number; kcalPerKg: number; fuelLPerDay: number; reserveDays: number; extraDays: number }

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
  markers: boolean;
  windArrows: boolean;
  dayBreaks: boolean;
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
  selectedMarker: string | null;
  selectedBarrier: string | null;
  markers: Marker[];
  customCategories: Category[];
  hiddenCategories: string[];
  lakeOverrides: LakeOverride[];
  quivers: Quiver[];
  activeQuiverId: string;
  kiteNotes: Record<string, string>;
  tripDays: number;
  altDates: string[];
  travel: TravelParams;
  scenarios: Scenario[];
  scenarioId: 'A' | 'B' | 'C';
  dayNotes: Record<string, string>;
  packing: PackItem[];
  food: FoodPlan;
  history: HistoryEntry[];
  frostClientId: string;
  forecastHour: number;
  windPoints: WindPoint[];

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
  log: (kind: HistoryEntry['kind'], text: string) => void;
  updateWaypoint: (routeId: string, wpId: string, patch: Partial<Waypoint>) => void;
  moveWaypointIndex: (routeId: string, wpId: string, dir: -1 | 1) => void;
  setDayBreaks: (routeId: string, breaks: number[]) => void;
  upsertOverride: (o: LakeOverride, text: string) => void;
}

const now = () => new Date().toISOString();
function pushHist(h: HistoryEntry[], kind: HistoryEntry['kind'], text: string): HistoryEntry[] {
  return [{ at: now(), kind, text }, ...h].slice(0, 300);
}

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
      layers: { base: 'topo', nveWms: false, skredWms: false, reservoirs: true, lakes: true, places: true, routes: true, alternatives: true, camps: true, zones: true, windColor: false, steep: true, markers: true, windArrows: true, dayBreaks: true },
      wms: {
        nve: { url: 'https://nve.geodataonline.no/arcgis/services/Vannkraft1/MapServer/WmsServer', layers: '' },
        skred: { url: 'https://nve.geodataonline.no/arcgis/services/Bratthet/MapServer/WMSServer', layers: '' },
      },
      editMode: 'none',
      focus: null,
      selectedWp: null,
      selectedMarker: null,
      selectedBarrier: null,
      markers: [],
      customCategories: [],
      hiddenCategories: [],
      lakeOverrides: [],
      quivers: [
        { id: 'q-forslag', name: 'Forslag (rådgivende)', kiteIds: ['peak4', 'hyper7', 'sonic10', 'soul15'], primary: 'sonic10', secondary: 'soul15', storm: 'peak4', note: 'Verktøyets forslag – endre fritt.' },
        { id: 'q-alle', name: 'Hele inventaret', kiteIds: ['peak4', 'hyper7', 'stoke9', 'sonic10', 'pivot10', 'soul15', 'soul18'], primary: 'sonic10' },
      ],
      activeQuiverId: 'q-forslag',
      kiteNotes: {},
      tripDays: 3,
      altDates: [],
      travel: DEFAULT_PARAMS,
      scenarios: DEFAULT_SCENARIOS,
      scenarioId: 'A',
      dayNotes: {},
      packing: DEFAULT_PACKING,
      food: { kcalPerDay: 4500, kcalPerKg: 4800, fuelLPerDay: 0.2, reserveDays: 1, extraDays: 0 },
      history: [],
      frostClientId: '',
      forecastHour: 0,
      windPoints: [],

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
          history: pushHist(s.history, 'rute', `Flyttet punkt i «${s.routes.find((r) => r.id === routeId)?.name}» til ${lat.toFixed(4)}, ${lon.toFixed(4)}`),
          routes: s.routes.map((r) =>
            r.id === routeId
              ? { ...r, updatedAt: now(), waypoints: r.waypoints.map((w) => (w.id === wpId ? { ...w, lat, lon, eleGpx: undefined, dataKind: 'forslag', source: `${w.source} → flyttet manuelt ${now().slice(0, 10)}` } : w)) }
              : r,
          ),
        })),
      deleteWaypoint: (routeId, wpId) => set((s) => ({ history: pushHist(s.history, 'rute', `Slettet punkt ${s.routes.find((r) => r.id === routeId)?.waypoints.find((w) => w.id === wpId)?.name ?? ''} i «${s.routes.find((r) => r.id === routeId)?.name}»`), routes: s.routes.map((r) => (r.id === routeId ? { ...r, updatedAt: now(), waypoints: r.waypoints.filter((w) => w.id !== wpId) } : r)) })),
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
      log: (kind, text) => set((s) => ({ history: pushHist(s.history, kind, text) })),
      updateWaypoint: (routeId, wpId, patch) =>
        set((s) => ({
          routes: s.routes.map((r) => (r.id === routeId ? { ...r, updatedAt: now(), waypoints: r.waypoints.map((w) => (w.id === wpId ? { ...w, ...patch, updatedAt: now(), createdAt: w.createdAt ?? now() } : w)) } : r)),
        })),
      moveWaypointIndex: (routeId, wpId, dir) =>
        set((s) => ({
          history: pushHist(s.history, 'rute', `Endret rekkefølge på punkt i «${s.routes.find((r) => r.id === routeId)?.name}»`),
          routes: s.routes.map((r) => {
            if (r.id !== routeId) return r;
            const i = r.waypoints.findIndex((w) => w.id === wpId);
            const j = i + dir;
            if (i < 0 || j < 0 || j >= r.waypoints.length) return r;
            const wps = [...r.waypoints];
            [wps[i], wps[j]] = [wps[j], wps[i]];
            return { ...r, waypoints: wps, updatedAt: now() };
          }),
        })),
      setDayBreaks: (routeId, breaks) => set((s) => ({ routes: s.routes.map((r) => (r.id === routeId ? { ...r, dayBreaks: [...breaks].sort((a, b) => a - b) } : r)) })),
      upsertOverride: (o, text) =>
        set((s) => ({
          lakeOverrides: s.lakeOverrides.some((x) => x.id === o.id) ? s.lakeOverrides.map((x) => (x.id === o.id ? o : x)) : [...s.lakeOverrides, o],
          history: pushHist(s.history, 'overstyring', text),
        })),
      setLayer: (k, v) => set((s) => ({ layers: { ...s.layers, [k]: v } })),
      focusOn: (lat, lon, zoom) => set({ focus: { lat, lon, zoom, t: Date.now() }, tab: 'kart' }),
    }),
    {
      name: 'kite.plan.v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { focus, editMode, draftZone, selectedWp, selectedMarker, selectedBarrier, forecastHour, windPoints, set: _s, ...rest } = s;
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
