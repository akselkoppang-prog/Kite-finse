import { cumulative, pointAt, type LatLon } from '../geo';
import { APP_VERSION } from '../version';
import { cachedElevation } from '../api/kartverket';
import { hhmm } from '../sim/expedition';
import type { ExportSnapshot } from './snapshot';
import type { Camp, Marker, Route, Waypoint } from '../../types';

/**
 * GPX 1.1 for Garmin, GPS-enheter og kartapper.
 * Koordinatene skrives med full presisjon (samme tall som er lagret – ingen avrunding).
 * Punkter på rutelinjen beholdes uendret; bare start/slutt på en dagsetappe er interpolert (merket i navnet).
 */
export interface GpxPt extends LatLon { ele?: number; name?: string; time?: string }
export interface GpxWpt extends LatLon { ele?: number; name: string; desc?: string; cmt?: string; sym?: string; type?: string }
export interface GpxTrack { name: string; desc?: string; type?: string; points: GpxPt[] }

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const num = (n: number) => String(n); // full presisjon
const ll = (p: LatLon) => `lat="${num(p.lat)}" lon="${num(p.lon)}"`;
const eleOf = (w: Waypoint | GpxPt): number | undefined => ('eleGpx' in w && w.eleGpx != null ? w.eleGpx : 'ele' in w && w.ele != null ? w.ele : cachedElevation(w)?.z ?? undefined);

