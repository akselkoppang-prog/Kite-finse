import { cachedElevation } from '../api/kartverket';
import { hhmm, DAY_COLORS } from '../sim/expedition';
import { sliceRoute } from './gpx';
import type { ExportSnapshot } from './snapshot';
import type { LatLon } from '../geo';

/**
 * Gyldig GeoJSON (RFC 7946): WGS 84, koordinater i rekkefølgen [lengdegrad, breddegrad, høyde].
 * Ingen «crs»-medlem (RFC 7946 krever WGS 84). Metadata ligger i et eget «metadata»-medlem (tillatt «foreign member»).
 */
type Pos = [number, number] | [number, number, number];
const pos = (p: LatLon & { ele?: number; eleGpx?: number }): Pos => {
  const z = p.eleGpx ?? p.ele ?? cachedElevation(p)?.z ?? undefined;
  return z != null ? [p.lon, p.lat, Math.round(z * 10) / 10] : [p.lon, p.lat];
};
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null));

export function exportGeoJson(snap: ExportSnapshot, o: { alternatives: boolean; days: boolean; markers: boolean; camps: boolean; zones: boolean }) {
  const { st, run, route } = snap;
  const features: unknown[] = [];
  const routes = o.alternatives ? st.routes : route ? [route] : [];
  for (const r of routes) {
    features.push({ type: 'Feature', id: r.id, geometry: { type: 'LineString', coordinates: r.waypoints.map(pos) }, properties: clean({ kind: 'rute', name: r.name, routeType: r.kind, main: r.id === route?.id, color: r.color, description: r.description, note: 'Planlagt rute – ikke verifisert i terrenget' }) });
    if (r.id === route?.id || o.alternatives)
      r.waypoints.forEach((w, i) => {
        if (!w.name && !w.description && !w.notes && !w.category) return;
        features.push({ type: 'Feature', id: `${r.id}:${w.id}`, geometry: { type: 'Point', coordinates: pos(w) }, properties: clean({ kind: 'rutepunkt', route: r.name, index: i + 1, name: w.name, category: w.category, description: w.description, notes: w.notes, verification: w.verification ?? 'uverifisert', source: w.source }) });
      });
  }
  if (o.days && route)
    run.days.forEach((d) => {
      if (d.reason.startsWith('allerede')) return;
      features.push({ type: 'Feature', id: `dag-${d.day}`, geometry: { type: 'LineString', coordinates: sliceRoute(route, d.startD, d.endD).map(pos) }, properties: clean({ kind: 'dagsetappe', day: d.day, date: d.date, scenario: run.plan.name, color: DAY_COLORS[(d.day - 1) % DAY_COLORS.length], distanceKm: +((d.endD - d.startD) / 1000).toFixed(2), departure: hhmm(d.departure), arrival: hhmm(d.arrival), kite: d.kiteId, windFromDeg: run.plan.days[d.day - 1]?.wind.dir, windAvgMs: run.plan.days[d.day - 1]?.wind.avg, windSource: d.windSource }) });
    });
  if (o.camps)
    st.camps.forEach((c) => {
      const di = run.plan.days.findIndex((d) => d.campId === c.id);
      features.push({ type: 'Feature', id: c.id, geometry: { type: 'Point', coordinates: pos(c) }, properties: clean({ kind: 'teltplass', name: c.name, night: c.night, role: c.role, description: c.description, assessment: c.assessment, notes: c.notes ?? c.note, overnightAfterDay: di >= 0 ? di + 1 : undefined, expectedArrival: di >= 0 ? hhmm(run.days[di]?.arrival) : undefined, approvedByUser: !!c.approved }) });
    });
  if (o.markers)
    st.markers.forEach((m) => features.push({ type: 'Feature', id: m.id, geometry: { type: 'Point', coordinates: pos(m) }, properties: clean({ kind: 'markør', name: m.name, category: m.category, description: m.description, notes: m.notes, verification: m.verification ?? 'uverifisert' }) }));
  if (o.zones)
    st.zones.forEach((z) => {
      const ring = z.ring.map((p) => [p.lon, p.lat]);
      if (ring.length >= 3) features.push({ type: 'Feature', id: z.id, geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] }, properties: clean({ kind: 'sone', name: z.name, type: z.kind, note: z.note }) });
    });
  return {
    type: 'FeatureCollection',
    metadata: { project: st.project.name, scenario: run.plan.name, tripDate: st.tripDate, generatedAt: snap.generatedAt, crs: 'WGS 84 (EPSG:4326), [lon, lat, høyde m]', source: 'Snowkite-ekspedisjonsplanlegger', disclaimer: 'Planlagte ruter og beregninger – ikke verifisert i terrenget.' },
    features,
  };
}
