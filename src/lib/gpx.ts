import type { Route, Waypoint, Camp, Marker, Annotated } from '../types';
import { APP_VERSION } from './version';
import { uid } from './geo';
import { BUILTIN_CATEGORIES } from '../data/categories';

export interface ParsedGpx {
  name: string;
  tracks: { name: string; points: Waypoint[] }[];
  waypoints: Waypoint[];
}

const num = (s: string | null) => (s == null || s === '' ? undefined : Number(s));
const txt = (el: Element, sel: string) => el.querySelector(`:scope > ${sel}`)?.textContent?.trim() || undefined;

/** Leser også våre egne felter: <desc>, <cmt>, <type> (kategori), <link>. */
function annotations(el: Element): Annotated {
  const type = txt(el, 'type');
  const cat = type ? BUILTIN_CATEGORIES.find((c) => c.id === type || c.label.toLowerCase() === type.toLowerCase())?.id ?? type : undefined;
  const links = Array.from(el.querySelectorAll(':scope > link')).map((l) => ({ id: uid('att'), name: l.querySelector('text')?.textContent ?? l.getAttribute('href') ?? 'lenke', href: l.getAttribute('href') ?? '', kind: 'lenke' as const, addedAt: new Date().toISOString() }));
  return {
    category: cat,
    description: txt(el, 'desc'),
    notes: txt(el, 'cmt'),
    attachments: links.length ? links : undefined,
  };
}

export function parseGpx(xml: string, sourceLabel: string): ParsedGpx {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Ugyldig GPX/XML');
  const name = doc.querySelector('metadata > name')?.textContent ?? doc.querySelector('trk > name')?.textContent ?? 'Importert GPX';
  const mk = (el: Element, kind: Waypoint['kind']): Waypoint => {
    const a = annotations(el);
    return {
      id: uid('wp'),
      lat: Number(el.getAttribute('lat')),
      lon: Number(el.getAttribute('lon')),
      eleGpx: num(el.querySelector('ele')?.textContent ?? null),
      name: txt(el, 'name'),
      kind,
      source: sourceLabel,
      dataKind: 'forslag',
      ...Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined)),
    };
  };
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

function dedupe(pts: Waypoint[]): Waypoint[] {
  return pts.filter((p, i) => i === 0 || p.lat !== pts[i - 1].lat || p.lon !== pts[i - 1].lon);
}

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

function annXml(a: Annotated, fallbackDesc: string) {
  const parts: string[] = [];
  const desc = [a.description, fallbackDesc].filter(Boolean).join(' | ');
  if (desc) parts.push(`<desc>${esc(desc)}</desc>`);
  if (a.notes) parts.push(`<cmt>${esc(a.notes)}</cmt>`);
  (a.attachments ?? []).filter((x) => x.kind === 'lenke' && /^https?:/.test(x.href)).forEach((x) => parts.push(`<link href="${esc(x.href)}"><text>${esc(x.name)}</text></link>`));
  if (a.category) parts.push(`<type>${esc(a.category)}</type>`);
  return parts.join('');
}

/** GPX 1.1. Bilder (data-URL) og verifiseringsstatus kan ikke lagres i GPX – de ligger i prosjektfilen (JSON). */
export function toGpx(routes: Route[], camps: Camp[] = [], markers: Marker[] = []): string {
  const now = new Date().toISOString();
  const wpts = [
    ...routes.flatMap((r) =>
      r.waypoints
        .filter((w) => (w.name && w.kind !== 'via') || w.category || w.description || w.notes)
        .map((w) => `  <wpt lat="${w.lat.toFixed(7)}" lon="${w.lon.toFixed(7)}">${w.eleGpx != null ? `<ele>${w.eleGpx.toFixed(1)}</ele>` : ''}<name>${esc(w.name ?? 'Rutepunkt')}</name>${annXml(w, `${r.name} · ${w.dataKind} · status: ${w.verification ?? 'uverifisert'} · kilde: ${w.source}`)}</wpt>`),
    ),
    ...markers.map((m) => `  <wpt lat="${m.lat.toFixed(7)}" lon="${m.lon.toFixed(7)}"><name>${esc(m.name)}</name>${annXml(m, `Egen markør · status: ${m.verification ?? 'uverifisert'}`)}</wpt>`),
    ...camps.map((c) => `  <wpt lat="${c.lat.toFixed(7)}" lon="${c.lon.toFixed(7)}"><name>${esc(c.name)}</name><desc>${esc(`Teltplass natt ${c.night} (${c.source})${c.approved ? ' – brukergodkjent' : ''} – IKKE befart`)}</desc><sym>Campground</sym><type>camp</type></wpt>`),
  ];
  const trks = routes.map(
    (r) => `  <trk>\n    <name>${esc(r.name)}</name>\n    <desc>${esc(`${r.description} | FORESLÅTT RUTE – ikke verifisert i terrenget.`)}</desc>\n    <trkseg>\n${r.waypoints
      .map((w) => `      <trkpt lat="${w.lat.toFixed(7)}" lon="${w.lon.toFixed(7)}">${w.eleGpx != null ? `<ele>${w.eleGpx.toFixed(1)}</ele>` : ''}${w.name ? `<name>${esc(w.name)}</name>` : ''}</trkpt>`)
      .join('\n')}\n    </trkseg>\n  </trk>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Snowkite-ekspedisjonsplanlegger ${APP_VERSION}" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Finse–Rjukan snowkite 2027 (planlegging)</name><desc>Foreslåtte ruter – ikke verifisert. Bilder og fullstendige notater ligger i prosjektfilen (JSON). Eksportert ${now}</desc><time>${now}</time></metadata>
${wpts.join('\n')}
${trks.join('\n')}
</gpx>
`;
}

export function download(filename: string, content: string | Blob, mime = 'application/gpx+xml') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function waypointCsv(routes: Route[], markers: Marker[]): string {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['type', 'rute', 'nr', 'navn', 'lat', 'lon', 'høyde_gpx', 'kategori', 'beskrivelse', 'notater', 'status', 'kilde'].join(';')];
  routes.forEach((r) => r.waypoints.forEach((w, i) => rows.push([q('rutepunkt'), q(r.name), i + 1, q(w.name), w.lat.toFixed(6), w.lon.toFixed(6), w.eleGpx?.toFixed(0) ?? '', q(w.category), q(w.description), q(w.notes), q(w.verification ?? 'uverifisert'), q(w.source)].join(';'))));
  markers.forEach((m, i) => rows.push([q('markør'), '', i + 1, q(m.name), m.lat.toFixed(6), m.lon.toFixed(6), '', q(m.category), q(m.description), q(m.notes), q(m.verification ?? 'uverifisert'), q(m.source)].join(';')));
  return rows.join('\n');
}
