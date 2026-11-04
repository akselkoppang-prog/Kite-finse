const { chromium, devices } = require('playwright');
const fs = require('fs');
const dir = process.argv[2];
const URL0 = 'http://localhost:4174/';
let fail = 0;
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fail++; };

// v5-navigasjon: gamle fanenavn → hovedmeny + undermeny
const NAV = { 'Kart & rute': ['Oversikt'], 'Overstyringer': ['Utstyr & planlegging', 'Vann-godkjenninger'], 'Kite-quiver': ['Vær & kite', 'Kitedatabase'], 'Kalender': ['Dagplan', 'Kalender og sol'], 'Dagplan': ['Dagplan', 'Avansert dagsfordeling'], 'Dagene': ['Dagplan', 'Dagene'], 'Kite og vind': ['Vær & kite', 'Kite og vind'], 'Utstyr & offline': ['Utstyr & planlegging', 'Utstyr'], 'Vær & vind': ['Vær & kite', 'Værmelding'], 'Sikkerhet': ['Utstyr & planlegging', 'Sikkerhet'], 'YTELSESSIMULATOR': ['Vær & kite', 'Simulator'], 'Modell & kalibrering': ['Innstillinger', 'Modell og kalibrering'], 'Datakilder & diagnose': ['Innstillinger', 'Datakilder'], 'Innstillinger / Lagring': ['Innstillinger', 'Lagring og backup'] };
async function openAdv(p) { await p.evaluate(() => document.querySelectorAll('details.ov-adv').forEach((d) => { d.open = true; })); await p.waitForTimeout(200); }
async function go(p, name) {
  const [m, s] = NAV[name] || [name];
  await p.locator('nav.mainnav button', { hasText: m }).first().click();
  if (s) await p.locator('nav.subnav button', { hasText: s }).first().click();
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
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) errs.push(m.text()); });
  await stubs(p);
  await p.goto(URL0, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500); await openAdv(p);
  ok(await p.locator('.ov-hero').count() > 0 && await p.locator('.tripstrip').count() > 0, 'oversikt med dagstripe vises');
  for (const t of ['1. Hent', '2. Last', '3. Finn', '4. Terreng']) { await p.click(`button:has-text("${t}")`); await p.waitForTimeout(t === '4. Terreng' ? 8000 : 1500); }
  const wc = await p.locator('.panel .card', { hasText: 'Vannkontroll' }).innerText();
  ok(/VIKTIG/.test(wc) && /Testtjern/.test(wc), 'kryssing Testtjern blokkert før whitelist');
  await p.locator('.cross', { hasText: 'Testtjern' }).locator('button:has-text("Detaljer")').click();
  await p.waitForTimeout(400);
  ok(await p.locator('.drawer h3:has-text("Testtjern")').count() === 1, 'vann-panel åpnes');
  const drawer = await p.locator('.drawer').innerText();
  ok(/Opprinnelig status/.test(drawer) && /IKKE VERIFISERT/.test(drawer) && /Kryssinger/.test(drawer), 'panel viser status, kilde og kryssing');
  ok(await p.locator('.drawer button:has-text("GODKJENN FOR MIN RUTE")').count() > 0, 'stor GODKJENN FOR MIN RUTE-knapp vises');
  await p.click('.drawer button:has-text("GODKJENN FOR MIN RUTE")');
  await p.waitForTimeout(400);
  const qa = await p.locator('.panel .card', { hasText: 'Vannkontroll' }).innerText();
  ok(/BRUKERGODKJENT/.test(qa), 'hurtiggodkjenning: kryssingen blir BRUKERGODKJENT med ett klikk');
  ok(/USER APPROVED/.test(await p.locator('.drawer').innerText()) && /IKKE VERIFISERT/.test(await p.locator('.drawer').innerText()), 'USER APPROVED vises, opprinnelig status beholdt');
  await p.click('.drawer button:has-text("Angre")');
  await p.waitForTimeout(300);
  await p.click('.drawer summary:has-text("Avansert whitelist")');
  await p.click('.drawer button:has-text("Legg til i whitelist")');
  ok(await p.locator('.drawer .err').count() > 0, 'begrunnelse påkrevd i avansert whitelist');
  await p.fill('#ovr-note', 'Kjenner tjernet – grunt, kryss kun ved innløpet i nord.');
  await p.fill('#ovr-link', 'https://atlas.nve.no');
  await p.click('.drawer button:has-text("Legg til i whitelist")');
  await p.waitForTimeout(500);
  const wc2 = await p.locator('.panel .card', { hasText: 'Vannkontroll' }).innerText();
  ok(/BRUKERGODKJENT/.test(wc2), 'kryssing blir BRUKERGODKJENT');
  ok(/IKKE VERIFISERT/.test(wc2), 'opprinnelig advarsel fortsatt synlig');
  ok(await p.locator('.override-tag').count() > 0, 'USER OVERRIDE-merke i kartet');
  await p.screenshot({ path: dir + '/v2-lake.png' });
  await p.click('.drawer button[aria-label="Lukk"]');
  await go(p, 'Overstyringer'); await p.waitForTimeout(500);
  ok(/Testtjern/.test(await p.locator('.page .card', { hasText: 'Vann-overstyringer' }).innerText()), 'overstyring listet på egen side');
  await go(p, 'Kart & rute'); await p.waitForTimeout(300);
  await state(p);
  await p.evaluate(() => new Promise((res) => { const r = indexedDB.open('kite-finse-rjukan'); r.onsuccess = () => { const db = r.result; const tx = db.transaction(['slices', 'meta'], 'readwrite'); const m = tx.objectStore('meta').get('activeProject'); m.onsuccess = () => { const pid = (m.result || {}).value || 'default'; const g = tx.objectStore('slices').get([pid, 'overrides']); g.onsuccess = () => { const rec = g.result; rec.value.lakeOverrides.forEach((o) => (o.expires = '2026-01-01')); tx.objectStore('slices').put(rec); }; }; tx.oncomplete = () => { db.close(); res(); }; }; }));
  await p.reload(); await p.waitForTimeout(2500); await openAdv(p);
  await go(p, 'Kart & rute'); await p.waitForTimeout(500);
  const wc3 = await p.locator('.panel .card', { hasText: 'Vannkontroll' }).innerText().catch(() => '');
  ok(/VIKTIG/.test(wc3) && /utløpt/.test(wc3), 'utløpt overstyring blokkerer igjen (etter reload)');
  await p.locator('.wplabel:has-text("Start (GPX)")').locator('xpath=..').dispatchEvent('click');
  await p.waitForTimeout(400);
  ok(await p.locator('.drawer #wp-name').count() === 1, 'rutepunkt-panel åpnes ved klikk');
  await p.selectOption('#wp-cat', 'launch');
  await p.fill('#wp-desc', 'God startplass – slett snøflate øst for stasjonen');
  await p.selectOption('#wp-ver', 'brukergodkjent');
  await p.click('.drawer button[aria-label="Lukk"]');
  await p.click('button:has-text("📝 Markør")');
  const mb = await p.locator('.map').boundingBox();
  await p.mouse.click(mb.x + mb.width * 0.3, mb.y + mb.height * 0.5);
  await p.waitForTimeout(400);
  ok(await p.locator('.drawer h3:has-text("Notat 1")').count() === 1, 'ny markør åpner panel');
  await p.selectOption('#wp-cat', 'exit');
  await p.fill('#wp-name', 'Nødutgang test');
  await p.click('.drawer button[aria-label="Lukk"]');
  await p.click('button:has-text("Panorer")');
  // umiddelbar omlasting (før autolagringen rekker å skrive): data skal enten være lagret eller tilbys fra nødkopien
  await p.reload(); await p.waitForTimeout(2500); await openAdv(p);
  let stQ = await state(p);
  if (!stQ.markers.some((m) => m.name === 'Nødutgang test')) {
    ok(await p.locator('.banner', { hasText: 'ulagrede endringer' }).count() === 1, 'omlasting midt i lagring: nødkopi tilbys');
    await p.click('.banner button:has-text("Gjenopprett endringene")'); await p.waitForTimeout(1200);
  } else ok(true, 'omlasting: endringene var allerede lagret');
  const st1 = await state(p);
  const r0 = st1.routes.find((x) => x.id === 'gpx-original').waypoints[0];
  ok(r0.category === 'launch' && /startplass/.test(r0.description) && r0.verification === 'brukergodkjent', 'rutepunkt-notat lagret etter reload');
  ok(st1.markers.some((m) => m.name === 'Nødutgang test' && m.category === 'exit'), 'markør lagret etter reload');
  await go(p, 'Kite-quiver'); await p.waitForTimeout(500);
  await p.check('#kp-stoke9');
  await p.locator('.kp', { hasText: 'Stoke 2' }).locator('button:has-text("Sekundær")').click();
  ok(await p.isChecked('#kp-stoke9'), 'tube-kite 9 m² kan velges');
  const adv = await p.locator('.page .card', { hasText: 'Hurtigråd' }).innerText();
  ok(/Stoke 2/.test(adv) && !/frarådet/.test(adv), 'tube-kite rangeres, ikke utelukket');
  ok(await p.locator('.cov tbody tr').count() >= 2, 'quiver-sammenligning vises');
  await p.screenshot({ path: dir + '/v2-kite.png', fullPage: true });
  await go(p, 'Kalender'); await p.waitForTimeout(500);
  const sun1 = await p.locator('.page .card', { hasText: 'Sol og dagslys' }).innerText();
  await p.click('.cal-d[aria-label="2027-03-30"]');
  await p.waitForTimeout(300);
  const sun2 = await p.locator('.page .card', { hasText: 'Sol og dagslys' }).innerText();
  ok(sun1 !== sun2 && /2027-03-30/.test(sun2) && /CEST|GMT\+2|UTC\+2|MESZ/.test(sun2), 'datoendring oppdaterer sol-tabell (sommertid)');
  ok(/30\. mar/.test(await p.locator('.hsum').innerText()), 'datoendring oppdaterer hele dashboardet');
  await p.screenshot({ path: dir + '/v2-cal.png', fullPage: true });
  await go(p, 'Dagplan'); await p.waitForTimeout(800);
  ok(await p.locator('.daycard').count() === 3, '3 dagkort som standard');
  const d1 = await p.locator('.daycard').first().innerText();
  ok(/Kitetid/.test(d1) && /Dagslys igjen/.test(d1) && /Sol/.test(d1), 'dagkort viser kitetid og dagslys');
  const b1 = (await state(p)).routes.find((x) => x.id === (st1.activeRouteId)).dayBreaks;
  const cp = p.locator('.daycard').nth(1).locator('.cp').first();
  if (await cp.count()) {
    const dt = await p.evaluateHandle(() => new DataTransfer());
    await cp.dispatchEvent('dragstart', { dataTransfer: dt });
    await p.locator('.daycard').nth(0).dispatchEvent('dragover', { dataTransfer: dt });
    await p.locator('.daycard').nth(0).dispatchEvent('drop', { dataTransfer: dt });
    await p.waitForTimeout(400);
    const b2 = (await state(p)).routes.find((x) => x.id === st1.activeRouteId).dayBreaks;
    ok(JSON.stringify(b1) !== JSON.stringify(b2), 'dra sjekkpunkt til forrige dag flytter dagsskift');
  } else console.log('INFO: ingen sjekkpunkt på dag 2 å dra');
  await p.selectOption('#dp-days', '5'); await p.waitForTimeout(500);
  ok(await p.locator('.daycard').count() === 5, 'utvidet til 5 dager uten ny rute');
  await p.selectOption('#dp-days', '3'); await p.waitForTimeout(500);
  console.log('Scenarioer:', (await p.locator('.scen').first().innerText()).replace(/\n+/g, ' | ').slice(0, 400));
  await p.screenshot({ path: dir + '/v2-dag.png', fullPage: true });
  await go(p, 'Utstyr & offline'); await p.waitForTimeout(500);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("GPX (ruter, punkter, notater)")')]);
  const gpxPath = dir + '/export.gpx'; await dl.saveAs(gpxPath);
  const gx = fs.readFileSync(gpxPath, 'utf8');
  ok(/<type>launch<\/type>/.test(gx) && /startplass/.test(gx) && /Nødutgang test/.test(gx), 'GPX-eksport inneholder kategori, beskrivelse og markører');
  const before = await state(p);
  await go(p, 'Kart & rute'); await p.waitForTimeout(400);
  await p.setInputFiles('input[type=file][accept*=".gpx"]', gpxPath); await p.waitForTimeout(800);
  const after = await state(p);
  ok(after.routes.length > before.routes.length && after.markers.length > before.markers.length && after.routes.find((x) => x.id === 'gpx-original').waypoints[0].category === 'launch' && after.markers.some((m) => m.category === 'launch'), 'GPX-import legger til uten å fjerne eksisterende data, kategori bevart');
  await go(p, 'Utstyr & offline'); await p.waitForTimeout(300);
  const [dj] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("Last ned hele prosjektet")')]);
  const jp = dir + '/proj.zip'; await dj.saveAs(jp);
  const pj = JSON.parse(require('child_process').execSync(`python3 -c "import zipfile;z=zipfile.ZipFile('${jp}');print(z.read([n for n in z.namelist() if n.endswith('project.json')][0]).decode())"`).toString());
  const sl = pj.slices;
  ok(pj.version === 3 && sl.lakeOverrides.length >= 1 && sl.quivers && sl.markers.length >= 1 && sl.tripDate === '2027-03-30' && sl.history.length > 0 && sl.travel, 'prosjektfil (ZIP v3) inneholder overstyringer, kites, datoer, markører, historikk, modell');
  ok(/Mat og vann/.test(await p.locator('.page .card', { hasText: 'Mat og brensel' }).innerText()), 'mat/brensel lenker til matplanen');
  await p.evaluate(() => new Promise((res) => { localStorage.clear(); const r = indexedDB.deleteDatabase('kite-finse-rjukan'); r.onsuccess = r.onerror = r.onblocked = () => res(); }));
  await p.goto('about:blank'); await p.goto(URL0); await openAdv(p); await p.waitForSelector('.saveind'); await p.waitForTimeout(1500);
  await go(p, 'Kart & rute');
  await p.setInputFiles('input[type=file][accept=".json,.zip"]', jp); await p.waitForTimeout(2000);
  const rest = await state(p);
  ok(rest.lakeOverrides.length >= 1 && rest.tripDate === '2027-03-30' && rest.markers.length >= 1 && rest.quivers.some((q) => q.kiteIds.includes('stoke9')), 'prosjektfil gjenoppretter alt etter tømt nettleser');
  await go(p, 'Vær & vind'); await p.waitForTimeout(300);
  ok(/ingen prognose for turdagene ennå/.test(await p.locator('.page .card', { hasText: 'Vær for turdagene' }).innerText()), 'ingen prognose utenfor horisont');
  await go(p, 'Sikkerhet'); await p.waitForTimeout(500);
  ok(/Krossobanen/.test(await p.locator('.page .card', { hasText: 'Sluttnedstigning' }).innerText()), 'sluttnedstigning som eget segment');
  await p.screenshot({ path: dir + '/v2-safety.png', fullPage: true });
  await go(p, 'Kart & rute'); await p.waitForTimeout(800);
  await p.screenshot({ path: dir + '/v2-map.png' });
  // --- Ytelsessimulator ---
  await go(p, 'YTELSESSIMULATOR'); await p.waitForTimeout(1500);
  const r1 = await p.locator('.page .card', { hasText: 'Resultat' }).first().innerText();
  ok(/Ankomst/.test(r1) && /Fremdrift ved kiting/.test(r1), 'simulator viser resultat');
  const arr1 = r1.match(/Ankomst\n([^\n]+)/)?.[1];
  await p.click('.page .card button:has-text("SØ")'); await p.waitForTimeout(1200);
  const r2 = await p.locator('.page .card', { hasText: 'Resultat' }).first().innerText();
  const arr2 = r2.match(/Ankomst\n([^\n]+)/)?.[1];
  ok(arr1 !== arr2, `vindretning endrer ankomst (${arr1} → ${arr2})`);
  await p.click('.page .card button:has-text("SV")'); await p.waitForTimeout(1000);
  await p.selectOption('#sim-kmode', 'single'); await p.selectOption('#sim-kite', 'soul15'); await p.waitForTimeout(1000);
  const r3 = await p.locator('.page .card', { hasText: 'Resultat' }).first().innerText();
  await p.selectOption('#sim-kite', 'sonic10'); await p.waitForTimeout(1000);
  const r4 = await p.locator('.page .card', { hasText: 'Resultat' }).first().innerText();
  ok(r3 !== r4, 'Soul 15 → Sonic 10 endrer resultatet');
  await p.selectOption('#sim-kmode', 'quiver'); await p.waitForTimeout(800);
  const cmp = await p.locator('.page .card', { hasText: 'Samme rute og vind med hver kite' }).innerText();
  ok(/Peak/.test(cmp) && /Stoke/.test(cmp) && /Pivot/.test(cmp) && /Min quiver/.test(cmp), 'kitesammenligning inkluderer alle kites og quiver');
  ok(/Fysikkvindu/.test(await p.locator('.page .card', { hasText: 'Kitevurdering for vindfordelingen' }).innerText()), 'vindfordelings-tabell vises');
  ok(await p.locator('.page .card', { hasText: 'Etapper' }).locator('tbody tr').count() > 20, 'etappetabell fylt');
  await p.click('button:has-text("Beregn usikkerhet")'); await p.waitForTimeout(8000);
  ok(/P10–P50–P90/.test(await p.locator('.page .card', { hasText: 'Resultat' }).first().innerText()), 'usikkerhetsintervall beregnet');
  // daglig distanse
  const ds = p.locator('.page .card', { hasText: 'SIMULER DAGSDISTANSE' });
  const ds1 = await ds.innerText();
  await p.fill('#ds-target', '30'); await p.locator('#ds-target').dispatchEvent('input'); await p.waitForTimeout(600);
  await p.evaluate(() => { const el = document.querySelector('#ds-target'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '30'); el.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForTimeout(600);
  const ds2 = await ds.innerText();
  ok(ds1 !== ds2 && /0\.0 → 30\.0 km/.test(ds2), 'dagsdistanse-slider oppdaterer sluttpunkt');
  ok(/Gjenstår til mål/.test(ds2), 'gjenstående distanse vises');
  await ds.locator('button:has-text("Analyser leirområdet")').click(); await p.waitForTimeout(5000);
  ok(await ds.locator('.campcard').count() >= 1 || /Ingen trygge/.test(await ds.innerText()), 'leirkandidater ved sluttpunkt vurdert');
  if (await ds.locator('.campcard button:has-text("Velg som leir")').count()) { await ds.locator('.campcard button:has-text("Velg som leir")').first().click(); }
  await ds.locator('button:has-text("Sett som slutt på dag 1")').click(); await p.waitForTimeout(300);
  const stB = await state(p); const brk = stB.routes.find((x) => x.id === stB.activeRouteId).dayBreaks;
  ok(brk && Math.abs(brk[0] - 30000) < 1500, `dagsslutt satt fra simulatoren (${brk && (brk[0] / 1000).toFixed(1)} km)`);
  // reiseplaner
  const itCard = p.locator('.page .card', { hasText: 'Reiseplan-simulator' });
  const names = await itCard.locator('.itin input[aria-label="Navn på plan"]').evaluateAll((els) => els.map((e) => e.value));
  ok(names.length === 3 && /Plan A/.test(names[0]) && /Dagslys igjen/.test(await itCard.innerText()), `tre reiseplaner sammenlignes (${names.join(', ')})`);
  await p.screenshot({ path: dir + '/v3-sim.png', fullPage: true });
  // avspilling
  await go(p, 'YTELSESSIMULATOR'); await p.waitForTimeout(800);
  await p.click('button:has-text("Spill av i kartet")'); await p.waitForTimeout(800);
  ok(await p.locator('.simplayer').count() === 1, 'avspillingspanel i kartet');
  const k0 = await p.locator('.simplayer .mono').innerText();
  await p.click('.simplayer button:has-text("10×")');
  await p.click('.simplayer button[aria-label="Spill"]'); await p.waitForTimeout(2500);
  const k1 = await p.locator('.simplayer .mono').innerText();
  ok(k0 !== k1 && await p.locator('.simdot').count() === 1, `animasjonen beveger seg (${k0.slice(0, 40)} → ${k1.slice(0, 40)})`);
  await p.click('.simplayer button[aria-label="Pause"]');
  await p.screenshot({ path: dir + '/v3-play.png' });
  // teltplass-panel og sletting
  const nCamps = (await state(p)).camps.length;
  if (nCamps) {
    await p.locator('.camp').first().locator('xpath=..').dispatchEvent('click'); await p.waitForTimeout(400);
    ok(await p.locator('.drawer h3:has-text("⛺")').count() === 1, 'teltplass-panel åpnes');
    await p.selectOption('#camp-role', 'foretrukket');
    await p.click('.drawer button:has-text("Dupliser")'); await p.waitForTimeout(200);
    ok((await state(p)).camps.length === nCamps + 1, 'teltplass duplisert');
    await p.click('.drawer button:has-text("Slett teltplass")'); await p.click('.drawer button:has-text("Ja, slett")'); await p.waitForTimeout(200);
    ok((await state(p)).camps.length === nCamps, 'teltplass slettet');
  }
  // modell + diagnose + sol
  await go(p, 'Modell & kalibrering'); await p.waitForTimeout(500);
  ok(/Modellantakelser/.test(await p.locator('.page').innerText()) && await p.locator('#mp-comfortKmh').count() === 1, 'modellside med redigerbare parametre');
  await go(p, 'Kite-quiver'); await p.waitForTimeout(400);
  const specs = await p.locator('.page .card', { hasText: 'Kitedatabase – spesifikasjoner' }).first().innerText();
  ok(/6.4/.test(specs) && /45 celler/.test(specs) && /12.44/.test(specs) && /produsent/.test(specs) && /ikke funnet/.test(specs), 'kitedatabase med kilder og ukjente felt');
  await go(p, 'Kalender'); await p.waitForTimeout(500);
  const sun = await p.locator('.page .card', { hasText: 'Sol og dagslys – simulator' }).innerText();
  ok(/Tidlig mars/.test(sun) && /Sen april/.test(sun) && /Nautisk/.test(sun) && /start nedstigningen senest/.test(sun), 'sol-simulator med steder, datoer og nedstigningsmargin');
  ok(await p.locator('.dl.astro').count() > 5, 'tussmørkebånd tegnet');
  await p.screenshot({ path: dir + '/v3-sun.png', fullPage: true });
  await go(p, 'Datakilder & diagnose'); await p.waitForTimeout(300);
  await p.click('button:has-text("Kjør alle tester nå")'); await p.waitForTimeout(12000);
  const dg = await p.locator('.page .card', { hasText: 'Live-diagnose' }).innerText();
  ok(/Kartverket topo-fliser/.test(dg) && /MET Locationforecast/.test(dg) && /Solberegning/.test(dg), 'live-diagnose kjører alle tester');
  console.log('DIAGNOSE (sandkasse uten nett, stubber for noen):', dg.split('\n').filter((l) => /^(OK|FEIL|HOPPET)/.test(l)).join(' | ').slice(0, 600));

  const m = await b.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  const mp = await m.newPage(); await stubs(mp);
  mp.on('pageerror', e => errs.push('MOBILE ' + e.message));
  await mp.goto(URL0, { waitUntil: 'domcontentloaded' }); await mp.waitForTimeout(2500); await openAdv(mp);
  const ow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(ow <= 1, `mobil: ingen horisontal scroll (${ow}px)`);
  await mp.screenshot({ path: dir + '/v2-mobile.png' });
  for (const t of ['YTELSESSIMULATOR', 'Dagplan', 'Kite-quiver', 'Kalender', 'Utstyr & offline', 'Modell & kalibrering']) {
    await go(mp, t); await mp.waitForTimeout(600);
    const o = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(o <= 1, `mobil ${t}: ingen horisontal scroll (${o}px)`);
  }
  await go(mp, 'Dagplan'); await mp.waitForTimeout(500);
  await mp.screenshot({ path: dir + '/v2-mobile-dag.png' });
  console.log('ERRORS:', errs.slice(0, 8));
  ok(errs.length === 0, 'ingen JS-feil');
  console.log(fail ? `${fail} FEIL` : 'ALLE E2E-TESTER OK');
  await b.close();
})();
