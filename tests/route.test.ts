// Ruteveiviser: koordinattolkning, rekkefølge, start/mål, validering, følge rute og GPX-eksport.
import { parseCoords, buildWaypoints, insertIndex, validateDraft, newDraft, draftFromRoute, followLeg, lengthM, pt, MAX_EDITABLE_VIA } from '../src/lib/route/draft';
import { toGpx, routeProblem, endpointWpts } from '../src/lib/gpx';
import type { Route } from '../src/types';

let fail = 0;
const ok = (c: unknown, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fail++; };
const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) < e;
const ll = (r: ReturnType<typeof parseCoords>) => ('error' in r ? null : r);

// --- koordinater
ok(near(ll(parseCoords('60.6012, 7.5034'))!.lat, 60.6012) && near(ll(parseCoords('60.6012, 7.5034'))!.lon, 7.5034), 'desimal med komma mellom');
ok(near(ll(parseCoords('60,6012 7,5034'))!.lat, 60.6012) && near(ll(parseCoords('60,6012 7,5034'))!.lon, 7.5034), 'norsk desimalkomma, mellomrom mellom');
ok(near(ll(parseCoords('60.6;7.5'))!.lon, 7.5), 'semikolon');
ok(near(ll(parseCoords('N 60.6012 E 7.5034'))!.lat, 60.6012), 'N/E foran');
ok(near(ll(parseCoords('E 7.5034 N 60.6012'))!.lat, 60.6012) && near(ll(parseCoords('E 7.5034 N 60.6012'))!.lon, 7.5034), 'lengde først med E/N byttes riktig');
const dms = ll(parseCoords(`60°36'4"N 7°30'12"E`))!;
ok(near(dms.lat, 60 + 36 / 60 + 4 / 3600, 1e-9) && near(dms.lon, 7 + 30 / 60 + 12 / 3600, 1e-9), 'grader/minutter/sekunder');
ok(near(ll(parseCoords(`60°36.07'N 7°30.2'E`))!.lat, 60 + 36.07 / 60, 1e-9), 'grader + desimalminutter');
ok(near(ll(parseCoords('-33.9, 18.4'))!.lat, -33.9), 'negative verdier');
ok('error' in parseCoords('95, 7'), 'bredde over 90 avvises');
ok('error' in parseCoords('60, 200'), 'lengde over 180 avvises');
ok('error' in parseCoords('Finse'), 'tekst avvises med forklaring');
ok('error' in parseCoords(''), 'tomt felt avvises');
ok(!!ll(parseCoords('7.5034, 60.6012'))?.note, 'byttet om (lengde først) gir advarsel');

// --- rekkefølge og bygging
const A = pt(60.60, 7.50, 'kart', 'Finse'), Z = pt(59.88, 8.59, 'søk', 'Rjukan');
const d = { ...newDraft('Test'), start: A, finish: Z };
ok(validateDraft(d).length === 0, 'start + mål uten mellompunkter er gyldig');
const w0 = buildWaypoints(d);
ok(w0.length === 2 && w0[0].name === 'Finse' && w0[1].name === 'Rjukan', 'rute uten mellompunkter: start → mål');
const m1 = pt(60.4, 7.8, 'kart'), m2 = pt(60.1, 8.3, 'kart');
d.via = [m1];
ok(insertIndex(d, m2) === 1, 'nytt punkt settes inn der det gir minst omvei (etter punkt 1)');
d.via = [m2];
ok(insertIndex(d, m1) === 0, '… og før når det ligger nærmere start');
d.via = [m1, m2];
const w2 = buildWaypoints(d);
ok(w2.map((w) => w.lat).join() === [60.6, 60.4, 60.1, 59.88].join(), 'rekkefølge start, 1, 2, mål');
ok(w2[0].source.startsWith('Startpunkt') && w2[3].source.startsWith('Mål'), 'start og mål merket med kilde');
ok(validateDraft({ ...newDraft('x'), finish: Z }).some((e) => e.step === 1), 'mangler start → feil på steg 1');
ok(validateDraft({ ...newDraft('x'), start: A }).some((e) => e.step === 2), 'mangler mål → feil på steg 2');
ok(validateDraft({ ...newDraft('x'), start: A, finish: { ...A, id: 'z' } }).some((e) => /samme sted/.test(e.text)), 'start = mål uten mellompunkter → feil');
ok(validateDraft({ ...newDraft(' '), start: A, finish: Z }).some((e) => e.step === 5), 'tomt navn → feil');
ok(validateDraft({ ...newDraft('x'), start: { ...A, lat: NaN }, finish: Z }).length > 0, 'ugyldig koordinat → feil');

