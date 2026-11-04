// Tester for fysikkmodell, rutesimulering, kalibrering og sol. Kjør: npm test
import { DEFAULT_SIM, airDensity, heightFactor, physWindow, polar, polarV, bestVMG, solveSpeed } from '../src/lib/sim/physics';
import { simulate, monteCarlo, sunRules, positionAt } from '../src/lib/sim/route';
import { analyseTrack, calibrationFor } from '../src/lib/sim/calibration';
import { manualProvider } from '../src/lib/sim/wind';
import { defaultModel } from '../src/data/kiteSpecs';
import { windChill } from '../src/lib/api/met';
import { sunDay } from '../src/lib/sun';
import { destination, totalLength, cumulative } from '../src/lib/geo';
import { readFileSync } from 'fs';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fail++; };
const mk = (id: string, area: number, type: string) => ({ id, area, ...defaultModel(id, type), calib: 1 });
const p = DEFAULT_SIM;
const rho = airDensity(-8, 1200);

// --- Fysikk ---
ok(Math.abs(rho - 1.15) < 0.03, `luftdensitet −8 °C, 1200 moh = ${rho.toFixed(3)} (forventet ≈1,15)`);
ok(Math.abs(airDensity(15, 0) - 1.225) < 0.01, 'standardatmosfære 15 °C havnivå ≈ 1,225');
ok(heightFactor(p) > 1 && heightFactor(p) < 1.15, `vindprofil 10→20 m: ×${heightFactor(p).toFixed(3)}`);
const sonic = mk('sonic10', 10, 'foil'), soul = mk('soul15', 15, 'foil'), peak = mk('peak4', 4, 'foil');
const ws = [peak, sonic, soul].map((k) => physWindow(k, p, rho));
ok(ws[0].low > ws[1].low && ws[1].low > ws[2].low, `nedre vindgrense synker med areal: ${ws.map((w) => w.low.toFixed(1)).join(' > ')}`);
ok(ws[0].high > ws[1].high && ws[1].high > ws[2].high, `øvre vindgrense synker med areal: ${ws.map((w) => w.high.toFixed(1)).join(' > ')}`);
const W = 8 * heightFactor(p);
const reach = solveSpeed(sonic, p, rho, W, 100).V, up = solveSpeed(sonic, p, rho, W, 45).V, dead = solveSpeed(sonic, p, rho, W, 180).V;
ok(reach > up && reach > dead, `halvvind raskest (${(reach * 3.6).toFixed(0)} km/t) > 45° (${(up * 3.6).toFixed(0)}) og rett medvind (${(dead * 3.6).toFixed(0)})`);
ok(solveSpeed(sonic, p, rho, W, 10).V === 0, 'rett mot vinden (10°) er umulig');
ok(dead < W, 'rett medvind kan ikke gå fortere enn vinden i denne modellen');
const pol = polar(sonic, p, rho);
const vUp = bestVMG(pol, W, 0);
ok(vUp.mode === 'kryss oppover' && vUp.offset >= 30 && vUp.offset <= 75 && vUp.vmg > 0, `rett mot vind → kryss på ${vUp.twa}° TWA, VMG ${(vUp.vmg * 3.6).toFixed(1)} km/t`);
const vDown = bestVMG(pol, W, 180);
ok(vDown.vmg >= polarV(pol, W, 180) - 1e-6 && vDown.mode !== 'kryss oppover', `medvind: beste VMG ${(vDown.vmg * 3.6).toFixed(1)} ≥ rett medvind ${(polarV(pol, W, 180) * 3.6).toFixed(1)} km/t (${vDown.mode})`);
ok(bestVMG(pol, W, 90).mode === 'direkte', 'halvvind går direkte');
const heavy = { ...p, pulkKg: 80 };
ok(solveSpeed(sonic, heavy, rho, 4.5 * heightFactor(p), 90).V <= solveSpeed(sonic, p, rho, 4.5 * heightFactor(p), 90).V, 'tyngre pulk gir ikke høyere fart i lett vind');

