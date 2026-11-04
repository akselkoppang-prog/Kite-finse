import { unzipSync, strFromU8 } from 'fflate';
import { buildGpx, sliceRoute, routeTrack } from '../src/lib/export/gpx';
import { toCsv, toXlsx } from '../src/lib/export/table';
import { T } from '../src/lib/export/pdf-text';
import { frameFor } from '../src/lib/export/mapimg';
import { cumulative } from '../src/lib/geo';
import type { Route } from '../src/types';

let fail = 0;
const ok = (c: unknown, m: string) => {
  console.log(c ? 'PASS' : 'FAIL', m);
  if (!c) fail++;
};

const route: Route = {
  id: 'r1',
  name: 'Testrute æøå',
  kind: 'gpx',
  color: '#f00',
  description: 'Beskrivelse <med> & tegn',
  visible: true,
  waypoints: [
    { id: 'a', lat: 60.601234567891, lon: 7.502345678912, eleGpx: 1222.4, kind: 'stopp', source: 'gpx', dataKind: 'forslag', name: 'Start' },
    { id: 'b', lat: 60.55, lon: 7.6, eleGpx: 1250, kind: 'via', source: 'gpx', dataKind: 'forslag' },
    { id: 'c', lat: 60.5, lon: 7.7, eleGpx: 1100, kind: 'via', source: 'gpx', dataKind: 'forslag' },
    { id: 'd', lat: 60.45, lon: 7.85, kind: 'stopp', source: 'gpx', dataKind: 'forslag', name: 'Mål' },
  ],
  createdAt: '',
  updatedAt: '',
} as Route;

// GPX: full presisjon og gyldig escaping
const gpx = buildGpx({ name: 'Prosjekt & «test»' }, [routeTrack(route)], [{ lat: 60.5, lon: 7.7, name: 'Leir <1>', desc: 'a & b', sym: 'Campground' }]);
ok(gpx.includes('lat="60.601234567891" lon="7.502345678912"'), 'GPX beholder full koordinatpresisjon');
ok(gpx.includes('<ele>1222.4</ele>'), 'GPX skriver høyde');
ok(gpx.includes('Leir &lt;1&gt;') && gpx.includes('Prosjekt &amp; «test»') && !/<med>/.test(gpx), 'GPX escaper XML-tegn');
ok((gpx.match(/<trkpt /g) ?? []).length === 4, 'GPX har alle sporpunkter');

// dagsetappe: originalpunktene imellom er uendret, endene interpolert
const cum = cumulative(route.waypoints);
const mid = sliceRoute(route, cum[1] / 2, (cum[2] + cum[3]) / 2, ['Start dag 1', 'Mål dag 1']);
ok(mid.length === 4 && mid[1].lat === 60.55 && mid[2].lat === 60.5, 'sliceRoute beholder originalpunktene');
ok(/beregnet/.test(mid[0].name ?? '') && /Mål dag 1/.test(mid[3].name ?? ''), 'sliceRoute merker interpolerte endepunkter');
const exact = sliceRoute(route, cum[1], cum[3]);
ok(exact[0].lat === 60.55 && exact[exact.length - 1].lat === 60.45 && exact.length === 3, 'sliceRoute bruker eksakte punkter når grensen treffer et punkt');

// CSV
const sheet = { name: 'Test', header: ['Navn', 'Km', 'Lat'], rows: [['Leir; nord', 12.345, 60.123456789], ['«Sitat» "x"', 1, 59.9]], formats: [null, 'km', 'coord'] as ('km' | 'coord' | null)[] };
const no = toCsv(sheet, 'no');
ok(no.charCodeAt(0) === 0xfeff, 'CSV starter med BOM');
ok(no.includes('"Leir; nord";12,345;60,123456789'), 'CSV norsk: semikolon, desimalkomma, sitering, full presisjon i koordinat');
ok(no.includes('"«Sitat» ""x"""'), 'CSV escaper anførselstegn');
const intl = toCsv(sheet, 'int');
ok(intl.includes('Leir; nord,12.345,60.123456789'), 'CSV internasjonal: komma og punktum');

// XLSX
const x = toXlsx([sheet, { name: 'Ark/med:ulovlige?tegn', header: ['A'], rows: [] }], { title: 'Tittel & æøå' });
const files = unzipSync(x);
ok(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'docProps/core.xml'].every((f) => files[f]), 'XLSX har alle nødvendige deler');
const s1 = strFromU8(files['xl/worksheets/sheet1.xml']);
ok(s1.includes('<v>12.345</v>') && s1.includes('<v>60.123456789</v>'), 'XLSX lagrer tall som tall med full presisjon');
ok(s1.includes('Leir; nord') && s1.includes('pane ySplit="1"'), 'XLSX tekst og fryst overskrift');
ok(!strFromU8(files['xl/workbook.xml']).includes('Ark/med'), 'XLSX rydder ulovlige arknavn');

// PDF-tekst
ok(T('Finse → Rjukan ≈ 5 km ★ 🪁') === 'Finse – Rjukan ca.  5 km * ', 'PDF-tekst bytter tegn som standardfonten mangler');
ok(T('æøå ÆØÅ ° ² · – é') === 'æøå ÆØÅ ° ² · – é', 'PDF-tekst beholder norske tegn');
ok(T('−3 °C') === '-3 °C', 'PDF-tekst: minus og smal mellomrom');

// kartutsnitt
const fr = frameFor(route.waypoints, 1.5);
const [fx, fy] = fr.proj(route.waypoints[0]);
ok(fx > 0 && fx < 1 && fy > 0 && fy < 1, 'kartutsnitt inneholder ruten');
const back = fr.unproj(fx, fy);
ok(Math.abs(back.lat - route.waypoints[0].lat) < 1e-9 && Math.abs(back.lon - route.waypoints[0].lon) < 1e-9, 'kartprojeksjon kan reverseres nøyaktig');
ok(Math.abs((fr.x1 - fr.x0) / (fr.y1 - fr.y0) - 1.5) < 1e-9, 'kartutsnitt har riktig sideforhold');

console.log(fail ? `${fail} FEIL` : 'ALLE EKSPORTTESTER OK');
if (fail) process.exit(1);
