// Tester for v7: krysninger, vær (normalisering, farer, fart), mat, utstyrsråd, beredskap og dagsimulering.
import { crossingDelay, nextDeparture, inSeason, foodSummary, newFoodPlan, gearFromPacking, gearTotals, kcalTarget, DEFAULT_FOODS, DEFAULT_MEALS, autoTags, type Crossing, type GearList } from '../src/lib/project/model';
import { parseOpenMeteo, parseAlerts, samplePoints } from '../src/lib/weather/providers';
import { weatherSpeedFactor, hazardsFor, relWind } from '../src/lib/weather/analysis';
import { gearAdvice, type GearContext } from '../src/lib/project/advice';
import { readiness } from '../src/lib/project/readiness';
import { runExpedition, newDay, type PlanContext, type PlanScenario } from '../src/lib/sim/expedition';
import { defaultModel } from '../src/data/kiteSpecs';
import { DEFAULT_SIM } from '../src/lib/sim/physics';
import { destination, cumulative } from '../src/lib/geo';
import type { Insights } from '../src/lib/plan/insights';
import { sanitizeState } from '../src/storage/sanitize';

let fail = 0;
const ok = (c: unknown, m: string) => {
  console.log(c ? 'PASS' : 'FAIL', m);
  if (!c) fail++;
};

// ---------- krysninger ----------
ok(nextDeparture('08:00, 12:30, 16:00', 9) === 12.5, 'neste avgang etter 09:00 er 12:30');
ok(nextDeparture('08:00, 12:30', 13) === null, 'ingen avgang etter siste');
ok(nextDeparture('', 10.25) === 10.25, 'uten rutetabell: kan krysse straks');
const ferje: Crossing = { id: 'f', name: 'Ferje', kind: 'ferje', lat: 60, lon: 8, waitMin: 0, transferMin: 20, schedule: '10:00, 14:00', seasonFrom: '05-15', seasonTo: '09-30' };
ok(!inSeason(ferje, '2027-03-25') && inSeason(ferje, '2027-07-01'), 'sesong: stengt i mars, åpen i juli');
ok(/ikke i drift/.test(crossingDelay(ferje, '2027-03-25', 9).blocked ?? ''), 'utenfor sesong blokkerer krysningen');
const d1 = crossingDelay(ferje, '2027-07-01', 9.5);
ok(Math.abs(d1.waitH - 0.5) < 1e-9 && Math.abs(d1.departH - (10 + 20 / 60)) < 1e-9, `venter 30 min til 10:00, videre 10:20 (${d1.departH.toFixed(2)})`);
ok(/ingen flere avganger/.test(crossingDelay(ferje, '2027-07-01', 15).blocked ?? ''), 'etter siste avgang: dagen stopper');
const bro: Crossing = { id: 'b', name: 'Bro', kind: 'bro', lat: 60, lon: 8, waitMin: 10, transferMin: 5 };
ok(Math.abs(crossingDelay(bro, '2027-03-25', 11).departH - (11 + 15 / 60)) < 1e-9, 'uten rutetabell: fast ventetid + overgang');

