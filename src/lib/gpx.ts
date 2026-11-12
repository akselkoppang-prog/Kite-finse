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
  const nTrk = tracks.length;
  doc.querySelectorAll('rte').forEach((rte) => {
    const pts: Waypoint[] = [];
    rte.querySelectorAll('rtept').forEach((p) => pts.push(mk(p, 'stopp')));
    const rname = rte.querySelector('name')?.textContent ?? name;
    // vår egen eksport skriver samme rute både som spor (trk) og rute (rte) – ta den bare med én gang
    const twin = tracks.slice(0, nTrk).some((t) => t.name === rname && same(t.points[0], pts[0]) && same(t.points[t.points.length - 1], pts[pts.length - 1]));
    if (!twin) tracks.push({ name: rname, points: dedupe(pts) });
  });
  const waypoints: Waypoint[] = [];
  doc.querySelectorAll('gpx > wpt').forEach((p) => {
    const w = mk(p, 'stopp');
    const role = txt(p, 'type');
    // Punkter som ligger nøyaktig på et punkt i sporet (START/MÅL og navngitte rutepunkter fra vår eksport):
    // gi navn og notater til punktet i sporet i stedet for å lage en ekstra markør
    const t = role === 'start' ? tracks.find((x) => same(x.points[0], w)) : role === 'finish' ? tracks.find((x) => same(x.points[x.points.length - 1], w)) : tracks.find((x) => x.points.some((q) => same(q, w)));
    if (t) {
      const tp = role === 'start' ? t.points[0] : role === 'finish' ? t.points[t.points.length - 1] : t.points.find((q) => same(q, w))!;
      tp.name = w.name?.replace(/^(Start|Mål): /, '') || tp.name;
      tp.kind = 'stopp';
      if (role !== 'start' && role !== 'finish') {
        // våre egne felter (beskrivelse inneholder også rute-/statusinfo fra eksporten – den hoppes over)
        if (w.notes) tp.notes = w.notes;
        if (w.category && w.category !== 'start' && w.category !== 'finish') tp.category = w.category;
        if (w.attachments) tp.attachments = w.attachments;
      }
      return;
    }
    waypoints.push(w);
  });
  if (!tracks.some((t) => t.points.length >= 2) && !waypoints.length) throw new Error('GPX-filen inneholder ingen spor, ruter eller punkter med gyldige koordinater.');
  return { name, tracks, waypoints };
}

function dedupe(pts: Waypoint[]): Waypoint[] {
  return pts.filter((p) => validLatLon(p.lat, p.lon)).filter((p, i, a) => i === 0 || p.lat !== a[i - 1].lat || p.lon !== a[i - 1].lon);
}
const same = (a?: { lat: number; lon: number }, b?: { lat: number; lon: number }) => !!a && !!b && Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6;
const validLatLon = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/** Hvorfor en rute ikke kan eksporteres (null = OK). */
export function routeProblem(r: Route): string | null {
  if (r.waypoints.length < 2) return `Ruten «${r.name}» har ${r.waypoints.length === 0 ? 'ingen punkter' : 'bare ett punkt'} – den trenger minst start og mål. Åpne «Rediger rute» og sett start og mål.`;
  const bad = r.waypoints.findIndex((w) => !validLatLon(w.lat, w.lon));
  if (bad >= 0) return `Ruten «${r.name}» har et ugyldig punkt (nr. ${bad + 1}: ${r.waypoints[bad].lat}, ${r.waypoints[bad].lon}). Flytt eller slett punktet.`;
  return null;
}

/** START- og MÅL-punkt for GPS-en (egne <wpt> med symbol), i tillegg til sporet. */
export function endpointWpts(r: Route): { lat: number; lon: number; ele?: number; name: string; sym: string; type: 'start' | 'finish' }[] {
  const a = r.waypoints[0], b = r.waypoints[r.waypoints.length - 1];
  if (!a || !b || r.waypoints.length < 2) return [];
  const label = (w: Waypoint, fb: string) => (w.name && !/^(Start|Mål)(\s*\(GPX\))?$/i.test(w.name) ? w.name : fb);
  return [
    { lat: a.lat, lon: a.lon, ele: a.eleGpx, name: `Start: ${label(a, r.name)}`, sym: 'Flag, Green', type: 'start' },
    { lat: b.lat, lon: b.lon, ele: b.eleGpx, name: `Mål: ${label(b, r.name)}`, sym: 'Flag, Red', type: 'finish' },
  ];
}

/** GPS-er navigerer best etter en <rte> med få punkter; lange GPX-spor (over 250 punkter) skrives bare som spor. */
export const RTE_MAX = 250;

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

function annXml(a: Annotated, fallbackDesc: string) {
  const parts: string[] = [];
  const desc = [a.description, fallbackDesc].filter(Boolean).join(' | ');
  // GPX 1.1 krever rekkefølgen cmt → desc → link → type
  if (a.notes) parts.push(`<cmt>${esc(a.notes)}</cmt>`);
  if (desc) parts.push(`<desc>${esc(desc)}</desc>`);
  (a.attachments ?? []).filter((x) => x.kind === 'lenke' && /^https?:/.test(x.href)).forEach((x) => parts.push(`<link href="${esc(x.href)}"><text>${esc(x.name)}</text></link>`));
  if (a.category) parts.push(`<type>${esc(a.category)}</type>`);
  return parts.join('');
}

/** GPX 1.1. Bilder (data-URL) og verifiseringsstatus kan ikke lagres i GPX – de ligger i prosjektfilen (JSON). */
export function toGpx(routes: Route[], camps: Camp[] = [], markers: Marker[] = []): string {
  const now = new Date().toISOString();
  if (!routes.length) throw new Error('Ingen ruter å eksportere.');
  for (const r of routes) { const p = routeProblem(r); if (p) throw new Error(p); }
  const ends = (r: Route) => endpointWpts(r).map((e) => `  <wpt lat="${e.lat.toFixed(7)}" lon="${e.lon.toFixed(7)}">${e.ele != null ? `<ele>${e.ele.toFixed(1)}</ele>` : ''}<name>${esc(e.name)}</name><desc>${esc(r.name)}</desc><sym>${e.sym}</sym><type>${e.type}</type></wpt>`);
  const wpts = [
    ...routes.flatMap(ends),
    ...routes.flatMap((r) =>
      r.waypoints
        // start/mål skrives som egne START/MÅL-punkter over; ta dem bare med her hvis de har notater o.l.
        .filter((w, i) => (w.name && w.kind !== 'via' && i !== 0 && i !== r.waypoints.length - 1) || w.category || w.description || w.notes)
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
  const rtes = routes
    .filter((r) => r.waypoints.length <= RTE_MAX)
    .map((r) => `  <rte>\n    <name>${esc(r.name)}</name>\n${r.waypoints.map((w, i) => `    <rtept lat="${w.lat.toFixed(7)}" lon="${w.lon.toFixed(7)}">${w.eleGpx != null ? `<ele>${w.eleGpx.toFixed(1)}</ele>` : ''}<name>${esc(i === 0 ? 'Start' : i === r.waypoints.length - 1 ? 'Mål' : w.name ?? `Punkt ${i}`)}</name></rtept>`).join('\n')}\n  </rte>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Snowkite-ekspedisjonsplanlegger ${APP_VERSION}" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Finse–Rjukan snowkite 2027 (planlegging)</name><desc>Foreslåtte ruter – ikke verifisert. Bilder og fullstendige notater ligger i prosjektfilen (JSON). Eksportert ${now}</desc><time>${now}</time></metadata>
${wpts.join('\n')}
${rtes.join('\n')}
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
