import { useStore } from '../../state/store';
import { majorChange } from '../../storage/hooks';
import { uid, type LatLon } from '../geo';
import type { Route } from '../../types';
import { nearestName } from '../api/kartverket';
import { buildWaypoints, draftFromRoute, insertIndex, newDraft, pt, shapeOf, validateDraft, type DraftPt, type DraftShape, type PtSource, type RouteDraft, type Step } from './draft';

/** Handlinger for ruteveiviseren. Utkastet ligger i minnet til «Lagre rute» – ingenting i prosjektet endres før det. */
const get = () => useStore.getState().routeDraft;
const put = (d: RouteDraft | null) => useStore.getState().set({ routeDraft: d, editMode: d ? 'draft' : 'none' });

/** Endring av punkter: tas vare på for «Angre». */
function change(fn: (d: RouteDraft) => Partial<DraftShape> & Partial<Pick<RouteDraft, 'step'>>) {
  const d = get();
  if (!d) return;
  const patch = fn(d);
  put({ ...d, ...patch, past: [...d.past, shapeOf(d)].slice(-50), future: [] });
}

export function startNewRoute() {
  const n = useStore.getState().routes.filter((r) => r.kind === 'egen').length + 1;
  put(newDraft(`Ny rute ${n}`));
  useStore.getState().set({ tab: 'oversikt', selectedWp: null, selectedMarker: null, selectedCamp: null, selectedBarrier: null });
}

export function editRoute(r: Route) {
  put(draftFromRoute(r));
  useStore.getState().set({ tab: 'oversikt', selectedWp: null, selectedMarker: null, selectedCamp: null, selectedBarrier: null });
}

export function cancelDraft() { put(null); }
export function setStep(step: Step) { const d = get(); if (d) put({ ...d, step }); }
export function setDraft(p: Partial<Pick<RouteDraft, 'name' | 'geometry' | 'useInScenario'>>) { const d = get(); if (d) put({ ...d, ...p }); }

export function setStart(p: LatLon, src: PtSource, name?: string) {
  const np = pt(p.lat, p.lon, src, name);
  change((d) => ({ start: np, step: d.step === 1 ? (d.finish ? 3 : 2) : d.step }));
  if (!name) void autoName(np.id, p);
}
export function setFinish(p: LatLon, src: PtSource, name?: string) {
  const np = pt(p.lat, p.lon, src, name);
  change((d) => ({ finish: np, step: d.step === 2 ? 3 : d.step }));
  if (!name) void autoName(np.id, p);
}

/** Gir et punkt valgt i kartet navnet på nærmeste sted (Kartverket, innen 2,5 km). Uten nett: punktet beholdes uten navn. */
async function autoName(id: string, p: LatLon) {
  try {
    const n = await nearestName(p);
    const d = get();
    if (!n || !d) return;
    const named = (x?: DraftPt) => (x && x.id === id && !x.name ? { ...x, name: n.name } : x);
    put({ ...d, start: named(d.start), finish: named(d.finish) });
  } catch { /* uten nett – navn kan skrives inn selv */ }
}
export function addVia(p: LatLon, src: PtSource, name?: string) {
  change((d) => {
    const via = [...d.via];
    via.splice(insertIndex(d, p), 0, pt(p.lat, p.lon, src, name));
    return { via, kept: undefined };
  });
}
/** Punkt flyttet (dra i kartet). id = start/mål/mellompunkt. */
export function movePoint(id: string, p: LatLon) {
  change((d) => ({
    start: d.start?.id === id ? { ...d.start, ...p } : d.start,
    finish: d.finish?.id === id ? { ...d.finish, ...p } : d.finish,
    via: d.via.map((v) => (v.id === id ? { ...v, ...p } : v)),
  }));
}
export function renamePoint(id: string, name: string) {
  change((d) => ({
    start: d.start?.id === id ? { ...d.start, name: name || undefined } : d.start,
    finish: d.finish?.id === id ? { ...d.finish, name: name || undefined } : d.finish,
    via: d.via.map((v) => (v.id === id ? { ...v, name: name || undefined } : v)),
  }));
}
export function removeVia(id: string) { change((d) => ({ via: d.via.filter((v) => v.id !== id) })); }
export function moveVia(id: string, dir: -1 | 1) {
  change((d) => {
    const i = d.via.findIndex((v) => v.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= d.via.length) return {};
    const via = [...d.via];
    [via[i], via[j]] = [via[j], via[i]];
    return { via };
  });
}
export function swapEnds() { change((d) => ({ start: d.finish, finish: d.start, via: [...d.via].reverse(), kept: d.kept ? [...d.kept].reverse() : undefined })); }
export function clearStart() { change(() => ({ start: undefined, step: 1 })); }
export function clearFinish() { change(() => ({ finish: undefined, step: 2 })); }
/** Erstatter detaljert geometri (store GPX-ruter) med egne mellompunkter. */
export function dropKept() { change(() => ({ kept: undefined, via: [] })); }