// ---------- vær ----------
const om = parseOpenMeteo({ hourly: { time: ['2027-03-25T10:00', '2027-03-25T11:00', '2027-03-25T12:00'], wind_speed_10m: [8, 9, null], wind_gusts_10m: [12, 14, null], wind_direction_10m: [225, 230, null], temperature_2m: [-8, -7, null], visibility: [20000, 800, null], snowfall: [0, 1.2, null], precipitation: [0, 0.8, null], cloud_cover: [20, 90, null] } }, { lat: 60, lon: 8, label: 'x' });
ok(om.rows.length === 2 && om.rows[0].time === '2027-03-25T10:00Z', 'Open-Meteo: tider i UTC, timer uten vind fjernes');
ok(om.rows[1].windGust === 14 && om.rows[1].visibility === 800 && om.rows[1].snow === 1.2, 'Open-Meteo: kast, sikt og snøfall normalisert');
let threw = false;
try { parseOpenMeteo({ error: true, reason: 'Ugyldig modell' }, { lat: 1, lon: 1, label: 'x' }); } catch (e) { threw = /Ugyldig modell/.test((e as Error).message); }
ok(threw, 'Open-Meteo-feil gir lesbar melding');
const al = parseAlerts({ features: [{ properties: { id: 'a1', title: 'Kuling', awareness_level: '2; yellow; Moderate', description: 'Sterk vind' }, when: { interval: ['2027-03-25T06:00Z', '2027-03-25T18:00Z'] } }, { properties: { title: 'Storm', awareness_level: '3; orange; Severe' } }] }, 'Start');
ok(al.length === 2 && al[0].level === 'gul' && al[1].level === 'oransje' && al[0].onset === '2027-03-25T06:00Z', 'farevarsler: nivå og tidsrom tolkes');
ok(weatherSpeedFactor([{ time: '', visibility: 600 }]).factor === 0.7 && weatherSpeedFactor([{ time: '', visibility: 20000 }]).factor === 1, 'sikt under 1 km bremser (×0,7), god sikt ikke');
ok(Math.abs(weatherSpeedFactor([{ time: '', visibility: 800, snow: 2 }]).factor - 0.7 * 0.85) < 1e-9 && weatherSpeedFactor([{ time: '', visibility: 300, snow: 3 }]).factor === 0.5, 'sikt + snøfall kombineres (aldri under ×0,5)');
const hz = hazardsFor({ day: 1, hours: [], covered: true, avgWind: 15, maxGust: 22, minTemp: -20, minChill: -32, precipMm: 0, snowCm: 0, minVis: 500, headShare: 0.5 });
ok(hz.filter((h) => h.level === 'viktig').length >= 3 && hz.some((h) => /Motvind/.test(h.text)), `farlige forhold oppdages (${hz.map((h) => h.text).join('; ')})`);
ok(hazardsFor({ day: 1, hours: [], covered: false, avgWind: null, maxGust: null, minTemp: null, minChill: null, precipMm: 0, snowCm: 0, minVis: null, headShare: 0 }).length === 0, 'ingen prognose → ingen påståtte farer');
ok(relWind(30) === 'motvind' && relWind(90) === 'sidevind' && relWind(160) === 'medvind', 'relativ vind fra vinkel');
const route = [{ lat: 60.6, lon: 7.5 }];
for (let i = 0; i < 60; i++) route.push(destination(route[route.length - 1], 2500, 135));
const sp = samplePoints(route, 12000);
ok(sp.length >= 5 && sp[0].label === 'Start' && sp[sp.length - 1].label === 'Mål', `værpunkter langs ruten: ${sp.length} (start, hver ~12 km, mål)`);

// ---------- mat ----------
ok(kcalTarget('hard', -20) > kcalTarget('hard', 0) && kcalTarget('hard', 0) === 4600, 'energibehov øker i kulde');
const fp = newFoodPlan(3);
const fs = foodSummary(fp, 3, 2, DEFAULT_MEALS, DEFAULT_FOODS, -10, []);
ok(fs.totalDays === 4 && fs.perDay.length === 4, 'mat: 3 dager + 1 reserve');
ok(fs.perDay[0].kcal > 3500 && fs.perDay[0].kcal < 5500, `standarddag ${Math.round(fs.perDay[0].kcal)} kcal per person`);
ok(Math.abs(fs.totalKg - fs.perDay.reduce((a, n) => a + (n.g * 2) / 1000, 0)) < 1e-9, 'matvekt = sum av dager × personer');
ok(fs.remainingKgByDay[0] > fs.remainingKgByDay[1] && fs.remainingKgByDay[1] > fs.remainingKgByDay[2], 'maten blir lettere for hver dag');
const fsR = foodSummary(fp, 3, 2, DEFAULT_MEALS, DEFAULT_FOODS, -10, [1]);
ok(fsR.remainingKgByDay[0] < fs.remainingKgByDay[0] && Math.abs(fsR.remainingKgByDay[0] - fs.perDay[0].g * 2 / 1000) < 1e-9, 'påfyll etter dag 1: bær bare dag 1 fra start');
const oats = fs.shopping.find((x) => x.food.id === 'havregryn');
ok(oats && oats.g === 130 * 4 * 2 && oats.packs === 2, 'handleliste summerer gram og pakninger');
ok(fs.fuelL > 0 && fs.waterLPerDay === 4, 'vann og brensel beregnes');

