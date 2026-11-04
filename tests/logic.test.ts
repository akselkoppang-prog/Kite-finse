// Logikktester (sol, overstyringer, kryssing, reisemodell). Kjør: npm test
import { sunDay, fmtClock, hourOf } from '../src/lib/sun';
import { overrideState, evaluateCrossings } from '../src/lib/analysis/overrides';
import { buildBarriers, findCrossings } from '../src/lib/analysis/barriers';
import { windLegs } from '../src/lib/analysis/wind';
import { legTimes, dayTotals, daysNeeded, equalBreaks, finalDescent, DEFAULT_PARAMS, DEFAULT_SCENARIOS } from '../src/lib/analysis/feasibility';
import { totalLength, densify, cumulative } from '../src/lib/geo';
import { readFileSync } from 'fs';
let fail = 0;
const ok = (c: boolean, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fail++; };

// --- Sol: Finse 2027-03-25 og Rjukan 2027-04-10 ---
const f = sunDay('2027-03-25', { lat: 60.6, lon: 7.5 });
console.log('Finse 25.03.2027', fmtClock(f.civilDawn), fmtClock(f.sunrise), fmtClock(f.sunset), fmtClock(f.civilDusk), f.daylightH.toFixed(2));
ok(f.daylightH > 12.3 && f.daylightH < 13.2, 'dagslys Finse 25. mars ~12,7 t');
ok(hourOf(f.sunrise)! > 6 && hourOf(f.sunrise)! < 7, 'soloppgang 25.03 (vintertid) mellom 06 og 07');
const r = sunDay('2027-04-10', { lat: 59.88, lon: 8.55 });
console.log('Rjukan 10.04.2027', fmtClock(r.sunrise), fmtClock(r.sunset), r.daylightH.toFixed(2));
ok(hourOf(r.sunrise)! > 6 && hourOf(r.sunrise)! < 7.2, 'soloppgang 10.04 (sommertid) ~06:40');
ok(r.civilH > r.daylightH, 'borgerlig lys lengre enn dagslys');

// --- Overstyring: utløp/periode ---
const base = { id: 'o', barrierKey: 'lake_1', name: 'Testtjern', originalKind: 'innsjø' as const, originalLabel: 'IKKE VERIFISERT', centroid: { lat: 60, lon: 8 }, reviewRequired: true, note: 'kjent', createdAt: '2026-11-04', active: true };
ok(overrideState({ ...base, scope: 'permanent' }, '2027-03-25', '2026-11-04') === 'aktiv', 'permanent aktiv');
ok(overrideState({ ...base, scope: 'permanent', expires: '2026-10-01' }, '2027-03-25', '2026-11-04') === 'utløpt', 'utløpt');
ok(overrideState({ ...base, scope: 'permanent', expires: '2027-01-01' }, '2027-03-25', '2026-11-04') === 'utløper før avreise', 'utløper før avreise');
ok(overrideState({ ...base, scope: 'tur', tripDate: '2027-03-25' }, '2027-03-26', '2026-11-04') === 'utenfor periode', 'tur-overstyring gjelder bare turdato');
ok(overrideState({ ...base, scope: 'sesong', seasonFrom: '03-01', seasonTo: '04-30' }, '2027-04-12', '2026-11-04') === 'aktiv', 'sesong innenfor');
ok(overrideState({ ...base, scope: 'sesong', seasonFrom: '03-01', seasonTo: '04-30' }, '2027-05-12', '2026-11-04') === 'utenfor periode', 'sesong utenfor');
ok(overrideState({ ...base, scope: 'permanent', active: false }, '2027-03-25', '2026-11-04') === 'deaktivert', 'deaktivert');