export function buildGpx(meta: { name: string; desc?: string }, tracks: GpxTrack[], wpts: GpxWpt[]): string {
  const now = new Date().toISOString();
  const w = wpts.map((p) => `  <wpt ${ll(p)}>${p.ele != null ? `<ele>${p.ele.toFixed(1)}</ele>` : ''}<name>${esc(p.name)}</name>${p.cmt ? `<cmt>${esc(p.cmt)}</cmt>` : ''}${p.desc ? `<desc>${esc(p.desc)}</desc>` : ''}${p.sym ? `<sym>${esc(p.sym)}</sym>` : ''}${p.type ? `<type>${esc(p.type)}</type>` : ''}</wpt>`);
  const t = tracks.map((tr) => `  <trk>\n    <name>${esc(tr.name)}</name>${tr.desc ? `\n    <desc>${esc(tr.desc)}</desc>` : ''}${tr.type ? `\n    <type>${esc(tr.type)}</type>` : ''}\n    <trkseg>\n${tr.points.map((p) => `      <trkpt ${ll(p)}>${p.ele != null ? `<ele>${p.ele.toFixed(1)}</ele>` : ''}${p.time ? `<time>${p.time}</time>` : ''}${p.name ? `<name>${esc(p.name)}</name>` : ''}</trkpt>`).join('\n')}\n    </trkseg>\n  </trk>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Snowkite-ekspedisjonsplanlegger ${APP_VERSION}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata><name>${esc(meta.name)}</name>${meta.desc ? `<desc>${esc(meta.desc)}</desc>` : ''}<time>${now}</time></metadata>
${[...w, ...t].join('\n')}
</gpx>
`;
}

const toPt = (w: Waypoint): GpxPt => ({ lat: w.lat, lon: w.lon, ele: eleOf(w), name: w.name });

export function routeTrack(r: Route, label?: string): GpxTrack {
  return { name: label ?? r.name, desc: `${r.description ?? ''} | Planlagt rute – ikke verifisert i terrenget.`.replace(/^ \| /, ''), type: r.kind, points: r.waypoints.map(toPt) };
}

/** Del av ruten mellom to avstander (m). Punktene imellom er de originale; endepunktene interpoleres. */
export function sliceRoute(r: Route, fromD: number, toD: number, labels: [string, string] = ['Start', 'Slutt']): GpxPt[] {
  const wps = r.waypoints;
  const cum = cumulative(wps);
  const total = cum[cum.length - 1];
  const a = Math.max(0, Math.min(fromD, total)), b = Math.max(a, Math.min(toD, total));
  const out: GpxPt[] = [];
  const start = pointAt(wps, cum, a);
  const exactStart = wps.findIndex((_, i) => Math.abs(cum[i] - a) < 0.5);
  out.push(exactStart >= 0 ? { ...toPt(wps[exactStart]), name: wps[exactStart].name ?? labels[0] } : { lat: start.lat, lon: start.lon, ele: cachedElevation(start)?.z ?? undefined, name: `${labels[0]} (beregnet)` });
  for (let i = 0; i < wps.length; i++) if (cum[i] > a + 0.5 && cum[i] < b - 0.5) out.push(toPt(wps[i]));
  const exactEnd = wps.findIndex((_, i) => Math.abs(cum[i] - b) < 0.5);
  const end = pointAt(wps, cum, b);
  if (b > a) out.push(exactEnd >= 0 ? { ...toPt(wps[exactEnd]), name: wps[exactEnd].name ?? labels[1] } : { lat: end.lat, lon: end.lon, ele: cachedElevation(end)?.z ?? undefined, name: `${labels[1]} (beregnet)` });
  return out;
}

export function waypointWpts(r: Route): GpxWpt[] {
  return r.waypoints
    .filter((w) => (w.name && w.kind !== 'via') || w.category || w.description || w.notes)
    .map((w) => ({ lat: w.lat, lon: w.lon, ele: eleOf(w), name: w.name ?? 'Rutepunkt', desc: [w.description, `Status: ${w.verification ?? 'uverifisert'} · kilde: ${w.source}`].filter(Boolean).join(' | '), cmt: w.notes, type: w.category }));
}
export const campWpts = (camps: Camp[], arrival?: Map<string, string>): GpxWpt[] =>
  camps.map((c) => ({ lat: c.lat, lon: c.lon, ele: cachedElevation(c)?.z ?? undefined, name: c.name, desc: [c.description, arrival?.get(c.id), c.assessment && `Din vurdering: ${c.assessment}`, 'Ikke befart av appen'].filter(Boolean).join(' | '), cmt: c.notes ?? c.note, sym: 'Campground', type: 'teltplass' }));
export const markerWpts = (ms: Marker[]): GpxWpt[] => ms.map((m) => ({ lat: m.lat, lon: m.lon, name: m.name, desc: [m.description, `Status: ${m.verification ?? 'uverifisert'}`].filter(Boolean).join(' | '), cmt: m.notes, type: m.category }));

export type GpxKind = 'hele' | 'dag' | 'alternativ' | 'segment';
export interface GpxRequest { kind: GpxKind; day?: number; routeId?: string; fromKm?: number; toKm?: number; withCamps: boolean; withWaypoints: boolean; withMarkers: boolean }

/** Bygger GPX fra et eksport-øyeblikksbilde. */
export function exportGpx(snap: ExportSnapshot, req: GpxRequest): { name: string; xml: string } {
  const { st, run } = snap;
  const route = req.kind === 'alternativ' ? st.routes.find((r) => r.id === req.routeId) : snap.route;
  if (!route) throw new Error('Ingen rute å eksportere');
  const arrival = new Map<string, string>();
  run.days.forEach((d, i) => {
    const cid = run.plan.days[i]?.campId;
    if (cid) arrival.set(cid, `Overnatting etter dag ${d.day} – forventet ankomst ${hhmm(d.arrival)} (${d.date})`);
  });
  const wpts: GpxWpt[] = [...(req.withWaypoints ? waypointWpts(route) : []), ...(req.withCamps ? campWpts(req.kind === 'dag' ? snap.usedCamps.filter((c) => run.plan.days[(req.day ?? 1) - 1]?.campId === c.id) : st.camps, arrival) : []), ...(req.withMarkers ? markerWpts(st.markers) : [])];
  const proj = st.project.name;
  if (req.kind === 'dag') {
    const d = run.days[(req.day ?? 1) - 1];
    if (!d) throw new Error('Fant ikke dagen');
    const pts = sliceRoute(route, d.startD, d.endD, [`Start dag ${d.day}`, `Mål dag ${d.day}`]);
    return { name: `dag-${d.day}`, xml: buildGpx({ name: `${proj} – dag ${d.day} (${d.date})`, desc: `Scenario «${run.plan.name}». ${((d.endD - d.startD) / 1000).toFixed(1)} km, avreise ${hhmm(d.departure)}, forventet ankomst ${hhmm(d.arrival)}. Planlagt – ikke verifisert.` }, [{ name: `Dag ${d.day}: ${route.name}`, desc: `Km ${(d.startD / 1000).toFixed(1)}–${(d.endD / 1000).toFixed(1)}`, points: pts }], wpts) };
  }
  if (req.kind === 'segment') {
    const a = (req.fromKm ?? 0) * 1000, b = (req.toKm ?? 0) * 1000;
    return { name: `segment-${req.fromKm}-${req.toKm}km`, xml: buildGpx({ name: `${proj} – ${route.name} km ${req.fromKm}–${req.toKm}` }, [{ name: `${route.name} km ${req.fromKm}–${req.toKm}`, points: sliceRoute(route, a, b) }], wpts) };
  }
  // hele ruten (+ dagsetapper som egne spor for enheter som viser dem separat er unødvendig – ett spor)
  return { name: req.kind === 'alternativ' ? `rute-${route.name}` : 'hele-ruten', xml: buildGpx({ name: `${proj} – ${route.name}`, desc: `Scenario «${run.plan.name}». Planlagt rute – ikke verifisert i terrenget. Eksportert fra snowkite-planleggeren.` }, [routeTrack(route)], wpts) };
}