// ---------- utstyr ----------
const migrated = gearFromPacking([{ id: 'p1', cat: 'Telt', text: 'Telt (stormtelt)', packed: true, kg: 4 }, { id: 'p2', cat: 'Sovesystem', text: 'Sovepose (komfort ≤ −20 °C)', packed: false }]);
ok(migrated[0].kg === 4 && migrated[0].packed && migrated[0].cat === 'Ly og telt' && migrated[0].tags?.includes('telt'), 'gammel pakkeliste flyttes uten tap (vekt, pakket, kategori)');
ok(autoTags('Skredsøker Mammut') .includes('skredsøker') && autoTags('Powerbank 20 Ah').includes('strøm'), 'nøkkelord gjenkjennes');
const list: GearList = { id: 'g', name: 'L', items: [{ id: 'a', name: 'Telt', cat: 'Ly og telt', kg: 4, qty: 1, carry: 'pulk', packed: true, capacity: 2 }, { id: 'b', name: 'Sovepose', cat: 'Sovesystem', kg: 2, qty: 2, carry: 'pulk', packed: false, ratingC: -5 }, { id: 'c', name: 'Dunjakke', cat: 'Klær', qty: 2, carry: 'kropp', packed: false }] };
const tt = gearTotals(list);
ok(tt.pulkKg === 8 && tt.bodyKg > 0 && tt.assumedKg > 0 && Math.abs(tt.packedPct - 1 / 3) < 1e-9, `vekt: pulk ${tt.pulkKg} kg, kropp ${tt.bodyKg} kg (antatt), pakket ${Math.round(tt.packedPct * 100)} %`);
const ctxG: GearContext = { people: 3, nights: 2, nightKinds: ['telt', undefined], minTempC: -22, maxGustMs: 17, steepTerrain: true, waterCrossings: 2, iceCrossings: 0, quiverKites: ['Hyperlink 7 m²'], days: 3 };
const adv = gearAdvice(list, ctxG);
ok(adv.some((a) => a.key === 'm-telt' && /3/.test(a.text)), 'telt til 2 når dere er 3 → mangler teltplass');
ok(adv.some((a) => a.level === 'uegnet' && /Sovepose/.test(a.text)), 'sovepose −5 °C er uegnet ned mot −22 °C');
ok(adv.some((a) => a.tag === 'skredsøker') && adv.some((a) => a.tag === 'ispigger') && adv.some((a) => a.tag === 'snøfester'), 'bratt terreng, vann og kast gir råd om skredutstyr, ispigger og snøfester');
const hut = gearAdvice(list, { ...ctxG, nightKinds: ['hytte', 'hytte'] });
ok(hut.some((a) => a.level === 'unødvendig' && a.tag === 'telt') && !hut.some((a) => a.key === 'm-telt'), 'bare hytter: telt kan være unødvendig');

// ---------- beredskap ----------
const ins = { advice: adv, gear: tt, food: fs, nights: [{ night: 1, date: '2027-03-25', camp: undefined, endD: 0, arrival: 15, distFromPrevKm: 40, offRouteKm: null, capacityOk: null, issues: ['Ingen overnatting valgt'] }], hazards: [{ day: 1, level: 'viktig', text: 'Storm' }] } as unknown as Insights;
const rd = readiness({ today: '2027-03-20', tripDate: '2027-03-25', tasks: [{ id: 't', title: 'x', done: false, due: '2027-03-01', createdAt: '' }], ins, importantWarnings: 1, waterChecked: false, forecastFetched: true, forecastPossible: true, budget: 0, expenses: [], campCount: 0 });
ok(rd.daysLeft === 5 && rd.overall < 0.7 && rd.areas.find((a) => a.id === 'oppgaver')!.status === 'mangler', `beredskap ${Math.round(rd.overall * 100)} %: forfalte oppgaver og mangler fanges opp`);
ok(rd.areas.flatMap((a) => a.todo).length >= 4, 'liste over hva som trenger oppmerksomhet');

