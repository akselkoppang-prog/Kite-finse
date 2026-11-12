const { chromium, devices } = require('playwright');
const fs = require('fs');
const dir = process.argv[2];
const URL0 = 'http://localhost:4174/';
let fail = 0;
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fail++; };

// v5-navigasjon: gamle fanenavn → hovedmeny + undermeny
const NAV = { 'Scenarioer': ['Dagplan', 'Scenarioer'], 'Prosjekt': ['Prosjekt', 'Prosjektet'], 'Eksport': ['Prosjekt', 'Eksport og deling'], 'Kart & rute': ['Kart og rute', 'Kart'], 'Overstyringer': ['Kart og rute', 'Vann og is'], 'Kite-quiver': ['Vær & kite', 'Kitedatabase'], 'Kalender': ['Dagplan', 'Kalender og sol'], 'Dagplan': ['Dagplan', 'Grovplan og plan B'], 'Dagene': ['Dagplan', 'Dag for dag'], 'Kite og vind': ['Vær & kite', 'Kitevalg'], 'Utstyr & offline': ['Utstyr & mat', 'Pakkeliste'], 'Mat': ['Utstyr & mat', 'Mat og vann'], 'Vær langs ruten': ['Vær & kite', 'Vær langs ruten'], 'Overnatting': ['Dagplan', 'Overnatting'], 'Status': ['Start'], 'Oppgaver': ['Prosjekt', 'Oppgaver og team'], 'Vær & vind': ['Vær & kite', 'Vind i dag'], 'Sikkerhet': ['Utstyr & mat', 'Sikkerhet'], 'YTELSESSIMULATOR': ['Vær & kite', 'Simulator'], 'Modell & kalibrering': ['Innstillinger', 'Modell og kalibrering'], 'Datakilder & diagnose': ['Innstillinger', 'Datakilder'], 'Innstillinger / Lagring': ['Innstillinger', 'Lagring og backup'] };
// Legacy-suitene tester funksjonalitet i «Detaljert» visning (alt åpent); enkel visning testes i ux-e2e.cjs
const DETAILED = () => { try { localStorage.setItem('kite-ui-prefs', JSON.stringify({ detailed: true, hints: true, guideHidden: false })); } catch {} };
async function openAdv(p) { await p.evaluate(() => document.querySelectorAll('details.ov-adv').forEach((d) => { d.open = true; })); await p.waitForTimeout(200); }
async function go(p, name) {
  const [m, s] = NAV[name] || [name];
  await p.locator('nav.mainnav button', { hasText: m }).first().click(); await p.waitForTimeout(80);
  if (s && (await p.locator('nav.subnav').count())) await p.locator('nav.subnav button', { hasText: s }).first().click();
  if (m === 'Kart og rute') { await p.waitForTimeout(200); await openAdv(p); }
}
// TESTSTUBBER (kun i test): realistisk svarformat for tjenester sandkassen ikke når
async function stubs(p) {
  await p.route('**/stedsnavn/v1/navn**', r => { const q = new URL(r.request().url()).searchParams.get('sok'); const h = [...q].reduce((a,c)=>a+c.charCodeAt(0),0); r.fulfill({ json: { navn: [{ skrivemåte: q, navneobjekttype: 'Turisthytte', representasjonspunkt: { øst: 7.5 + (h%100)/100, nord: 59.9 + (h%70)/100 }, kommuner: [{kommunenavn:'Test'}] }] } }); });
  await p.route('**/hoydedata/v1/punkt**', r => { const u = new URL(r.request().url()); const pts = JSON.parse(u.searchParams.get('punkter')||'[]'); r.fulfill({ json: { punkter: pts.map(([x,y]) => ({ x, y, z: 1100 + Math.sin(x*40)*80 + Math.cos(y*55)*60, terreng: 'Test', datakilde: 'stub' })) } }); });
  await p.route('**/Vannkraft1/MapServer/layers**', r => r.fulfill({ json: { layers: [{ id: 6, name: 'Magasin', geometryType: 'esriGeometryPolygon' }, { id: 2, name: 'Dam', geometryType: 'esriGeometryPoint' }] } }));
  await p.route('**/Vannkraft1/MapServer/6/query**', r => r.fulfill({ json: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { magasinNavn: 'Testmagasin', magasinNr: 77, hrv_moh: 1121, lrv_moh: 1100 }, geometry: { type: 'Polygon', coordinates: [[[8.1,60.12],[8.25,60.12],[8.25,60.2],[8.1,60.2],[8.1,60.12]]] } }] } }));
  await p.route('**/Vannkraft1/MapServer/2/query**', r => r.fulfill({ json: { type: 'FeatureCollection', features: [] } }));
  await p.route('**/Innsjodatabase2/MapServer/layers**', r => r.fulfill({ json: { layers: [{ id: 5, name: 'Innsjø', geometryType: 'esriGeometryPolygon' }] } }));
  await p.route('**/Innsjodatabase2/MapServer/5/query**', r => r.fulfill({ json: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { navn: 'Testtjern', vatnLnr: 1 }, geometry: { type: 'Polygon', coordinates: [[[7.55,60.53],[7.6,60.53],[7.6,60.56],[7.55,60.56],[7.55,60.53]]] } }] } }));
}
// Leser lagret tilstand direkte fra IndexedDB (etter at autolagring er bekreftet)
const state = async (p) => {
  for (let i = 0; i < 40; i++) { const t = await p.locator('.saveind').innerText(); if (/LAGRET/.test(t) && !/ULAGREDE/.test(t)) break; await p.waitForTimeout(150); }
  return p.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('kite-finse-rjukan');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const db = r.result; const tx = db.transaction(['slices', 'routes', 'meta', 'caches'], 'readonly');
      const out = {}; let n = 0;
      ['slices', 'routes', 'meta', 'caches'].forEach((s) => { const q = tx.objectStore(s).getAll(); q.onsuccess = () => { out[s] = q.result; if (++n === 4) {
        const pid = (out.meta.find((m) => m.key === 'activeProject') || {}).value || 'default';
        const st = {}; out.slices.filter((x) => x.projectId === pid && x.slice !== 'routeOrder').forEach((x) => Object.assign(st, x.value));
        const order = (out.slices.find((x) => x.projectId === pid && x.slice === 'routeOrder') || {}).value || [];
        const rs = out.routes.filter((x) => x.projectId === pid).map((x) => x.value);
        st.routes = order.map((id) => rs.find((x) => x.id === id)).filter(Boolean);
        out.caches.filter((x) => x.projectId === pid).forEach((x) => (st[x.name] = x.value));
        st.camps = st.camps || []; st.markers = st.markers || []; st.team = st.team || []; st.crossings = st.crossings || []; st.tasks = st.tasks || []; st.weather = st.weather || {};
        db.close(); res(st);
      } }; });
    };
  }));
};
const noScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const plan = (st) => st.plans.find((x) => x.id === st.activePlanId);
const tileText = (p, i, label) => p.locator('.daycard2').nth(i).locator('.tile', { hasText: label }).innerText();
const setRange = async (p, sel, v) => { await p.locator(sel).fill(String(v)); await p.waitForTimeout(400); };
const { execFileSync } = require('child_process');
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64e6 });
const projects = (p) => p.evaluate(() => new Promise((res) => { const r = indexedDB.open('kite-finse-rjukan'); r.onsuccess = () => { const q = r.result.transaction('projects').objectStore('projects').getAll(); q.onsuccess = () => { r.result.close(); res(q.result); }; }; }));
const dlTo = async (p, click, name) => {
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 180000 }), click()]);
  const f = `${dir}/v6/${name || dl.suggestedFilename()}`;
  await dl.saveAs(f);
  return { f, sug: dl.suggestedFilename() };
};
// ---- værstubber (sandkassen har ikke nett): realistisk svarformat fra MET, Open-Meteo og MetAlerts ----
const H0 = Math.floor(Date.now() / 3600000) * 3600000;
const hours = (n) => Array.from({ length: n }, (_, i) => H0 + i * 3600000);
const windAt = (t, bias = 0) => { const h = (t - H0) / 3600000; return { ws: 8 + bias + 3 * Math.sin(h / 7), gust: h >= 24 && h < 48 ? 21 : 12 + bias, dir: 300, temp: -9 - 4 * Math.sin(h / 12), vis: h >= 30 && h < 34 ? 700 : 20000 }; };
async function weatherStubs(p) {
  await p.route('**/api.met.no/weatherapi/locationforecast/**', (r) => r.fulfill({ json: { properties: { meta: { updated_at: new Date(H0 - 3600000).toISOString() }, timeseries: hours(9 * 24).map((t) => { const w = windAt(t); return { time: new Date(t).toISOString().replace('.000', ''), data: { instant: { details: { wind_speed: w.ws, wind_from_direction: w.dir, wind_speed_of_gust: w.gust, air_temperature: w.temp, cloud_area_fraction: 60, fog_area_fraction: w.vis < 1000 ? 80 : 0 } }, next_1_hours: { details: { precipitation_amount: 0.2 }, summary: { symbol_code: 'cloudy' } } } }; }) } } }));
  await p.route('**/api.open-meteo.com/**', (r) => { const u = new URL(r.request().url()); const days = +u.searchParams.get('forecast_days'); const ts = hours(days * 24); const bias = u.searchParams.get('models') === 'icon_seamless' ? 2 : 1; r.fulfill({ json: { hourly: { time: ts.map((t) => new Date(t).toISOString().slice(0, 16)), wind_speed_10m: ts.map((t) => windAt(t, bias).ws), wind_gusts_10m: ts.map((t) => windAt(t, bias).gust), wind_direction_10m: ts.map(() => 290), temperature_2m: ts.map((t) => windAt(t).temp - 1), visibility: ts.map((t) => windAt(t).vis), snowfall: ts.map(() => 0), precipitation: ts.map(() => 0.1), cloud_cover: ts.map(() => 70) } } }); });
  await p.route('**/api.met.no/weatherapi/metalerts/**', (r) => r.fulfill({ json: { features: [{ properties: { id: 'alert-1', title: 'Kuling på Hardangervidda', awareness_level: '2; yellow; Moderate', eventAwarenessName: 'Vind', description: 'Sørvest stiv kuling 15 m/s.', instruction: 'Unngå utsatte områder.' }, when: { interval: [new Date(H0).toISOString(), new Date(H0 + 86400000).toISOString()] } }] } }));
}
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
(async () => {
  require('fs').mkdirSync(dir + '/v7', { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1366, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true }); await ctx.addInitScript(DETAILED);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) errs.push(m.text()); });
  p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Scenario B' : undefined));
  await stubs(p); await weatherStubs(p);
  await p.goto(URL0 + '#oversikt', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3000);
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = addDays(today, 1);

  // 1. scenario-dato: avreise i morgen (innenfor prognosen)
  await go(p, 'Dagene'); await p.waitForTimeout(600);
  await p.fill('#plan-date', tomorrow); await p.waitForTimeout(800);
  let st = await state(p);
  ok(plan(st).tripDate === tomorrow && st.tripDate === tomorrow, '1. avreisedato lagres i scenarioet');

  // 2. vær langs ruten fra flere leverandører
  await go(p, 'Vær langs ruten'); await p.waitForTimeout(800);
  await p.click('#wx-fetch'); await p.waitForTimeout(6000);
  st = await state(p);
  const provs = Object.keys(st.weather || {});
  ok(['met', 'om-ecmwf', 'om-icon', 'om-metno'].every((k) => provs.includes(k) && st.weather[k].points.length >= 5), `2. prognose langs hele ruten fra ${provs.length} leverandører (${st.weather.met?.points.length} punkter)`);
  ok(await p.locator('.prov', { hasText: 'Yr / MET' }).locator('text=laget').count() === 1, '2. viser når prognosen ble laget');
  ok(/Kuling på Hardangervidda/.test(await p.locator('.card', { hasText: 'Farevarsler' }).innerText()), '2. farevarsel fra MET vises');
  await p.locator('button', { hasText: 'Bruk prognosen alle dager' }).first().click(); await p.waitForTimeout(1500);
  st = await state(p);
  ok(plan(st).days.every((d) => d.windMode === 'prognose'), '2. scenarioet bruker prognosen alle dager');
  const day2 = await p.locator('.wxday').nth(1).innerText();
  const day1 = await p.locator('.wxday').nth(0).innerText();
  ok(/kast|Kraftige|Storm/i.test(day1 + day2) && /Dårlig sikt|sikt/i.test(day1 + day2), '3. farlige forhold (kast, sikt) markeres');
  if (!(await p.locator('.wxtable').count())) await p.locator('.wxday').nth(0).locator('button', { hasText: 'time for time' }).click().catch(() => {});
  ok(await p.locator('.wxtable tbody tr').count() >= 3 && /motvind|medvind|sidevind/.test(await p.locator('.wxtable').first().innerText()), '3. været time for time langs ruten, med motvind/medvind');
  ok(await p.locator('.card', { hasText: 'Sammenlign leverandører' }).locator('tbody tr').count() === 4, '4. sammenligning av 4 leverandører');
  // bytt leverandør for scenarioet
  await p.locator('.prov', { hasText: 'ECMWF' }).locator('button', { hasText: 'Bruk i scenarioet' }).click(); await p.waitForTimeout(800);
  ok(plan(await state(p)).weatherSource === 'om-ecmwf', '4. scenarioet kan bruke ECMWF i stedet for MET');
  // beste avreise
  await p.click('#wx-best'); await p.waitForTimeout(15000);
  ok(await p.locator('#best-dep tbody tr').count() === 14, '5. beste avreise: 14 datoer rangert');
  // usikkerhet på dagkortene
  await go(p, 'Dagene'); await p.waitForTimeout(1000);
  const conf = await p.locator('.daycard2').first().locator('.est3').innerText();
  ok(/Beste tilfelle/.test(conf) && /Realistisk/.test(conf) && /Forsiktig/.test(conf) && /høy|middels/.test(conf), `6. tre utfall og sikkerhet (${conf.replace(/\s+/g, ' ').slice(-20)})`);

  // 7. team → personer
  await go(p, 'Oppgaver'); await p.waitForTimeout(600);
  for (const n of ['Aksel', 'Kari', 'Ola']) { await p.fill('#member-name', n); await p.click('#member-add'); await p.waitForTimeout(200); }
  st = await state(p);
  ok(st.team.length === 3, '7. tre i teamet');

  // 8. overnatting: teltplass ved sluttpunktet dag 1, så hytte med 2 plasser
  await go(p, 'Dagene'); await p.waitForTimeout(600);
  await p.locator('.daycard2').first().locator('button', { hasText: '+ Teltplass ved sluttpunktet' }).click(); await p.waitForTimeout(800);
  await go(p, 'Overnatting'); await p.waitForTimeout(800);
  ok(/Leir dag 1/.test(await p.locator('#night-1').inputValue().then(async (v) => (await p.locator(`#night-1 option[value="${v}"]`).innerText()))), '8. natt 1 = teltplassen ved sluttpunktet');
  const row = p.locator('.cmptable tr', { hasText: 'Leir dag 1' });
  await row.locator('select').selectOption('hytte'); await row.locator('input[type=number]').first().fill('2'); await row.locator('input[type=checkbox]').first().check(); await p.waitForTimeout(800);
  ok(/plass til 2, dere er 3/.test(await p.locator('.night').first().innerText()), '8. for få sengeplasser oppdages (2 plasser, 3 personer)');
  st = await state(p);
  const camp = st.camps.find((c) => c.name === 'Leir dag 1');
  ok(camp.kind === 'hytte' && camp.capacity === 2 && camp.resupply, '8. type, plasser og påfyll lagret');

  // 9. krysning med rutetabell
  await p.fill('.card:has-text("Krysninger") input[type=number] >> nth=-1', '20');
  await p.locator('.card', { hasText: 'Krysninger' }).locator('button', { hasText: '+ Legg til' }).click(); await p.waitForTimeout(500);
  const cr = p.locator('.crossrow').first();
  await cr.locator('select').selectOption('ferje');
  await cr.locator('input[placeholder="08:00, 12:00, 16:00"]').fill('09:00, 11:00, 13:00, 15:00');
  await cr.locator('input[placeholder^="rutetabell"]').fill('test');
  await p.waitForTimeout(1000);
  await go(p, 'Dagene'); await p.waitForTimeout(1200);
  const d1txt = await p.locator('.daycard2').first().innerText();
  ok(/⛴ Krysning km 20: ankomst \d\d:\d\d, venter \d+ min/.test(d1txt), `9. krysning med ventetid i dagens plan (${(d1txt.match(/⛴[^\n]*/) || [''])[0]})`);
  await p.locator('.daycard2').first().locator('button', { hasText: 'Hvordan er dette regnet ut?' }).click();
  ok(/Krysninger: \d/.test(await p.locator('.daycard2').first().locator('.explain').innerText()), '9. tidsbruk viser krysningstid');

  // 10. utstyr: anbefalinger, vekt og effekt
  await go(p, 'Utstyr & offline'); await p.waitForTimeout(1000);
  const adv = await p.locator('.advice').innerText();
  ok(/Teltplass til 3|Telt/.test(adv) || /Sovepose/.test(adv), '10. utstyrsråd basert på scenarioet');
  st = await state(p);
  ok(st.gearLists && st.gearLists[0].items.length > 20 && st.gearLists[0].items.some((g) => g.cat === 'Ly og telt'), '10. pakkelisten er flyttet til utstyrslisten og lagret');
  await p.locator('.gearrow .kg').first().fill('4.2'); await p.waitForTimeout(600);
  ok(/regner med utstyr|Beregningen bruker/.test(await p.locator('.gearplanner').innerText()), '10. utstyrsvekt brukes i fremdriften');
  await p.locator('button', { hasText: 'Hva betyr 5 kg mer?' }).click(); await p.waitForTimeout(3000);
  ok(/\+5 kg per pulk/.test(await p.locator('.gearplanner .msg').innerText()), `10. effekt av vekt vises (${await p.locator('.gearplanner .msg').innerText()})`);

  // 11. mat
  await go(p, 'Mat'); await p.waitForTimeout(800);
  const kg3 = await p.locator('#food-kg').innerText();
  ok(/\d/.test(kg3) && await p.locator('#shopping tbody tr').count() > 5, `11. matvekt ${kg3} for 3 personer og handleliste`);
  await p.locator('select[aria-label="Middag dag 1"]').selectOption(''); await p.waitForTimeout(600);
  ok(/Under 85 %/.test(await p.locator('.page').innerText()), '11. for lite energi en dag oppdages');
  await p.locator('select[aria-label="Middag dag 1"]').selectOption('m-middag'); await p.waitForTimeout(400);

  // 12. oppgave knyttet til overnatting + status
  await go(p, 'Oppgaver'); await p.waitForTimeout(500);
  await p.fill('#task-title', 'Bestill hytte natt 1'); await p.selectOption('#task-kind', 'teltplass'); await p.locator('select[aria-label="Overnatting"]').selectOption({ label: 'Leir dag 1' }); await p.click('#task-add'); await p.waitForTimeout(500);
  ok(/overnatting Leir dag 1/.test(await p.locator('.task').filter({ has: p.locator('input[value="Bestill hytte natt 1"]') }).innerText()), '12. oppgave knyttet til overnatting');
  await go(p, 'Status'); await p.waitForTimeout(1200);
  const pct = await p.locator('#ready-pct').innerText();
  const att = await p.locator('.card', { hasText: 'Trenger oppmerksomhet' }).innerText();
  ok(/\d+ %/.test(pct) && /Natt 1: Leir dag 1 har plass til 2/.test(att), `12. statusdashbord: ${pct} klar, viser overnattingsproblem`);
  ok(await p.locator('.area').count() >= 6, '12. områder: oppgaver, utstyr, mat, overnatting, rute, vær');
  await p.screenshot({ path: dir + '/v7/status.png', fullPage: true });

  // 13. uavhengige scenarioer med egen dato
  await go(p, 'Dagene'); await p.waitForTimeout(500);
  await p.locator('button', { hasText: 'Lagre som nytt scenario' }).click(); await p.waitForTimeout(800);
  st = await state(p);
  const B = st.plans.find((x) => x.name === 'Scenario B');
  await p.selectOption('#ctx-scenario', B.id); await p.waitForTimeout(800);
  await p.fill('#plan-date', addDays(today, 6)); await p.waitForTimeout(800);
  st = await state(p);
  const A = st.plans.find((x) => x.id === st.mainPlanId);
  ok(st.plans.find((x) => x.id === B.id).tripDate === addDays(today, 6) && A.tripDate === tomorrow, '13. scenario B har egen avreise; hovedplanen er uendret');
  await p.selectOption('#ctx-scenario', A.id); await p.waitForTimeout(800);
  ok((await state(p)).tripDate === tomorrow, '13. å bytte tilbake gir hovedplanens dato');
  await go(p, 'Scenarioer'); await p.waitForTimeout(800);
  const cmp = p.locator('.scen', { hasText: '' }).filter({ has: p.locator(`input[value="Scenario B"]`) });
  if (await cmp.locator('.cmpchk input').count()) await cmp.locator('.cmpchk input').check().catch(() => {});
  await p.waitForTimeout(1500);
  const tbl = await p.locator('.cmptable tbody').innerText().catch(() => '');
  ok(/Avreise/.test(tbl) && /Netter/.test(tbl) && /Pulkvekt dag 1/.test(tbl) && /Mat og brensel/.test(tbl), '13. sammenligning med avreise, netter, last og mat');

  // 14. eksport
  await go(p, 'Eksport'); await p.waitForTimeout(1000);
  const [dx] = await Promise.all([p.waitForEvent('download'), p.click('#exp-xlsx')]);
  const xf = dir + '/v7/plan.xlsx'; await dx.saveAs(xf);
  const names = execFileSync('python3', ['-c', 'import openpyxl,sys;print("|".join(openpyxl.load_workbook(sys.argv[1]).sheetnames))', xf], { encoding: 'utf8' });
  ok(['Netter', 'Utstyr', 'Mat', 'Handleliste', 'Oppgaver'].every((n) => names.includes(n)), `14. Excel med nye ark (${names.trim()})`);
  const [dp] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), p.click('#exp-pdf')]);
  const pf = dir + '/v7/plan.pdf'; await dp.saveAs(pf);
  const txt = execFileSync('pdftotext', [pf, '-'], { encoding: 'utf8' });
  ok(/Mat, vann og brensel/.test(txt) && /Handleliste/.test(txt) && /Anbefalinger for scenarioet/.test(txt), '14. PDF med mat, handleliste og utstyrsråd');

  // 15. lagring etter omlasting
  await p.waitForTimeout(1000);
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3500);
  st = await state(p);
  ok(st.team.length === 3 && st.crossings.length === 1 && st.crossings[0].schedule && st.tasks.some((t) => t.title === 'Bestill hytte natt 1') && st.camps.some((c) => c.kind === 'hytte') && st.plans.length >= 2 && plan(st).tripDate === tomorrow && Object.keys(st.weather).length === 4, '15. alt bevart etter omlasting (team, krysning, oppgave, hytte, scenarioer, datoer, vær-cache)');
  ok(errs.length === 0, `ingen JS-feil (${errs.slice(0, 3).join(' | ')})`);
  await ctx.close();

  // 16. iPad og mobil
  for (const [name, dev] of [['iPad', devices['iPad (gen 7)']], ['mobil', devices['iPhone 13']]]) {
    const c = await b.newContext({ ...dev, serviceWorkers: 'block' }); await c.addInitScript(DETAILED);
    const mp = await c.newPage(); await stubs(mp); await weatherStubs(mp);
    const merr = []; mp.on('pageerror', (e) => merr.push(e.message));
    await mp.goto(URL0 + '#oversikt', { waitUntil: 'domcontentloaded' }); await mp.waitForTimeout(2500);
    let worst = 0;
    for (const t of ['Status', 'Oppgaver', 'Overnatting', 'Vær langs ruten', 'Utstyr & offline', 'Mat', 'Dagene']) { await go(mp, t); await mp.waitForTimeout(800); worst = Math.max(worst, await noScroll(mp)); await mp.screenshot({ path: `${dir}/v7/${name}-${t.replace(/\W+/g, '')}.png` }); }
    ok(worst <= 1, `16. ${name}: ingen horisontal scroll på nye sider (${worst}px)`);
    ok(merr.length === 0, `16. ${name}: ingen JS-feil (${merr.slice(0, 2).join(' | ')})`);
    await c.close();
  }
  console.log(fail ? `${fail} FEIL` : 'ALLE V7-TESTER OK');
  await b.close();
})();
