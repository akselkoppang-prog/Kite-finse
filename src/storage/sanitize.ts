import { examplePlan, newDay, type DayPlan, type PlanScenario } from '../lib/sim/expedition';
import { KITES } from '../data/kites';

/**
 * Validering og reparasjon av prosjektdata før de tas i bruk.
 *
 * ALLE veier inn i appen går gjennom her: oppstart (IndexedDB), import av ZIP/JSON, gjenoppretting av
 * sikkerhetskopi og nødkopi. Data kan være fra en eldre versjon, redigert for hånd eller skadet.
 * Regelen er: behold alt som er gyldig, fyll inn standardverdier for det som mangler, og fjern bare det
 * som ikke kan brukes (f.eks. et rutepunkt uten koordinater). Funksjonen kaster aldri feil.
 */
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const num = (v: unknown, def: number, min = -Infinity, max = Infinity): number => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return fin(n) ? Math.min(max, Math.max(min, n)) : def;
};
const str = (v: unknown, def = ''): string => (typeof v === 'string' ? v : def);
const okLat = (v: unknown) => fin(v) && v >= -90 && v <= 90;
const okLon = (v: unknown) => fin(v) && v >= -180 && v <= 180;
const okDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T12:00:00Z`));
const withId = (a: unknown): Obj[] => (Array.isArray(a) ? a.filter((x): x is Obj => isObj(x) && typeof x.id === 'string' && x.id !== '') : []);
const located = (a: unknown): Obj[] => withId(a).filter((x) => okLat(x.lat) && okLon(x.lon));

/** Felt som er «skjema» (faste nøkler): manglende nøkler fylles fra standard, så eldre data tåler nye innstillinger. */
const STRUCTS = ['layers', 'wms', 'sim', 'simParams', 'travel', 'food', 'daily', 'sunCfg', 'project', 'exportPrefs'];

export interface SanitizeReport { fixed: string[] }

function day(d: unknown): DayPlan {
  const base = newDay();
  if (!isObj(d)) return base;
  const w = isObj(d.wind) ? d.wind : {};
  const avg = num(w.avg, base.wind.avg, 0, 60);
  const t = isObj(d.target) ? d.target : {};
  const mode = t.mode === 'km' || t.mode === 'stopp' ? t.mode : 'auto';
  const mix = isObj(d.mix) ? d.mix : {};
  return {
    ...(d as unknown as DayPlan),
    id: str(d.id) || base.id,
    departure: num(d.departure, base.departure, 0, 23.75),
    activeH: num(d.activeH, base.activeH, 0.5, 16),
    breakH: num(d.breakH, base.breakH, 0, 12),
    speedKmh: num(d.speedKmh, base.speedKmh, 3, 80),
    kiteId: d.kiteId === 'auto' || KITES.some((k) => k.id === d.kiteId) ? (d.kiteId as string) : 'auto',
    windMode: d.windMode === 'prognose' || d.windMode === 'blandet' ? d.windMode : 'manuell',
    wind: {
      dir: ((num(w.dir, base.wind.dir) % 360) + 360) % 360,
      avg,
      min: Math.min(avg, num(w.min, Math.min(avg, base.wind.min), 0, 60)),
      max: Math.max(avg, num(w.max, Math.max(avg, base.wind.max), 0, 80)),
      gust: Math.max(avg, num(w.gust, Math.max(avg, base.wind.gust), 0, 100)),
      variability: num(w.variability, base.wind.variability, 0, 0.8),
      favorableH: num(w.favorableH, base.wind.favorableH, 0.5, 24),
    },
    mix: { speedFactor: num(mix.speedFactor, 1, 0.1, 3), dirOffset: num(mix.dirOffset, 0, -180, 180) },
    target: mode === 'km' ? { mode, km: num(t.km, 40, 1, 500) } : mode === 'stopp' && fin(t.stopD) ? { mode, stopD: Math.max(0, t.stopD) } : { mode: 'auto' },
    campId: typeof d.campId === 'string' ? d.campId : undefined,
    note: typeof d.note === 'string' ? d.note : undefined,
  };
}

function plans(v: unknown, fallbackDate: string): PlanScenario[] {
  const out = withId(v)
    .map((p) => ({ ...(p as unknown as PlanScenario), name: str(p.name) || 'Scenario', days: (Array.isArray(p.days) ? p.days : []).map(day), tripDate: okDate(p.tripDate) ? p.tripDate : fallbackDate, createdAt: str(p.createdAt) || new Date(0).toISOString(), updatedAt: str(p.updatedAt) || new Date(0).toISOString() }))
    .filter((p) => p.days.length > 0);
  // like id-er ville gjort at to scenarioer endres samtidig – behold den første
  return out.filter((p, i) => out.findIndex((x) => x.id === p.id) === i);
}

/**
 * Returnerer en trygg kopi av `raw` (bare kjente felt endres; ukjente felt følger med urørt).
 * `initial` er appens standardtilstand – brukes som mal for typer og standardverdier.
 */
export function sanitizeState(raw: Obj, initial: Obj): { state: Obj; report: SanitizeReport } {
  const s: Obj = { ...raw };
  const fixed: string[] = [];
  const note = (m: string) => fixed.push(m);
  try {
    // 1) riktig grunntype per felt (liste / objekt / tall / tekst) – ellers standardverdi
    for (const [k, def] of Object.entries(initial)) {
      if (typeof def === 'function' || !(k in s) || s[k] === undefined) continue;
      const v = s[k];
      const bad = Array.isArray(def) ? !Array.isArray(v) : isObj(def) ? !isObj(v) : typeof def === 'number' ? !fin(v) : typeof def === 'string' ? typeof v !== 'string' : typeof def === 'boolean' ? typeof v !== 'boolean' : false;
      if (bad) {
        s[k] = def;
        note(`«${k}» hadde feil type og er satt til standard`);
      }
    }
    // 2) skjema-objekter: fyll inn manglende nøkler, og tall som ikke er tall
    for (const k of STRUCTS) {
      const def = initial[k];
      if (!isObj(def) || !isObj(s[k])) continue;
      const cur = s[k] as Obj;
      const merged: Obj = { ...def, ...cur };
      for (const [kk, dv] of Object.entries(def)) {
        if (typeof dv === 'number' && !fin(merged[kk])) merged[kk] = dv;
        else if (isObj(dv)) merged[kk] = isObj(cur[kk]) ? { ...dv, ...(cur[kk] as Obj) } : dv;
        else if (Array.isArray(dv) && !Array.isArray(merged[kk])) merged[kk] = dv;
        else if (typeof dv === 'string' && typeof merged[kk] !== 'string') merged[kk] = dv;
        else if (typeof dv === 'boolean' && typeof merged[kk] !== 'boolean') merged[kk] = dv;
      }
      s[k] = merged;
    }
    // 3) datoer og enkelttall
    if ('tripDate' in s && !okDate(s.tripDate)) {
      s.tripDate = initial.tripDate;
      note('Ugyldig avreisedato er satt til standard');
    }
    for (const [k, min, max] of [['riderKg', 20, 250], ['pulkKg', 0, 300], ['tripDays', 1, 60], ['windSpeed', 0, 60], ['windGust', 0, 100], ['budget', 0, 1e9]] as const) if (k in s) s[k] = num(s[k], initial[k] as number, min, max);
    // 4) ruter: bare punkter med gyldige koordinater; ruter uten id fjernes
    if ('routes' in s) {
      const before = Array.isArray(s.routes) ? s.routes.length : 0;
      let dropped = 0;
      s.routes = withId(s.routes).map((r) => {
        const wps = (Array.isArray(r.waypoints) ? r.waypoints : []).filter((w): w is Obj => isObj(w) && okLat(w.lat) && okLon(w.lon)).map((w, i) => ({ ...w, id: str(w.id) || `wp-${r.id}-${i}`, kind: str(w.kind) || 'via', source: str(w.source) || 'ukjent', dataKind: str(w.dataKind) || 'forslag', eleGpx: fin(w.eleGpx) ? w.eleGpx : undefined }));
        dropped += (Array.isArray(r.waypoints) ? r.waypoints.length : 0) - wps.length;
        return { ...r, name: str(r.name) || 'Rute uten navn', kind: str(r.kind) || 'egen', color: str(r.color) || '#ef4444', description: str(r.description), visible: r.visible !== false, waypoints: wps, dayBreaks: Array.isArray(r.dayBreaks) && r.dayBreaks.every(fin) ? r.dayBreaks : undefined };
      });
      if ((s.routes as Obj[]).length !== before) note(`${before - (s.routes as Obj[]).length} rute(r) uten gyldig id ble utelatt`);
      if (dropped) note(`${dropped} rutepunkt uten gyldige koordinater ble utelatt`);
    }
    if ('activeRouteId' in s || 'routes' in s) {
      const rs = (s.routes as Obj[] | undefined) ?? [];
      if ('routes' in s && !rs.some((r) => r.id === s.activeRouteId)) s.activeRouteId = rs[0]?.id ?? null;
    }
    // 5) steder med koordinater
    for (const k of ['camps', 'markers', 'crossings'] as const)
      if (k in s) {
        const before = Array.isArray(s[k]) ? (s[k] as unknown[]).length : 0;
        s[k] = located(s[k]).map((x) => ({ ...x, name: str(x.name) || (k === 'camps' ? 'Teltplass' : k === 'markers' ? 'Markør' : 'Krysning') }));
        if ((s[k] as Obj[]).length !== before) note(`${before - (s[k] as Obj[]).length} element(er) i «${k}» manglet id eller koordinater og ble utelatt`);
      }
    if ('camps' in s) s.camps = (s.camps as Obj[]).map((c) => ({ ...c, night: num(c.night, 1, 1, 60), source: str(c.source) || 'manuell', capacity: c.capacity == null ? undefined : num(c.capacity, 0, 0, 1000), costPerPerson: c.costPerPerson == null ? undefined : num(c.costPerPerson, 0, 0, 1e7), scenarioIds: Array.isArray(c.scenarioIds) ? c.scenarioIds.filter((x) => typeof x === 'string') : undefined }));
    if ('markers' in s) s.markers = (s.markers as Obj[]).map((m) => ({ ...m, category: str(m.category) || 'note', source: str(m.source) || 'ukjent' }));
    if ('crossings' in s) s.crossings = (s.crossings as Obj[]).map((c) => ({ ...c, kind: str(c.kind) || 'annet', waitMin: num(c.waitMin, 0, 0, 1440), transferMin: num(c.transferMin, 0, 0, 1440), schedule: typeof c.schedule === 'string' ? c.schedule : undefined }));
    if ('zones' in s) s.zones = withId(s.zones).map((z) => ({ ...z, name: str(z.name) || 'Sone', kind: str(z.kind) || 'usikker', ring: (Array.isArray(z.ring) ? z.ring : []).filter((p) => isObj(p) && okLat(p.lat) && okLon(p.lon)) })).filter((z) => z.ring.length >= 3);
    // 6) scenarioer: minst ett, gyldige dager, gyldige pekere
    if ('plans' in s) {
      const date = okDate(s.tripDate) ? s.tripDate : (initial.tripDate as string);
      let ps = plans(s.plans, date);
      if (!ps.length) {
        ps = [{ ...examplePlan(), tripDate: date }];
        note('Fant ingen gyldige scenarioer – en standard hovedplan er lagt inn');
      }
      s.plans = ps;
      if (!ps.some((p) => p.id === s.mainPlanId)) s.mainPlanId = ps[0].id;
      if (!ps.some((p) => p.id === s.activePlanId)) s.activePlanId = s.mainPlanId;
      s.compareIds = (Array.isArray(s.compareIds) ? s.compareIds : []).filter((id) => ps.some((p) => p.id === id));
      // datoen appen viser er alltid datoen til scenarioet som er åpent
      const active = ps.find((p) => p.id === s.activePlanId)!;
      if (active.tripDate && okDate(active.tripDate)) s.tripDate = active.tripDate;
      s.tripDays = active.days.length;
    }
    // 7) kites: bare kjente, og alltid et gyldig utvalg
    if ('quivers' in s) {
      let qs: Obj[] = withId(s.quivers).map((q) => ({ ...q, name: str(q.name) || 'Kites', kiteIds: (Array.isArray(q.kiteIds) ? q.kiteIds : []).filter((id) => KITES.some((k) => k.id === id)) }));
      if (!qs.length) qs = initial.quivers as Obj[];
      s.quivers = qs;
      if (!qs.some((q) => q.id === s.activeQuiverId)) s.activeQuiverId = qs[0].id;
    }
    // 8) utstyr, mat, team, oppgaver, utgifter, dokumenter
    if ('gearLists' in s) {
      let gl: Obj[] = withId(s.gearLists).map((l) => ({ ...l, name: str(l.name) || 'Utstyrsliste', items: withId(l.items).map((g) => ({ ...g, name: str(g.name) || 'Utstyr', cat: str(g.cat) || 'Hygiene og diverse', qty: num(g.qty, 1, 0, 9999), kg: g.kg == null ? undefined : num(g.kg, 0, 0, 500), carry: g.carry === 'kropp' ? 'kropp' : 'pulk', packed: g.packed === true })) }));
      if (!gl.length) gl = [{ id: 'gear-main', name: 'Hovedliste', items: [] }];
      s.gearLists = gl;
    }
    if ('foods' in s) {
      s.foods = withId(s.foods).map((f) => ({ ...f, name: str(f.name) || 'Matvare', kcal: num(f.kcal, 0, 0, 1000), protein: num(f.protein, 0, 0, 100), fat: num(f.fat, 0, 0, 100), carbs: num(f.carbs, 0, 0, 100), ml: num(f.ml, 150, 0, 5000), packG: f.packG == null ? undefined : num(f.packG, 0, 1, 1e6) }));
      if (!(s.foods as Obj[]).length) s.foods = initial.foods;
    }
    if ('meals' in s) {
      const SLOTS = ['frokost', 'lunsj', 'middag', 'snacks'];
      s.meals = withId(s.meals).filter((m) => SLOTS.includes(m.slot as string)).map((m) => ({ ...m, name: str(m.name) || 'Måltid', items: (Array.isArray(m.items) ? m.items : []).filter((it): it is Obj => isObj(it) && typeof it.foodId === 'string').map((it) => ({ foodId: it.foodId, g: num(it.g, 0, 0, 5000) })) }));
      if (!(s.meals as Obj[]).length) s.meals = initial.meals;
    }
    if ('team' in s) s.team = withId(s.team).map((m) => ({ ...m, name: str(m.name) || 'Uten navn', role: str(m.role), weightKg: m.weightKg == null ? undefined : num(m.weightKg, 75, 20, 250) }));
    if ('tasks' in s) s.tasks = withId(s.tasks).map((t) => ({ ...t, title: str(t.title) || 'Oppgave', done: t.done === true, due: okDate(t.due) ? t.due : undefined, createdAt: str(t.createdAt) || new Date(0).toISOString() }));
    if ('expenses' in s) s.expenses = withId(s.expenses).map((e) => ({ ...e, text: str(e.text) || 'Utgift', amount: num(e.amount, 0, -1e9, 1e9), cat: str(e.cat) || 'Annet' }));
    if ('documents' in s) s.documents = withId(s.documents).map((d) => ({ ...d, name: str(d.name) || 'Dokument', url: str(d.url) }));
    for (const k of ['lakeOverrides', 'customCategories', 'calibTracks', 'itineraries', 'scenarios'] as const) if (k in s) s[k] = withId(s[k]);
    if ('scenarios' in s && !(s.scenarios as Obj[]).length) s.scenarios = initial.scenarios;
    if ('scenarios' in s && !(s.scenarios as Obj[]).some((x) => x.id === s.scenarioId)) s.scenarioId = (s.scenarios as Obj[])[0]?.id;
    if ('history' in s) s.history = (s.history as unknown[]).filter(isObj).slice(0, 300);
    if ('packing' in s) s.packing = withId(s.packing);
    // 9) oppslagstabeller og hurtigbuffer (kan hentes på nytt – ugyldig innhold forkastes)
    if (isObj(s.places)) s.places = Object.fromEntries(Object.entries(s.places).filter(([, v]) => isObj(v) && okLat(v.lat) && okLon(v.lon)).map(([k, v]) => [k, { ...(v as Obj), name: str((v as Obj).name) || k, type: str((v as Obj).type), role: Array.isArray((v as Obj).role) ? (v as Obj).role : [], source: str((v as Obj).source), fetchedAt: str((v as Obj).fetchedAt) }]));
    if (isObj(s.kiteOverrides)) s.kiteOverrides = Object.fromEntries(Object.entries(s.kiteOverrides).filter(([, v]) => isObj(v) && fin(v.low) && fin(v.high) && v.high > v.low));
    for (const k of ['kiteModelEdits', 'kiteSpecEdits'] as const) if (isObj(s[k])) s[k] = Object.fromEntries(Object.entries(s[k] as Obj).filter(([, v]) => isObj(v)));
    for (const k of ['acks', 'dayNotes', 'kiteNotes'] as const) if (isObj(s[k])) s[k] = Object.fromEntries(Object.entries(s[k] as Obj).filter(([, v]) => typeof v === 'string'));
    const okPoints = (v: unknown) => Array.isArray(v) && v.every((p) => isObj(p) && okLat(p.lat) && okLon(p.lon) && fin(p.d) && isObj(p.fc) && Array.isArray((p.fc as Obj).rows));
    if (isObj(s.weather)) s.weather = Object.fromEntries(Object.entries(s.weather).filter(([, v]) => isObj(v) && typeof v.routeKey === 'string' && okPoints(v.points)).map(([k, v]) => [k, { ...(v as Obj), errors: Array.isArray((v as Obj).errors) ? (v as Obj).errors : [] }]));
    if ('routeForecast' in s && s.routeForecast != null && !(isObj(s.routeForecast) && okPoints(s.routeForecast.points))) s.routeForecast = null;
    if ('weatherAlerts' in s && s.weatherAlerts != null && !(isObj(s.weatherAlerts) && Array.isArray(s.weatherAlerts.alerts))) s.weatherAlerts = null;
    if ('hydro' in s && s.hydro != null && !(isObj(s.hydro) && Array.isArray(s.hydro.reservoirs))) s.hydro = null;
  } catch (e) {
    // skal ikke skje – men data fra brukeren skal aldri kunne stoppe oppstarten
    note(`Validering avbrutt: ${(e as Error).message}`);
  }
  return { state: s, report: { fixed } };
}