// ---------- dagsimulering: krysning, last og tretthet ----------
const cum = cumulative(route);
const total = cum[cum.length - 1];
const ctx: PlanContext = {
  route, total, tripDate: '2027-03-25', params: { ...DEFAULT_SIM, riderKg: 80, pulkKg: 40 }, quiver: ['sonic10'],
  kite: (id) => ({ id, area: 10, ...defaultModel(id, 'lukket-celle foil'), calib: 1 }),
  zAt: () => 1200, walkRanges: [], forecast: null, launchMin: 10, navMinPerHour: 5, today: '2027-03-20',
};
const plan: PlanScenario = { id: 'p', name: 'p', createdAt: '', updatedAt: '', days: [newDay({ wind: { dir: 315, avg: 9, min: 7, max: 11, gust: 12, variability: 0.15, favorableH: 12 } }), newDay({ wind: { dir: 315, avg: 9, min: 7, max: 11, gust: 12, variability: 0.15, favorableH: 12 } })] };
const base = runExpedition(plan, ctx);
ok(base[0].confidence === 'lav' && base[0].uncertainties.some((u) => /eget scenario/.test(u)), 'manuell vind → lav sikkerhet med forklaring');
const midD = base[0].endD * 0.5;
const withX = runExpedition(plan, { ...ctx, crossings: [{ c: { ...bro, waitMin: 60, transferMin: 30, source: 'test' }, d: midD }] });
ok(withX[0].crossings.length === 1 && withX[0].crossings[0].waitH === 1 && withX[0].breakdown.crossingH === 1.5, 'krysning midt på dagen registreres med 1,5 t');
ok(withX[0].endD < base[0].endD || withX[0].arrival > base[0].arrival, `krysningen koster tid (${(base[0].endD / 1000).toFixed(1)} → ${(withX[0].endD / 1000).toFixed(1)} km, ankomst ${base[0].arrival.toFixed(2)} → ${withX[0].arrival.toFixed(2)})`);
const blocked = runExpedition(plan, { ...ctx, crossings: [{ c: { ...ferje, schedule: '06:00', seasonFrom: undefined, seasonTo: undefined }, d: midD }] });
ok(Math.abs(blocked[0].endD - midD) < 600 && blocked[0].issues.some((t) => /ingen flere avganger/.test(t)), 'etter siste avgang stopper dagen ved krysningen');
const heavyRun = runExpedition(plan, { ...ctx, dayLoad: (i) => (i === 0 ? 90 : 40) });
ok(heavyRun[0].loadKg === 90 && heavyRun[1].loadKg === 40, 'last per dag fra utstyr + mat brukes i simuleringen');
const tired = runExpedition(plan, { ...ctx, fatiguePct: 10 });
ok(tired[1].fatigueFactor === 0.9 && tired[0].fatigueFactor === 1, 'tretthet: dag 2 fart ×0,9');