// --- redigering av lagret rute bevarer informasjon
const R: Route = { id: 'r1', name: 'Lagret', kind: 'egen', color: '#f00', description: '', visible: true, createdAt: '', updatedAt: '', waypoints: [
  { id: 'a', lat: 60.6, lon: 7.5, name: 'Finse', kind: 'stopp', source: 'x', dataKind: 'forslag', notes: 'Togstasjon', eleGpx: 1222 },
  { id: 'b', lat: 60.3, lon: 8.0, kind: 'via', source: 'x', dataKind: 'forslag' },
  { id: 'c', lat: 59.88, lon: 8.59, name: 'Rjukan', kind: 'stopp', source: 'x', dataKind: 'forslag' },
] };
const e = draftFromRoute(R);
ok(e.start?.lat === 60.6 && e.finish?.lat === 59.88 && e.via.length === 1 && e.editId === 'r1', 'lagret rute → utkast: første = start, siste = mål');
const back = buildWaypoints(e);
ok(back[0].notes === 'Togstasjon' && back[0].eleGpx === 1222 && back[0].id === 'a', 'uendret start beholder notater, høyde og id');
const moved = buildWaypoints({ ...e, finish: { ...e.finish!, lat: 59.9 } });
ok(moved[2].lat === 59.9 && moved[2].id === 'c' && moved[2].name === 'Rjukan' && moved[2].eleGpx === undefined, 'flyttet mål: ny posisjon, samme navn/id, gammel høyde fjernet');
const big: Route = { ...R, waypoints: Array.from({ length: MAX_EDITABLE_VIA + 20 }, (_, i) => ({ id: `p${i}`, lat: 60.6 - i * 0.01, lon: 7.5 + i * 0.01, kind: 'via' as const, source: 'gpx', dataKind: 'forslag' as const })) };
const be = draftFromRoute(big);
ok(be.kept?.length === big.waypoints.length - 2 && be.via.length === 0, 'stor GPX-rute: linjen beholdes urørt mellom start og mål');
const bw = buildWaypoints({ ...be, start: { ...be.start!, lat: 60.7 } });
ok(bw.length === big.waypoints.length && bw[0].lat === 60.7 && bw[bw.length - 1].id === big.waypoints[big.waypoints.length - 1].id, 'ny start på stor rute: bare første punkt endres');

// --- følge eksisterende rute
const ref: Route = { ...R, id: 'ref', waypoints: Array.from({ length: 21 }, (_, i) => ({ id: `q${i}`, lat: 60.6 - i * 0.036, lon: 7.5 + i * 0.0545, kind: 'via' as const, source: 'ref', dataKind: 'forslag' as const })) };
const fl = followLeg({ lat: 60.6, lon: 7.5 }, { lat: 59.88, lon: 8.59 }, ref);
ok(fl.length >= 18 && fl[0].lat > fl[fl.length - 1].lat, 'følger referanseruten i riktig retning');
const rev = followLeg({ lat: 59.88, lon: 8.59 }, { lat: 60.6, lon: 7.5 }, ref);
ok(rev[0].lat < rev[rev.length - 1].lat, '… og baklengs når start/mål er byttet');
ok(followLeg({ lat: 62, lon: 5 }, { lat: 59.88, lon: 8.59 }, ref).length === 0, 'langt fra ruten → rett linje');
const fw = buildWaypoints({ ...d, via: [], geometry: 'ref' }, ref);
ok(fw.length > 10 && lengthM(fw) >= lengthM(w0), 'utkast som følger rute har flere punkter, ikke kortere enn luftlinjen');

// --- GPX
const gx = toGpx([{ ...R, name: 'Finse <→> Rjukan & co' }]);
ok(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<gpx version="1.1"/.test(gx) && gx.includes('xmlns="http://www.topografix.com/GPX/1/1"'), 'GPX 1.1 med riktig navnerom');
ok(gx.indexOf('<wpt') < gx.indexOf('<rte>') && gx.indexOf('<rte>') < gx.indexOf('<trk>'), 'rekkefølge wpt → rte → trk (GPX 1.1-skjema)');
const trk = [...gx.slice(gx.indexOf('<trk>')).matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)"/g)].map((m) => [+m[1], +m[2]]);
ok(trk.length === 3 && trk[0][0] === 60.6 && trk[0][1] === 7.5 && trk[2][0] === 59.88 && trk[2][1] === 8.59, 'spor: lat/lon riktig vei og i rekkefølge');
const rte = [...gx.matchAll(/<rtept lat="([-\d.]+)" lon="([-\d.]+)">(?:<ele>[^<]*<\/ele>)?<name>([^<]*)<\/name>/g)];
ok(rte.length === 3 && rte[0][3] === 'Start' && rte[2][3] === 'Mål', 'rute (rte): Start … Mål');
ok(/<name>Start: Finse<\/name>.*<sym>Flag, Green<\/sym><type>start<\/type>/.test(gx) && /<name>Mål: Rjukan<\/name>.*<type>finish<\/type>/.test(gx), 'START/MÅL som egne punkter med symbol');
ok(gx.includes('<ele>1222.0</ele>'), 'høyde tas med når den finnes');
ok(gx.includes('Finse &lt;→&gt; Rjukan &amp; co'), 'navn escapes riktig');
ok(endpointWpts(R).length === 2, 'to endepunkter');
ok(routeProblem({ ...R, waypoints: [R.waypoints[0]] })?.includes('minst start og mål'), 'eksport av rute med ett punkt gir forklaring');
let threw = '';
try { toGpx([{ ...R, waypoints: [R.waypoints[0], { ...R.waypoints[1], lat: NaN }] }]); } catch (x) { threw = (x as Error).message; }
ok(/ugyldig punkt/.test(threw), 'ugyldige koordinater stopper eksporten med forklaring');
const many = toGpx([{ ...R, waypoints: Array.from({ length: 300 }, (_, i) => ({ id: `m${i}`, lat: 60 + i * 0.001, lon: 8, kind: 'via' as const, source: '', dataKind: 'forslag' as const })) }]);
ok(!many.includes('<rte>') && (many.match(/<trkpt/g) ?? []).length === 300, 'lange spor (>250) skrives bare som spor, alle punkter med');

console.log(fail ? `${fail} FEIL` : 'ALLE RUTETESTER OK');
process.exit(fail ? 1 : 0);
