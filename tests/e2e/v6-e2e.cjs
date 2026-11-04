const { chromium, devices } = require('playwright');
const fs = require('fs');
const dir = process.argv[2];
const URL0 = 'http://localhost:4174/';
let fail = 0;
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fail++; };

// v5-navigasjon: gamle fanenavn → hovedmeny + undermeny
const NAV = { 'Scenarioer': ['Dagplan', 'Scenarioer'], 'Prosjekt': ['Oversikt', 'Prosjekt'], 'Eksport': ['Eksport', 'Eksport & deling'], 'Kart & rute': ['Oversikt'], 'Overstyringer': ['Utstyr & planlegging', 'Vann-godkjenninger'], 'Kite-quiver': ['Vær & kite', 'Kitedatabase'], 'Kalender': ['Dagplan', 'Kalender og sol'], 'Dagplan': ['Dagplan', 'Avansert dagsfordeling'], 'Dagene': ['Dagplan', 'Dagene'], 'Kite og vind': ['Vær & kite', 'Kite og vind'], 'Utstyr & offline': ['Utstyr & planlegging', 'Utstyr og mat'], 'Vær & vind': ['Vær & kite', 'Værmelding'], 'Sikkerhet': ['Utstyr & planlegging', 'Sikkerhet'], 'YTELSESSIMULATOR': ['Vær & kite', 'Simulator'], 'Modell & kalibrering': ['Innstillinger', 'Modell og kalibrering'], 'Datakilder & diagnose': ['Innstillinger', 'Datakilder'], 'Innstillinger / Lagring': ['Innstillinger', 'Lagring og backup'] };
async function openAdv(p) { await p.evaluate(() => document.querySelectorAll('details.ov-adv').forEach((d) => { d.open = true; })); await p.waitForTimeout(200); }
async function go(p, name) {
  const [m, s] = NAV[name] || [name];
  await p.locator('nav.mainnav button', { hasText: m }).first().click();
  if (s && (await p.locator('nav.subnav').count())) await p.locator('nav.subnav button', { hasText: s }).first().click();
  if (m === 'Oversikt') { await p.waitForTimeout(200); await openAdv(p); }
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
      const db = r.result; const tx = db.transaction(['slices', 'routes', 'meta'], 'readonly');
      const out = {}; let n = 0;
      ['slices', 'routes', 'meta'].forEach((s) => { const q = tx.objectStore(s).getAll(); q.onsuccess = () => { out[s] = q.result; if (++n === 3) {
        const pid = (out.meta.find((m) => m.key === 'activeProject') || {}).value || 'default';
        const st = {}; out.slices.filter((x) => x.projectId === pid && x.slice !== 'routeOrder').forEach((x) => Object.assign(st, x.value));
        const order = (out.slices.find((x) => x.projectId === pid && x.slice === 'routeOrder') || {}).value || [];
        const rs = out.routes.filter((x) => x.projectId === pid).map((x) => x.value);
        st.routes = order.map((id) => rs.find((x) => x.id === id)).filter(Boolean);
        st.camps = st.camps || []; st.markers = st.markers || [];
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
(async () => {
  require('fs').mkdirSync(dir + '/v6', { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1366, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) errs.push(m.text()); });
  let promptAnswer = 'x';
  p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? promptAnswer : undefined));
  await stubs(p);
  await p.route('**/cache.kartverket.no/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: require('fs').readFileSync(__dirname + '/testtile.png') }));
  await p.goto(URL0, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3000);
  const st0 = await state(p);
  const orig = { camps: (st0.camps || []).length, plans: (st0.plans || [1]).length, route0: st0.routes[0].waypoints.length, pid: (await projects(p))[0].id };

  // ---------- PROSJEKT ----------
  await p.locator('.ov-title .iconbtn').click();
  await p.fill('#ov-title-input', 'Finse – Rjukan Snowkite Expedition 2027'); await p.press('#ov-title-input', 'Enter'); await p.waitForTimeout(800);
  ok(/Finse – Rjukan Snowkite Expedition 2027/.test(await p.locator('#proj-name-header').innerText()), 'P1. prosjektnavn endret i oversikten vises i toppen');
  ok((await projects(p)).some((x) => x.name === 'Finse – Rjukan Snowkite Expedition 2027'), 'P1. navnet lagret i prosjektlisten (IndexedDB)');
  await go(p, 'Prosjekt'); await p.waitForTimeout(800);
  await p.fill('#proj-desc', 'Tre dager over vidda – testbeskrivelse æøå ÆØÅ');
  await p.locator('.projdetails .seg button', { hasText: 'Klar til tur' }).click();
  await p.locator('.iconpick button').nth(1).click();
  await p.fill('#proj-notes', 'Husk ekstra brensel');
  await p.setInputFiles('#proj-cover', __dirname + '/testtile.png'); await p.waitForTimeout(1500);
  const st1 = await state(p);
  ok(st1.project.description.includes('æøå') && st1.project.status === 'klar' && st1.project.icon === '🏔️' && st1.project.notes === 'Husk ekstra brensel' && !!st1.project.coverBlobId, 'P2. beskrivelse, status, ikon, notater og forsidebilde lagret');
  // nytt tomt prosjekt
  await p.locator('button', { hasText: '+ Nytt prosjekt' }).click();
  await p.fill('#new-proj-name', 'Hardangervidda Snowkite Training'); await p.click('#new-proj-ok'); await p.waitForTimeout(2500);
  const stH = await state(p);
  ok(stH.project.name === 'Hardangervidda Snowkite Training' && stH.routes.length === 0 && stH.camps.length === 0, 'P3. nytt tomt prosjekt opprettet og åpnet (ingen ruter/teltplasser)');
  ok(/Hardangervidda/.test(await p.locator('#proj-name-header').innerText()) && await p.locator('.leaflet-container').isVisible(), 'P3. toppen viser det nye prosjektet, kartet åpnes');
  await go(p, 'Prosjekt'); await p.waitForTimeout(600);
  await p.locator('button', { hasText: '+ Nytt prosjekt' }).click();
  await p.fill('#new-proj-name', 'Future expedition concept');
  await p.locator('.newproj button', { hasText: 'Finse–Rjukan-ruten' }).click();
  await p.click('#new-proj-ok'); await p.waitForTimeout(3000);
  const stF = await state(p);
  ok(stF.project.name === 'Future expedition concept' && stF.routes.length === 1, 'P4. nytt prosjekt med Finse–Rjukan-GPX');
  ok((await projects(p)).length === 3, 'P4. tre prosjekter');
  await go(p, 'Prosjekt'); await p.waitForTimeout(600);
  // bytt tilbake
  await p.locator('.pcard', { hasText: 'Finse – Rjukan Snowkite' }).locator('button', { hasText: 'Åpne' }).first().click(); await p.waitForTimeout(2500);
  await go(p, 'Prosjekt'); await p.waitForTimeout(600);
  const stBack = await state(p);
  ok(stBack.project.name.startsWith('Finse – Rjukan') && stBack.camps.length === orig.camps && stBack.plans.length === orig.plans && stBack.routes[0].waypoints.length === orig.route0 && !!stBack.project.coverBlobId, 'P5. bytte tilbake: originaldata uendret');
  // dupliser + isolasjon
  await p.locator('.pcard', { hasText: 'Finse – Rjukan Snowkite' }).first().locator('button', { hasText: 'Dupliser' }).click(); await p.waitForTimeout(2000);
  ok((await projects(p)).some((x) => /\(kopi\)/.test(x.name)), 'P6. duplikat laget');
  await p.locator('.pcard', { hasText: '(kopi)' }).locator('button', { hasText: 'Åpne' }).click(); await p.waitForTimeout(2500);
  const stCopy = await state(p);
  await go(p, 'Prosjekt'); await p.waitForTimeout(400);
  ok(stCopy.project.coverBlobId && stCopy.project.coverBlobId !== st1.project.coverBlobId && stCopy.routes.length === stBack.routes.length, 'P6. kopien har egne bilde-id-er og samme ruter');
  await p.evaluate(() => 0);
  await go(p, 'Dagene'); await p.waitForTimeout(800);
  await p.locator('.pt-field .seg button', { hasText: /^5$/ }).click(); await p.waitForTimeout(800);
  await go(p, 'Prosjekt'); await p.waitForTimeout(600);
  await p.locator('.pcard', { hasText: 'Finse – Rjukan Snowkite Expedition 2027' }).filter({ hasNotText: 'kopi' }).locator('button', { hasText: 'Åpne' }).click(); await p.waitForTimeout(2500);
  await go(p, 'Prosjekt'); await p.waitForTimeout(600);
  const stIso = await state(p);
  ok(stIso.plans.find((x) => x.id === stIso.mainPlanId).days.length === 3, 'P6. endring i kopien (5 dager) påvirker ikke originalen (3 dager)');
  // rename via liste
  promptAnswer = 'Konsept 2028';
  await p.locator('.pcard', { hasText: 'Future expedition' }).locator('button', { hasText: 'Gi nytt navn' }).click(); await p.waitForTimeout(1200);
  ok((await projects(p)).some((x) => x.name === 'Konsept 2028'), 'P7. gi nytt navn til et annet prosjekt fra listen');
  // arkiver
  await p.locator('.pcard', { hasText: 'Konsept 2028' }).locator('button', { hasText: 'Arkiver' }).click(); await p.waitForTimeout(1200);
  ok(await p.locator('.pcard', { hasText: 'Konsept 2028' }).count() === 0 && (await projects(p)).find((x) => x.name === 'Konsept 2028').archived, 'P8. arkivert prosjekt skjules (ikke slettet)');
  await p.locator('label', { hasText: 'Vis arkiverte' }).locator('input').check(); await p.waitForTimeout(400);
  ok(await p.locator('.pcard.arch', { hasText: 'Konsept 2028' }).count() === 1, 'P8. arkiverte kan vises');
  // slett med bekreftelse
  const nBefore = (await projects(p)).length;
  await p.locator('.pcard', { hasText: '(kopi)' }).locator('button', { hasText: 'Slett' }).click(); await p.waitForTimeout(1800);
  ok((await projects(p)).length === nBefore - 1, 'P9. prosjekt slettet etter bekreftelse');
  ok(await p.locator('.card', { hasText: 'Nylig slettet' }).count() === 1, 'P9. «Nylig slettet» med gjenoppretting');
  await p.locator('.card', { hasText: 'Nylig slettet' }).locator('button', { hasText: 'gjenopprett' }).click(); await p.waitForTimeout(1800);
  ok((await projects(p)).some((x) => /\(kopi\)/.test(x.name)), 'P9. slettet prosjekt gjenopprettet');
  const pidMain = (await projects(p)).find((x) => x.name === 'Finse – Rjukan Snowkite Expedition 2027').id;

  // ---------- SCENARIOER ----------
  await go(p, 'Scenarioer'); await p.waitForTimeout(800);
  const mkScen = async (name) => {
    await p.locator('button', { hasText: '+ Nytt scenario' }).click(); await p.waitForTimeout(700);
    await go(p, 'Scenarioer'); await p.waitForTimeout(500);
    const inp = p.locator('.scen.cur .scen-name');
    await inp.fill(name); await inp.press('Enter'); await p.waitForTimeout(400);
  };
  const setWind = async (i, dirLabel, avg) => {
    const card = p.locator('.daycard2').nth(i);
    if (!(await card.locator('.windeditor').count())) await card.locator('.dc-windsum').click();
    await card.locator('.cbtn', { hasText: new RegExp(`^${dirLabel}$`) }).click();
    await card.locator('.windsliders input[type=range]').first().fill(String(avg)); await p.waitForTimeout(400);
  };
  await mkScen('A – sterk vind dag 1');
  await go(p, 'Dagene'); await p.waitForTimeout(800);
  await setWind(0, 'SV', 13); await setWind(1, 'SV', 5);
  await p.locator('.daycard2').nth(0).locator('.kchip2', { hasText: 'Peak' }).click(); await p.waitForTimeout(400);
  await go(p, 'Scenarioer'); await p.waitForTimeout(500);
  await mkScen('B – nordlig vind');
  await go(p, 'Dagene'); await p.waitForTimeout(800);
  for (let i = 0; i < 3; i++) await setWind(i, 'N', 9);
  await p.locator('.daycard2').nth(0).locator('button', { hasText: '+ Teltplass ved sluttpunktet' }).click(); await p.waitForTimeout(500);
  const stS = await state(p);
  const A = stS.plans.find((x) => x.name.startsWith('A –')), B = stS.plans.find((x) => x.name.startsWith('B –')), M = stS.plans.find((x) => x.id === stS.mainPlanId);
  ok(A && B && A.days[0].wind.avg === 13 && A.days[1].wind.avg === 5 && A.days[0].kiteId === 'peak4', 'S1. scenario A: egen vind per dag og kite dag 1');
  ok(B.days.every((d) => d.wind.dir === 0 && d.wind.avg === 9) && !!B.days[0].campId, 'S2. scenario B: nordlig vind alle dager + egen teltplass dag 1');
  ok(!M.days[0].campId && !A.days[0].campId, 'S3. teltplassvalget i B påvirker ikke A eller hovedplanen');
  ok(M.days[0].wind.avg !== 13 && M.days[0].wind.dir === 225 && A.days[0].wind.dir === 225 && A.days[2].wind.dir !== 0, 'S3. isolasjon: endringer i B påvirker ikke A eller hovedplanen');
  ok(new Set([A.days[0].id, B.days[0].id, M.days[0].id]).size === 3, 'S3. scenarioene har egne dag-objekter');
  // sammenligning
  await go(p, 'Scenarioer'); await p.waitForTimeout(800);
  for (const n of ['A –', 'B –', 'Hovedplan']) {
    const c = p.locator(`.scen[aria-label*="${n}"]`).locator('.cmpchk input');
    if (!(await c.isDisabled()) && !(await c.isChecked())) await c.check();
  }
  await p.waitForTimeout(800);
  const head = await p.locator('.cmptable thead').innerText();
  const tbl = await p.locator('.cmptable tbody').innerText();
  ok(/A –/.test(head) && /B –/.test(head) && /Hovedplan/.test(head), 'S4. sammenligningstabell med tre scenarioer');
  ok(['Total distanse', 'Antall dager', 'Ankomst', 'Reisetid per dag', 'Kite per dag', 'Vind per dag', 'Teltplasser'].every((r) => tbl.includes(r)), 'S4. alle metrikker (distanse, dager, ankomst, reisetid, kites, vind, teltplasser)');
  ok(await p.locator('.scenmap .leaflet-interactive').count() >= 3, 'S4. rutene vises i kart med egne farger');
  // gi nytt navn + sett som hovedplan
  await p.locator(`.scen[aria-label*="${'B –'}"]`).locator('button', { hasText: 'Sett som hovedplan' }).click(); await p.waitForTimeout(500);
  ok((await state(p)).mainPlanId === B.id, 'S5. B satt som hovedplan');
  await p.locator(`.scen[aria-label*="${'Hovedplan'}"]`).first().locator('button', { hasText: 'Sett som hovedplan' }).click(); await p.waitForTimeout(400);
  // dupliser og slett
  await p.locator(`.scen[aria-label*="${'A –'}"]`).locator('button', { hasText: 'Dupliser' }).click(); await p.waitForTimeout(600);
  const nPlans = (await state(p)).plans.length;
  await p.locator(`.scen[aria-label*="${'A – sterk vind dag 1 (kopi)'}"]`).locator('button', { hasText: 'Slett' }).click(); await p.waitForTimeout(600);
  ok((await state(p)).plans.length === nPlans - 1, 'S6. duplisert og slettet (med bekreftelse)');
  // del + importer
  const sf = await dlTo(p, () => p.locator(`.scen[aria-label*="${'A –'}"]`).locator('button', { hasText: 'Del (fil)' }).click());
  await p.locator('label', { hasText: 'Importer delt scenario' }).locator('input').setInputFiles(sf.f);
  await p.waitForTimeout(800);
  console.log('import msg:', await p.locator('.card .msg').first().innerText().catch(() => '-'));
  ok((await state(p)).plans.some((x) => /importert/.test(x.name)), 'S7. delt scenario importert som nytt scenario');

  // ---------- EKSPORT ----------
  const before = JSON.stringify(await state(p), (k, v) => (['lastSavedAt', 'history', 'exportPrefs', 'tab', 'compareIds'].includes(k) ? undefined : v));
  await go(p, 'Eksport'); await p.waitForTimeout(1200);
  await p.selectOption('#exp-plan', B.id); await p.waitForTimeout(400);
  const pdfB = await dlTo(p, () => p.click('#exp-pdf'), 'B-full.pdf');
  const txtB = sh('pdftotext', ['-layout', pdfB.f, '-']);
  const pagesB = +/Pages:\s+(\d+)/.exec(sh('pdfinfo', [pdfB.f]))[1];
  ok(pagesB >= 10 && /Scenario: B – nordlig vind/.test(txtB) && /Fra N \(0°\)/.test(txtB) && !/Fra SV \(225°\)/.test(txtB), `E1. full PDF for scenario B (${pagesB} sider) viser Bs vind, ikke hovedplanens`);
  ok(/æøå ÆØÅ/.test(txtB) && /Kontakter/.test(txtB) && /Side 1|Side 2 av/.test(txtB), 'E1. norske tegn, sidetall og kontaktside');
  ok(new RegExp(`Side ${pagesB} av ${pagesB}`).test(txtB), 'E1. sidetall stemmer');
  await p.locator('.preset', { hasText: 'Kompakt' }).click();
  const pdfK = await dlTo(p, () => p.click('#exp-pdf'), 'B-kompakt.pdf');
  const pagesK = +/Pages:\s+(\d+)/.exec(sh('pdfinfo', [pdfK.f]))[1];
  ok(pagesK < pagesB && pagesK >= 4, `E2. kompakt PDF (${pagesK} sider)`);
  await p.locator('.preset', { hasText: 'Feltbrief' }).click();
  const pdfF = await dlTo(p, () => p.click('#exp-pdf'), 'B-felt.pdf');
  ok(/Feltbrief|FELTBRIEF/.test(sh('pdftotext', [pdfF.f, '-'])), 'E3. feltbrief-PDF');
  await p.locator('.preset', { hasText: 'Full' }).click();
  await p.locator('.exportpage button', { hasText: 'Én dag' }).first().click(); await p.selectOption('#exp-day', '2');
  const pdfD = await dlTo(p, () => p.click('#exp-pdf'), 'B-dag2.pdf');
  const txtD = sh('pdftotext', [pdfD.f, '-']);
  ok(/DAG 2/.test(txtD) && !/DAG 1\n/.test(txtD) && +/Pages:\s+(\d+)/.exec(sh('pdfinfo', [pdfD.f]))[1] <= 4, 'E4. dags-PDF (bare dag 2)');
  await p.locator('.exportpage button', { hasText: 'Sammenligning' }).first().click();
  const pdfC = await dlTo(p, () => p.click('#exp-pdf'), 'sammenligning.pdf');
  const txtC = sh('pdftotext', ['-layout', pdfC.f, '-']);
  ok(/A – sterk vind/.test(txtC) && /B – nordlig/.test(txtC) && /Total distanse/.test(txtC), 'E5. sammenlignings-PDF');
  await p.locator('.exportpage button', { hasText: 'Hele turen' }).first().click();
  // GPX
  const g1 = await dlTo(p, () => p.click('#exp-gpx'), 'hele.gpx');
  const gx = require('fs').readFileSync(g1.f, 'utf8');
  const r0 = (await state(p)).routes[0].waypoints;
  const trkpts = [...gx.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)"/g)];
  ok(trkpts.length === r0.length && r0.every((w, i) => +trkpts[i][1] === w.lat && +trkpts[i][2] === w.lon), `E6. GPX hele ruten: ${trkpts.length} punkter, koordinater identiske (full presisjon)`);
  ok(/<wpt [^>]+><ele>|<wpt /.test(gx) && /Campground|teltplass/.test(gx) && /<ele>/.test(gx), 'E6. GPX med høyde, punkter og teltplasser');
  await p.locator('.card', { hasText: 'GPX – til Garmin' }).locator('button', { hasText: 'Én dag' }).click(); await p.selectOption('#gpx-day', '1');
  const g2 = await dlTo(p, () => p.click('#exp-gpx'), 'dag1.gpx');
  const gd = require('fs').readFileSync(g2.f, 'utf8');
  const nD = [...gd.matchAll(/<trkpt /g)].length;
  ok(nD > 5 && nD < r0.length && /Mål dag 1/.test(gd), `E7. GPX dag 1 (${nD} punkter, slutt merket)`);
  await p.locator('.card', { hasText: 'GPX – til Garmin' }).locator('button', { hasText: 'Del av ruten' }).click();
  const g3 = await dlTo(p, () => p.click('#exp-gpx'), 'segment.gpx');
  ok([...require('fs').readFileSync(g3.f, 'utf8').matchAll(/<trkpt /g)].length >= 2, 'E8. GPX segment km 0–20');
  // xmllint-lignende sjekk med python
  sh('python3', ['-c', `import xml.dom.minidom,sys\nfor f in sys.argv[1:]: xml.dom.minidom.parse(f)`, g1.f, g2.f, g3.f]);
  ok(true, 'E8. alle GPX-filer er gyldig XML');
  // GeoJSON
  const gj = await dlTo(p, () => p.click('#exp-geojson'), 'rute.geojson');
  const G = JSON.parse(require('fs').readFileSync(gj.f, 'utf8'));
  const line = G.features.find((f) => f.properties.kind === 'rute' && f.properties.main);
  ok(G.type === 'FeatureCollection' && line && line.geometry.coordinates[0][0] === r0[0].lon && line.geometry.coordinates[0][1] === r0[0].lat, 'E9. GeoJSON: FeatureCollection, [lon, lat]-rekkefølge');
  ok(['dagsetappe', 'teltplass', 'rutepunkt'].every((k) => G.features.some((f) => f.properties.kind === k)) && G.metadata.scenario === 'B – nordlig vind', 'E9. GeoJSON med dagsetapper, teltplasser, punkter og metadata (scenario B)');
  // Excel
  const xl = await dlTo(p, () => p.click('#exp-xlsx'), 'plan.xlsx');
  const xinfo = sh('python3', ['-c', `import openpyxl,sys\nwb=openpyxl.load_workbook(sys.argv[1])\nprint('|'.join(wb.sheetnames))\nws=wb['Dagsplan']\nprint(ws.max_row, ws['A1'].value, ws['D3'].value, type(ws['F2'].value).__name__)\nprint(wb['Oversikt']['B8'].value)`, xl.f]);
  const [names, dag, ov] = xinfo.trim().split('\n');
  ok(['Oversikt', 'Dagsplan', 'Sjekkpunkter', 'Rutepunkter', 'Teltplasser', 'Vindscenarioer', 'Kites', 'Forutsetninger'].every((n) => names.includes(n)), `E10. Excel med ark: ${names}`);
  ok(/^4 Dag /.test(dag) && /float|int/.test(dag) && /B – nordlig/.test(ov), `E10. Excel åpnes (openpyxl), tall som tall, riktig scenario (${dag} / ${ov})`);
  // CSV
  const cv = await dlTo(p, () => p.click('#exp-csv-days'), 'dager.csv');
  const ctext = require('fs').readFileSync(cv.f, 'utf8');
  ok(ctext.charCodeAt(0) === 0xfeff && ctext.split('\r\n')[0].includes(';') && /\d,\d/.test(ctext.split('\r\n')[1]), 'E11. CSV: UTF-8 BOM, semikolon og desimalkomma');
  // eksport endret ikke prosjektet
  const after = JSON.stringify(await state(p), (k, v) => (['lastSavedAt', 'history', 'exportPrefs', 'tab', 'compareIds'].includes(k) ? undefined : v));
  ok(before === after, 'E12. eksport endret ikke prosjektdataene');
  // ZIP + reimport
  const z = await dlTo(p, () => p.click('#exp-zip'), 'prosjekt.zip');
  const list = sh('python3', ['-c', `import zipfile,sys\nprint('\\n'.join(zipfile.ZipFile(sys.argv[1]).namelist()))`, z.f]);
  ok(['project/project.json', 'project/metadata.json', 'project/README.txt', 'project/routes/main-route.gpx', 'project/exports/ekspedisjonsplan.pdf', 'project/exports/rute.geojson', 'project/exports/ekspedisjon.xlsx'].every((x) => list.includes(x)) && /project\/scenarios\/.*b-nordlig-vind\.json/.test(list) && /project\/images\//.test(list), 'E13. ZIP med struktur project/{metadata,project,routes,scenarios,images,exports,README}');
  const nProj = (await projects(p)).length;
  await go(p, 'Prosjekt'); await p.waitForTimeout(800);
  await p.locator('label', { hasText: 'Importer prosjekt' }).locator('input').setInputFiles(z.f); await p.waitForTimeout(4000);
  await go(p, 'Prosjekt'); await p.waitForTimeout(600);
  const stI = await state(p);
  const stOrig = JSON.parse(before);
  ok((await projects(p)).length === nProj + 1 && stI.plans.length === stOrig.plans.length && stI.camps.length === stOrig.camps.length && stI.routes[0].waypoints.length === stOrig.routes[0].waypoints.length && stI.project.name === stOrig.project.name && !!stI.project.coverBlobId, 'E14. ZIP importert som nytt prosjekt med scenarioer, teltplasser, ruter og forsidebilde');
  ok(JSON.stringify(stI.plans.map((x) => x.days.map((d) => d.wind))) === JSON.stringify(stOrig.plans.map((x) => x.days.map((d) => d.wind))), 'E14. vind i alle scenarioer identisk etter import');

  // ---------- reload ----------
  await p.locator('.pcard', { hasText: 'Finse – Rjukan Snowkite Expedition 2027' }).filter({ hasNotText: 'kopi' }).locator('button', { hasText: 'Åpne' }).first().click(); await p.waitForTimeout(2500);
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3000);
  const stR = await state(p);
  ok(stR.project.name === 'Finse – Rjukan Snowkite Expedition 2027' && stR.plans.some((x) => x.name.startsWith('A –')) && stR.project.status === 'klar', 'R1. etter reload: riktig prosjekt, navn, status og scenarioer');
  ok(errs.length === 0, `ingen JS-feil desktop (${errs.slice(0, 3).join(' | ')})`);
  await ctx.close();

  // ---------- iPad / mobil ----------
  for (const [name, dev] of [['iPad', devices['iPad (gen 7)']], ['iPad liggende', devices['iPad (gen 7) landscape']], ['mobil', devices['iPhone 13']]]) {
    const c = await b.newContext({ ...dev, serviceWorkers: 'block' });
    const mp = await c.newPage(); await stubs(mp);
    const merr = []; mp.on('pageerror', (e) => merr.push(e.message));
    await mp.goto(URL0, { waitUntil: 'domcontentloaded' }); await mp.waitForTimeout(2500);
    let worst = 0;
    for (const t of ['Prosjekt', 'Scenarioer', 'Eksport', 'Dagene', 'Kart & rute']) { await go(mp, t); await mp.waitForTimeout(700); worst = Math.max(worst, await noScroll(mp)); if (name === 'iPad' || name === 'mobil') await mp.screenshot({ path: `${dir}/v6/${name}-${t.replace(/\W+/g, '')}.png` }); }
    ok(worst <= 1, `M. ${name}: ingen horisontal scroll (prosjekt, scenarioer, eksport, dager, kart) (${worst}px)`);
    const bt = await mp.locator('#exp-pdf').boundingBox().catch(() => null);
    await go(mp, 'Eksport'); await mp.waitForTimeout(500);
    const bb = await mp.locator('#exp-pdf').boundingBox();
    ok(bb && bb.height >= 40, `M. ${name}: stor PDF-knapp (${Math.round(bb?.height)} px)`);
    ok(merr.length === 0, `M. ${name}: ingen JS-feil`);
    await c.close();
  }
  console.log(fail ? `${fail} FEIL` : 'ALLE V6-TESTER OK');
  await b.close();
})();