// ---------- validering av lastede/importerte data ----------
const INIT = { tripDate: '2027-03-25', tripDays: 3, riderKg: 70, pulkKg: 40, routes: [], camps: [], markers: [], crossings: [], zones: [], plans: [], compareIds: [], mainPlanId: 'plan-main', activePlanId: 'plan-main', activeRouteId: null, quivers: [{ id: 'q', name: 'Q', kiteIds: ['sonic10'] }], activeQuiverId: 'q', gearLists: [], foods: DEFAULT_FOODS, meals: DEFAULT_MEALS, team: [], tasks: [], expenses: [], documents: [], simParams: { ...DEFAULT_SIM }, layers: { base: 'topo', camps: true }, places: {}, weather: {}, acks: {}, budget: 0 };
const junk = sanitizeState({ tripDate: 'i morgen', riderKg: 'tung', pulkKg: NaN, routes: [{ id: 'r', name: 5, waypoints: [{ lat: 'abc', lon: null }, { lat: 60.5, lon: 7.5 }, { lat: 999, lon: 7 }, { lat: 60.4, lon: 7.6, eleGpx: 'x' }] }, { waypoints: [] }, 'tull'], camps: [{ id: 'c1', lat: 60, lon: 8, capacity: '<b>' }, { id: 'c2', lat: null, lon: 8 }, 7], plans: 'feil', activePlanId: 'finnes-ikke', quivers: [{ id: 'q1', kiteIds: ['sonic10', 'ukjent-kite'] }], gearLists: 'x', simParams: { comfortKmh: 'rask' }, layers: { base: 'topo' }, team: [{ id: 't', weightKg: 'x' }, null], tasks: [{ id: 'k', due: 'snart' }], expenses: [{ id: 'e', amount: 'mye' }], weather: { met: { routeKey: 5 } }, acks: { a: 'ok', b: 5 }, extra: 'beholdes' }, INIT);
const J = junk.state as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
ok(J.tripDate === '2027-03-25' && J.riderKg === 70 && J.pulkKg === 40, 'ugyldig dato og vekter får standardverdier');
ok(J.routes.length === 1 && J.routes[0].waypoints.length === 2 && J.routes[0].name === 'Rute uten navn' && J.routes[0].waypoints[1].eleGpx === undefined && J.activeRouteId === 'r', 'ruter: punkter uten gyldige koordinater utelates, resten beholdes');
ok(J.camps.length === 1 && J.camps[0].capacity === 0, 'teltplasser uten koordinater utelates; tallfelt blir tall');
ok(J.plans.length === 1 && J.plans[0].days.length === 3 && J.activePlanId === J.plans[0].id && J.mainPlanId === J.plans[0].id, 'manglende scenarioer erstattes av en standard hovedplan med gyldige pekere');
ok(J.quivers[0].kiteIds.join() === 'sonic10' && J.activeQuiverId === 'q1', 'ukjente kites fjernes fra utvalget');
ok(J.simParams.comfortKmh === DEFAULT_SIM.comfortKmh && J.simParams.tackSec === DEFAULT_SIM.tackSec && J.layers.camps === true, 'innstillinger: ugyldige og manglende felt fylles fra standard');
ok(J.gearLists.length === 1 && J.team.length === 1 && J.team[0].weightKg === 75 && J.tasks[0].due === undefined && J.expenses[0].amount === 0, 'utstyr, team, oppgaver og utgifter repareres');
ok(Object.keys(J.weather).length === 0 && Object.keys(J.acks).join() === 'a' && J.extra === 'beholdes', 'ugyldig hurtigbuffer forkastes; ukjente felt følger med urørt');
ok(junk.report.fixed.length >= 3, `rapport over hva som ble reparert (${junk.report.fixed.length} punkter)`);
const good = { ...INIT, plans: [{ id: 'p1', name: 'A', tripDate: '2027-04-01', createdAt: 'x', updatedAt: 'x', days: [newDay({ departure: 9.5, kiteId: 'sonic10' })] }], activePlanId: 'p1', mainPlanId: 'p1', tripDate: '2027-04-01', tripDays: 1 };
const g2 = sanitizeState(good, INIT);
ok(JSON.stringify((g2.state.plans as PlanScenario[])[0].days[0]) === JSON.stringify(good.plans[0].days[0]) && g2.report.fixed.length === 0, 'gyldige data går uendret gjennom (ingen stille endringer)');
const dup = sanitizeState({ ...good, plans: [good.plans[0], { ...good.plans[0], name: 'kopi' }] }, INIT);
ok((dup.state.plans as PlanScenario[]).length === 1, 'to scenarioer med samme id slås ikke sammen ved redigering (duplikat fjernes)');
ok(sanitizeState({ plans: null, routes: undefined, camps: {} } as never, INIT).state != null, 'validering kaster aldri feil på søppel');

console.log(fail ? `${fail} FEIL` : 'ALLE PLANLEGGINGSTESTER OK');
if (fail) process.exit(1);