// --- Kryssing + whitelist + dam ---
const poly = { type: 'Feature', properties: { navn: 'Testtjern', vatnLnr: 1 }, geometry: { type: 'Polygon', coordinates: [[[8.0, 60.0], [8.1, 60.0], [8.1, 60.05], [8.0, 60.05], [8.0, 60.0]]] } } as any;
const route = [{ id: 'a', lat: 60.025, lon: 7.9 }, { id: 'b', lat: 60.025, lon: 8.2 }] as any;
const bars = buildBarriers([], [poly], [], {});
const cr = findCrossings(route, bars);
ok(bars[0].id === 'lake_1' && cr.length === 1, 'stabil nøkkel + kryssing funnet');
let ev = evaluateCrossings(cr, [], { routeId: 'r', tripDate: '2027-03-25', dams: [] });
ok(ev[0].blocking && ev[0].label === 'BLOKKERT', 'uten whitelist: blokkert');
const ovr = { ...base, scope: 'permanent' as const };
ev = evaluateCrossings(cr, [ovr], { routeId: 'r', tripDate: '2027-03-25', dams: [] });
ok(!ev[0].blocking && ev[0].label === 'BRUKERGODKJENT' && ev[0].barrier.status === 'RØD', 'whitelist: ikke blokkert, men NVE-status uendret (RØD)');
ev = evaluateCrossings(cr, [{ ...ovr, segment: { routeId: 'r', routeName: 'R', fromKm: 50, toKm: 60 } }], { routeId: 'r', tripDate: '2027-03-25', dams: [] });
ok(ev[0].blocking, 'whitelist for annen strekning gjelder ikke');
ev = evaluateCrossings(cr, [{ ...ovr, segment: { routeId: 'r', routeName: 'R', fromKm: 5, toKm: 12 } }], { routeId: 'r', tripDate: '2027-03-25', dams: [] });
ok(!ev[0].blocking, 'whitelist for riktig strekning gjelder');
const dam = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [8.05, 60.026] } } as any;
ev = evaluateCrossings(cr, [ovr], { routeId: 'r', tripDate: '2027-03-25', dams: [dam] });
ok(ev[0].blocking && ev[0].hazards.length === 1, 'dam nær kryssing blokkerer selv med whitelist');
ev = evaluateCrossings(cr, [{ ...ovr, expires: '2026-01-01' }], { routeId: 'r', tripDate: '2027-03-25', dams: [] });
ok(ev[0].blocking, 'utløpt whitelist blokkerer igjen');

// --- Reisemodell på brukerens GPX ---
const gpx = readFileSync(new URL('../public/data/Finse_Rjukan_kite_27.gpx', 'file://' + process.cwd() + '/tests/').pathname, 'utf8');
const pts = [...gpx.matchAll(/lat="([\d.]+)" lon="([\d.]+)">\s*<ele>([\d.]+)/g)].map((m) => ({ lat: +m[1], lon: +m[2], ele: +m[3] }));
const total = totalLength(pts);
const legs = windLegs(pts, 'NV', 500);
const ds = densify(pts, 100); const cum = cumulative(pts);
const zAt = (p: { d: number }) => { let i = cum.findIndex((c) => c >= p.d); if (i <= 0) return pts[0].ele; const t = (p.d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1); return pts[i - 1].ele + (pts[i].ele - pts[i - 1].ele) * t; };
const desc = finalDescent(pts, zAt);
console.log('Nedstigning', desc && { fra: (desc.fromD / 1000).toFixed(1), til: (desc.toD / 1000).toFixed(1), fall: Math.round(desc.drop) }, 'samples', ds.length);
ok(!!desc && desc.drop > 500 && desc.toD - desc.fromD < 8000, 'sluttnedstigning funnet (>500 m fall, <8 km)');
const walk: [number, number][] = desc ? [[desc.fromD, desc.toD]] : [];
for (const sc of DEFAULT_SCENARIOS) {
  const lt = legTimes(legs, DEFAULT_PARAMS, sc, walk, 1);
  const n = daysNeeded(lt, DEFAULT_PARAMS, sc, () => 11);
  const days = [0, ...equalBreaks(total, 3), total].slice(0, -1).map((d0, i, a) => dayTotals(lt, d0, i < 2 ? equalBreaks(total, 3)[i] : total, i + 1, DEFAULT_PARAMS, sc));
  console.log(`Scenario ${sc.id}: ${n.days} reisedager (+${sc.restDays} hvile); 3-dagers fordeling timer:`, days.map((d) => `${d.totalH.toFixed(1)}t (kite ${d.kiteH.toFixed(1)}, ski ${d.skiH.toFixed(1)})`).join(' | '));
  if (sc.id === 'A') ok(n.days <= 3, 'Scenario A: tre dager mulig med NV-vind');
  if (sc.id === 'C') ok(n.days > 3, 'Scenario C: mer enn tre dager');
}
const ltSE = legTimes(windLegs(pts, 'SØ', 500), DEFAULT_PARAMS, DEFAULT_SCENARIOS[0], walk, 1);
const ltNW = legTimes(legs, DEFAULT_PARAMS, DEFAULT_SCENARIOS[0], walk, 1);
const sum = (l: typeof ltSE) => l.reduce((a, x) => a + x.kiteH + x.skiH, 0);
ok(sum(ltSE) > sum(ltNW) * 1.4, `motvind (SØ) gir lengre tid enn medvind/slør (${sum(ltSE).toFixed(1)} t vs ${sum(ltNW).toFixed(1)} t)`);
console.log(fail ? `${fail} FEIL` : 'ALLE TESTER OK');
process.exit(fail ? 1 : 0);