// --- Rutesimulering på din GPX ---
const gpx = readFileSync(`${process.cwd()}/public/data/Finse_Rjukan_kite_27.gpx`, 'utf8');
const pts = [...gpx.matchAll(/lat="([\d.]+)" lon="([\d.]+)">\s*<ele>([\d.]+)/g)].map((m) => ({ lat: +m[1], lon: +m[2], ele: +m[3] }));
const total = totalLength(pts);
const cum = cumulative(pts);
const zAt = (d: number) => { const i = cum.findIndex((c) => c >= d); if (i <= 0) return pts[0].ele; const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1); return pts[i - 1].ele + (pts[i].ele - pts[i - 1].ele) * t; };
const rules = sunRules(8, 1.5, 9, 12, 6);
const run = (dir: number, sp: number, kites = [sonic], extra = {}) => simulate({ route: pts, fromD: 0, toD: total, startDate: '2027-03-25', startHour: 8, kites, params: p, wind: manualProvider({ dir, avg: sp, min: sp * 0.7, max: sp * 1.3, gust: sp * 1.35, tempC: -8, hourly: [] }), rules, walkRanges: [[107000, total]], zAt, ...extra });
const tail = run(315, 8), head = run(135, 8);
ok(head.end - head.start > tail.end - tail.start, `motvind (SØ) tar lengre tid enn medvind/slør (NV): ${((head.end - head.start) / 3.6e6).toFixed(1)} t vs ${((tail.end - tail.start) / 3.6e6).toFixed(1)} t`);
ok(head.totals.sailedKm > tail.totals.sailedKm, `motvind gir lengre seilt distanse (${head.totals.sailedKm.toFixed(0)} vs ${tail.totals.sailedKm.toFixed(0)} km)`);
ok(head.totals.tackH > 0, 'motvind gir stagvendingstid');
ok(tail.totals.walkH > 1, `sluttnedstigning gås (${tail.totals.walkH.toFixed(1)} t)`);
const calm = run(315, 2.5);
ok(calm.totals.skiH > calm.totals.kiteH, 'for lite vind → mest skigåing');
const quiver = run(315, 13, [peak, mk('hyper7', 7, 'foil'), sonic, soul]);
const soulOnly = run(315, 13, [soul]);
ok(quiver.end - quiver.start < soulOnly.end - soulOnly.start, 'i 13 m/s er quiveren (med små kites) raskere enn bare Soul 15');
ok(soulOnly.totals.stormH > 0, 'Soul 15 i 13 m/s: kiten må ned (for mye vind)');
const day = simulate({ route: pts, fromD: 0, toD: 50000, startDate: '2027-03-25', startHour: 8, kites: [sonic], params: p, wind: manualProvider({ dir: 225, avg: 8, min: 6, max: 10, gust: 11, tempC: -8, hourly: [] }), rules, walkRanges: [], zAt, maxDays: 1 });
ok(day.reachedD >= 49900 && day.dayEnds.length === 1, `50 km dag 1 i 8 m/s SV: nådd ${(day.reachedD / 1000).toFixed(1)} km kl. ${new Date(day.end).toISOString().slice(11, 16)} UTC`);
const short = simulate({ route: pts, fromD: 0, toD: 100000, startDate: '2027-03-25', startHour: 8, kites: [sonic], params: p, wind: manualProvider({ dir: 135, avg: 4, min: 3, max: 5, gust: 6, tempC: -8, hourly: [] }), rules, walkRanges: [], zAt, maxDays: 1 });
ok(short.reachedD < 100000 && !short.completed, `100 km i 4 m/s motvind rekkes ikke på én dag (${(short.reachedD / 1000).toFixed(1)} km)`);
const hourly = simulate({ route: pts, fromD: 0, toD: total, startDate: '2027-03-25', startHour: 8, kites: [sonic], params: p, wind: manualProvider({ dir: 225, avg: 8, min: 6, max: 10, gust: 11, tempC: -8, hourly: [{ hour: 8, speed: 8, gust: 11, dir: 225 }, { hour: 11, speed: 3, gust: 4, dir: 270 }] }), rules, walkRanges: [], zAt });
ok(hourly.legs.some((l) => l.wind.speed === 3) && hourly.legs.some((l) => l.wind.speed === 8), 'time-for-time vind endrer seg underveis');
const mid = positionAt(tail, (tail.start + tail.end) / 2);
ok(mid.d > 0 && mid.d < total, 'avspillingsposisjon midt i simuleringen ligger langs ruten');
monteCarlo({ route: pts, fromD: 0, toD: total, startDate: '2027-03-25', startHour: 8, kites: [sonic], params: p, wind: manualProvider({ dir: 225, avg: 8, min: 6, max: 10, gust: 11, tempC: -8, hourly: [] }), rules, walkRanges: [], zAt }, 12).then((u) => {
  ok(u.p10 <= u.p50 && u.p50 <= u.p90 && Number.isFinite(u.p50), `usikkerhet P10/50/90 = ${u.p10.toFixed(1)}/${u.p50.toFixed(1)}/${u.p90.toFixed(1)} t`);

  // --- Kalibrering (syntetisk spor: rett nordover 20 km/t i 30 min, vind fra øst = halvvind) ---
  const track = Array.from({ length: 361 }, (_, i) => ({ ...destination({ lat: 60.4, lon: 7.8 }, (20 / 3.6) * i * 5, 0), t: Date.UTC(2026, 2, 1, 10) + i * 5000 }));
  const meta = { name: 't', date: '2026-03-01', kiteId: 'sonic10', kiteSize: 10, windSpeed: 8, windDir: 90, riderKg: 70, pulkKg: 40, snow: 'pakket' as const };
  const st = analyseTrack(track, meta, sonic, p);
  ok(Math.abs(st.avgMovingKmh - 20) < 0.5 && Math.abs(st.distanceKm - 10) < 0.2, `kalibrering: snitt ${st.avgMovingKmh.toFixed(1)} km/t, ${st.distanceKm.toFixed(2)} km`);
  ok(st.bins!.find((b) => b.label.startsWith('Halvvind'))!.n > 0, 'kalibrering: kurs klassifisert som halvvind');
  ok(st.modelRatio != null && st.modelRatio > 0 && st.modelRatio < 1.5, `målt/modell = ${st.modelRatio?.toFixed(2)}`);
  const cal = calibrationFor('sonic10', [{ id: 'x', meta, stats: st, points: [], addedAt: '' }]);
  ok(!!cal && cal.factor >= 0.5 && cal.factor <= 1.5, `personlig faktor ${cal?.factor.toFixed(2)}`);

  // --- Sol og vær ---
  const sd = sunDay('2027-03-25', { lat: 60.6, lon: 7.5 }, 30);
  const order = [sd.astroDawn, sd.nauticalDawn, sd.civilDawn, sd.sunrise, sd.sunset, sd.civilDusk, sd.nauticalDusk, sd.astroDusk].map((d) => d!.getTime());
  ok(order.every((t, i) => i === 0 || t > order[i - 1]), 'tussmørkefaser i riktig rekkefølge');
  const sd0 = sunDay('2027-03-25', { lat: 60.6, lon: 7.5 }, 0);
  ok(sd.daylightH > sd0.daylightH, 'høyde over horisont gir litt lengre dag');
  ok(sunDay('2027-04-28', { lat: 60.6, lon: 7.5 }).daylightH - sunDay('2027-03-01', { lat: 60.6, lon: 7.5 }).daylightH > 5, 'april har >5 t mer dagslys enn tidlig mars');
  const wc = windChill(-10, 10)!;
  ok(wc < -18 && wc > -22, `vindavkjøling −10 °C / 10 m/s = ${wc.toFixed(1)} °C (MET-tabell ≈ −19)`);
  console.log(fail ? `${fail} FEIL` : 'ALLE SIMULERINGSTESTER OK');
  process.exit(fail ? 1 : 0);
});