export function undo() {
  const d = get();
  if (!d || !d.past.length) return;
  const prev = d.past[d.past.length - 1];
  put({ ...d, ...prev, past: d.past.slice(0, -1), future: [shapeOf(d), ...d.future] });
}
export function redo() {
  const d = get();
  if (!d || !d.future.length) return;
  const [next, ...rest] = d.future;
  put({ ...d, ...next, past: [...d.past, shapeOf(d)], future: rest });
}

/** Klikk i kartet mens veiviseren er åpen. */
export function mapClick(p: LatLon) {
  const d = get();
  if (!d) return;
  if (d.step === 1) setStart(p, 'kart');
  else if (d.step === 2) setFinish(p, 'kart');
  else if (d.step === 3 || d.step === 4) {
    if (!d.start) setStart(p, 'kart');
    else if (!d.finish) setFinish(p, 'kart');
    else addVia(p, 'kart');
  }
}

/** Lagrer ruten i prosjektet. Kaster feil med forklaring hvis noe mangler. */
export function saveDraft(): Route {
  const d = get();
  if (!d) throw new Error('Ingen rute under arbeid.');
  const errs = validateDraft(d);
  if (errs.length) throw new Error(errs.map((e) => e.text).join(' '));
  const st = useStore.getState();
  const old = d.editId ? st.routes.find((r) => r.id === d.editId) : undefined;
  const ref = d.geometry !== 'rett' ? st.routes.find((r) => r.id === d.geometry) : undefined;
  const wps = buildWaypoints(d, ref);
  if (wps.length < 2) throw new Error('Ruten trenger minst start og mål.');
  const t = new Date().toISOString();
  if (old) majorChange.fn(`Før redigering av rute «${old.name}»`);
  const route: Route = old
    ? { ...old, name: d.name.trim(), waypoints: wps, updatedAt: t }
    : { id: uid('rt'), name: d.name.trim(), kind: 'egen', color: '#a855f7', description: `Laget i ruteveiviseren ${t.slice(0, 10)}${ref ? ` (følger «${ref.name}» der punktene ligger nær den)` : ' – rette linjer mellom punktene'}.`, waypoints: wps, visible: true, createdAt: t, updatedAt: t };
  st.upsertRoute(route);
  st.log('rute', `${old ? 'Endret' : 'Laget'} rute «${route.name}»: ${wps[0].name ?? 'start'} → ${wps[wps.length - 1].name ?? 'mål'} (${wps.length} punkter)`);
  if (d.useInScenario || old?.id === st.activeRouteId) useStore.getState().set({ activeRouteId: route.id });
  // veiviseren blir stående på steg 6 (eksport) med den lagrede ruten – videre endringer redigerer den
  put({ ...draftFromRoute(route), useInScenario: d.useInScenario, geometry: 'rett', step: 6, savedAt: t });
  return route;
}

export type { DraftPt };
