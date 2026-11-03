import type { Route, Waypoint, Camp } from '../types';
import { uid } from './geo';

export interface ParsedGpx {
  name: string;
  tracks: { name: string; points: Waypoint[] }[];
  waypoints: Waypoint[];
}

const num = (s: string | null) => (s == null || s === '' ? undefined : Number(s));

export function parseGpx(xml: string, sourceLabel: string): ParsedGpx {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Ugyldig GPX/XML');
  const name = doc.querySelector('metadata > name')?.textContent ?? doc.querySelector('trk > name')?.textContent ?? 'Importert GPX';
  const mk = (el: Element, kind: Waypoint['kind']): Waypoint => ({
    id: uid('wp'),
    lat: Number(el.getAttribute('lat')),
    lon: Number(el.getAttribute('lon')),
    eleGpx: num(el.querySelector('ele')?.textContent ?? null),
    name: el.querySelector('name')?.textContent ?? undefined,
    kind,
    source: sourceLabel,
    dataKind: 'forslag',
  });
  const tracks: ParsedGpx['tracks'] = [];
  doc.querySelectorAll('trk').forEach((trk) => {
    const pts: Waypoint[] = [];
    trk.querySelectorAll('trkpt').forEach((p) => pts.push(mk(p, 'via')));
    tracks.push({ name: trk.querySelector('name')?.textContent ?? name, points: dedupe(pts) });
  });
  doc.querySelectorAll('rte').forEach((rte) => {
    const pts: Waypoint[] = [];
    rte.querySelectorAll('rtept').forEach((p) => pts.push(mk(p, 'stopp')));
    tracks.push({ name: rte.querySelector('name')?.textContent ?? name, points: dedupe(pts) });
  });
  const waypoints: Waypoint[] = [];
  doc.querySelectorAll('gpx > wpt').forEach((p) => waypoints.push(mk(p, 'stopp')));
  return { name, tracks, waypoints };
}

/** Fjerner identiske påfølgende punkter (Garmin-eksport har noen duplikater). */
function dedupe(pts: Waypoint[]): Waypoint[] {
  return pts.filter((p, i) => i === 0 || p.lat !== pts[i - 1].lat || p.lon !== pts[i - 1].lon);
}

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

export function toGpx(routes: Route[], camps: Camp[] = []): string {
  const now = new Date().toISOString();
  const wpts = [
    ...routes.flatMap((r) =>
      r.waypoints.filter((w) => w.name && w.kind !== 'via').map((w) => `  <wpt lat="${w.lat.toFixed(7)}" lon="${w.lon.toFixed(7)}">${w.eleGpx != null ? `<ele>${w.eleGpx.toFixed(1)}</ele>` : ''}<name>${esc(w.name!)}</name><desc>${esc(`${r.name} · ${w.dataKind} · kilde: ${w.source}`)}</desc></wpt>`),
    ),
    ...camps.map((c) => `  <wpt lat="${c.lat.toFixed(7)}" lon="${c.lon.toFixed(7)}"><name>${esc(c.name)}</name><desc>${esc(`Teltplass natt ${c.night} (${c.source}) – IKKE befart`)}</desc><sym>Campground</sym></wpt>`),
  ];
  const trks = routes.map(
    (r) => `  <trk>\n    <name>${esc(r.name)}</name>\n    <desc>${esc(`${r.description} | FORESLÅTT RUTE – ikke verifisert i terrenget.`)}</desc>\n    <trkseg>\n${r.waypoints
      .map((w) => `      <trkpt lat="${w.lat.toFixed(7)}" lon="${w.lon.toFixed(7)}">${w.eleGpx != null ? `<ele>${w.eleGpx.toFixed(1)}</ele>` : ''}</trkpt>`)
      .join('\n')}\n    </trkseg>\n  </trk>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Snowkite Finse–Rjukan planlegger" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Finse–Rjukan snowkite 2027 (planlegging)</name><desc>Foreslåtte ruter – ikke verifisert. Eksportert ${now}</desc><time>${now}</time></metadata>
${wpts.join('\n')}
${trks.join('\n')}
</gpx>
`;
}

export function download(filename: string, content: string, mime = 'application/gpx+xml') {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
