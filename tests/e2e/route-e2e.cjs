// Ruteveiviser ende-til-ende: start/mål i kart, søk og koordinater, mellompunkter, flytting, rekkefølge,
// lagre og gjenåpne, redigere, GPX-eksport, GPX-import av samme fil og kontroll av alle koordinater.
// Kjør mot ferdig bygg: npx vite preview --port 4174  →  node tests/e2e/route-e2e.cjs [mappe]
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const URL0 = process.env.URL0 || 'http://localhost:4174/';
const dir = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'route-e2e-'));
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) fails++; };

async function stubs(p) {
  await p.route('**/stedsnavn/v1/navn**', (r) => {
    const q = new URL(r.request().url()).searchParams.get('sok') || '';
    const db = { finse: [7.5034, 60.6012, 'Finse', 'Tettsted'], rjukan: [8.5944, 59.8783, 'Rjukan', 'By'], kalhovd: [8.2, 60.05, 'Kalhovd turisthytte', 'Turisthytte'] };
    const hit = Object.entries(db).find(([k]) => q.toLowerCase().startsWith(k));
    r.fulfill({ json: { navn: hit ? [{ skrivemåte: hit[1][2], navneobjekttype: hit[1][3], representasjonspunkt: { øst: hit[1][0], nord: hit[1][1] }, kommuner: [{ kommunenavn: 'Test' }] }] : [] } });
  });
  await p.route('**/stedsnavn/v1/punkt**', (r) => r.fulfill({ json: { navn: [{ stedsnavn: [{ skrivemåte: 'Testvatnet' }], navneobjekttype: 'Vann', meterFraPunkt: 300 }] } }));
  await p.route('**/hoydedata/v1/punkt**', (r) => { const u = new URL(r.request().url()); const pts = JSON.parse(u.searchParams.get('punkter') || '[]'); r.fulfill({ json: { punkter: pts.map(([x, y]) => ({ x, y, z: 1100 + Math.sin(x * 40) * 80 + Math.cos(y * 55) * 60, terreng: 'T', datakilde: 'stub' })) } }); });
  await p.route(/api\.met\.no|open-meteo|nve\.no|varsom|geodataonline/, (r) => r.abort());
}
// lagret tilstand rett fra IndexedDB (etter at autolagring er bekreftet)
const state = async (p) => {
  for (let i = 0; i < 40; i++) { const t = await p.locator('.saveind').innerText(); if (/LAGRET/.test(t) && !/ULAGREDE/.test(t)) break; await p.waitForTimeout(150); }
  return p.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('kite-finse-rjukan');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const db = r.result; const tx = db.transaction(['slices', 'routes', 'meta'], 'readonly'); const out = {}; let n = 0;
      ['slices', 'routes', 'meta'].forEach((s) => { const q = tx.objectStore(s).getAll(); q.onsuccess = () => { out[s] = q.result; if (++n === 3) {
        const pid = (out.meta.find((m) => m.key === 'activeProject') || {}).value || 'default';
        const st = {}; out.slices.filter((x) => x.projectId === pid && x.slice !== 'routeOrder').forEach((x) => Object.assign(st, x.value));
        st.routes = out.routes.filter((x) => x.projectId === pid).map((x) => x.value);
        res(st);
      } }; });
    };
  }));
};
const mapBox = (p) => p.locator('.leaflet-container').boundingBox();
const clickMap = async (p, fx, fy) => { const b = await mapBox(p); await p.mouse.click(b.x + b.width * fx, b.y + b.height * fy); await p.waitForTimeout(350); };
const rb = (p) => p.locator('#route-builder');
const coordsOf = async (p, sel) => (await p.locator(sel).innerText()).match(/(-?\d+\.\d+), (-?\d+\.\d+)/).slice(1).map(Number);

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1366, height: 950 }, serviceWorkers: 'block', acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) errs.push(m.text()); });
  await stubs(p);
  await p.goto(URL0 + '#oversikt', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3500);
  const before = await state(p);

  // ---------- 1. start og mål i kartet ----------
  await p.locator('#ov-route button', { hasText: 'Ny rute' }).click(); await p.waitForTimeout(400);
  ok(await rb(p).isVisible() && /Hvor starter dere/.test(await rb(p).innerText()), '1. «Ny rute» åpner veiviseren på steg 1 (start)');
  ok(await p.locator('#rb-next').isDisabled(), '1. kan ikke gå videre uten start');
  await clickMap(p, 0.55, 0.3);
  ok(await p.locator('.leaflet-marker-pane .dpin.dp-start').count() === 1, '1. trykk i kartet → START-merke');
  ok(/Hvor er målet/.test(await rb(p).innerText()), '1. går automatisk videre til mål');
  await clickMap(p, 0.8, 0.75);
  ok(await p.locator('.leaflet-marker-pane .dpin.dp-finish').count() === 1, '1. trykk i kartet → MÅL-merke');
  await p.waitForTimeout(600);
  ok(/Testvatnet/.test(await rb(p).innerText().catch(() => '')) || /Testvatnet/.test(await p.locator('.leaflet-marker-pane').innerText()), '1. punkt i kartet får navn fra nærmeste sted');
  ok(await p.locator('.leaflet-overlay-pane path[stroke="#a855f7"]').count() === 1, '1. linjen mellom start og mål vises');
  // angre / gjør om
  await p.locator('button[aria-label="Angre"]').click(); await p.waitForTimeout(200);
  ok(await p.locator('.leaflet-marker-pane .dpin.dp-finish').count() === 0, '1. angre fjerner målet');
  await p.locator('button[aria-label="Gjør om"]').click(); await p.waitForTimeout(200);
  ok(await p.locator('.leaflet-marker-pane .dpin.dp-finish').count() === 1, '1. gjør om legger det tilbake');
  // ingen mellompunkter → hopp over → lagre
  ok(/Hopp over/.test(await p.locator('#rb-next').innerText()), '1. steg 3 kan hoppes over (ingen mellompunkter)');
  await p.click('#rb-next'); await p.click('#rb-next'); await p.waitForTimeout(400);
  await p.fill('#rb-name', 'Kartrute'); await p.click('#rb-save'); await p.waitForTimeout(600);
  let st = await state(p);
  const kart = st.routes.find((r) => r.name === 'Kartrute');
  ok(kart && kart.waypoints.length === 2, `1. rute lagret med start og mål (${kart?.waypoints.length} punkter)`);
  ok(st.routes.length === before.routes.length + 1 && st.activeRouteId === kart?.id, '1. lagt til i prosjektet og valgt som aktiv rute');
  const plan = st.plans.find((x) => x.id === st.activePlanId);
  ok(plan.routeId === kart.id, '1. scenarioet bruker den nye ruten');
  ok(/lagret/.test(await rb(p).innerText()) && await p.locator('#rb-gpx').isVisible(), '1. steg 6: eksport tilbys etter lagring');
  await p.locator('#route-builder button', { hasText: 'Ferdig' }).click(); await p.waitForTimeout(300);

  // ---------- 2. stedsnavnsøk ----------
  await p.locator('#ov-route button', { hasText: 'Ny rute' }).click(); await p.waitForTimeout(300);
  await p.fill('.pk-q', 'Finse'); await p.press('.pk-q', 'Enter'); await p.waitForTimeout(500);
  await p.locator('.pk-res button', { hasText: 'Finse' }).click(); await p.waitForTimeout(300);
  await p.fill('.pk-q', 'Rjukan'); await p.press('.pk-q', 'Enter'); await p.waitForTimeout(500);
  await p.locator('.pk-res button', { hasText: 'Rjukan' }).click(); await p.waitForTimeout(300);
  await p.fill('.pk-q', 'finnesikke'); await p.press('.pk-q', 'Enter'); await p.waitForTimeout(400);
  ok(/Fant ingen steder/.test(await rb(p).innerText()), '2. søk uten treff forklarer hva du kan gjøre');
  // ---------- 4. flere mellompunkter ----------
  await p.fill('.pk-q', 'Kalhovd'); await p.press('.pk-q', 'Enter'); await p.waitForTimeout(500);
  await p.locator('.pk-res button', { hasText: 'Kalhovd' }).click(); await p.waitForTimeout(300);
  await clickMap(p, 0.62, 0.42); await clickMap(p, 0.7, 0.58);
  ok(await p.locator('.leaflet-marker-pane .dpin.dp-via').count() === 3, '4. tre mellompunkter, nummerert i kartet');
  const labels = await p.locator('.rb-seq .dpin').allInnerTexts();
  ok(labels.join(',') === 'S,1,2,3,M', `4. rekkefølgen vises: ${labels.join(' → ')}`);
  // ---------- 5. flytte og endre rekkefølge ----------
  const names0 = await p.locator('.rb-seq .seq-via input').evaluateAll((els) => els.map((e) => e.value || e.placeholder));
  await p.locator('button[aria-label="Flytt punkt 2 opp"]').click(); await p.waitForTimeout(200);
  const names1 = await p.locator('.rb-seq .seq-via input').evaluateAll((els) => els.map((e) => e.value || e.placeholder));
  ok(names1[0] === names0[1] && names1[1] === names0[0], '5. pil opp bytter rekkefølge på punkt 1 og 2');
  const via3 = p.locator('.leaflet-marker-pane .dpin.dp-via', { hasText: '3' });
  const vb = await via3.boundingBox();
  const ph0 = await p.locator('.rb-seq .seq-via input').nth(2).getAttribute('placeholder');
  await p.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2); await p.mouse.down(); await p.mouse.move(vb.x + 60, vb.y + 40, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(400);
  const ph1 = await p.locator('.rb-seq .seq-via input').nth(2).getAttribute('placeholder');
  ok(ph0 !== ph1, `5. dra punkt 3 i kartet flytter det (${ph0} → ${ph1})`);
  await p.locator('button[aria-label="Slett punkt 3"]').click(); await p.waitForTimeout(200);
  ok(await p.locator('.leaflet-marker-pane .dpin.dp-via').count() === 2, '5. slett mellompunkt');
  await p.locator('button[aria-label="Angre"]').click(); await p.waitForTimeout(200);
  ok(await p.locator('.leaflet-marker-pane .dpin.dp-via').count() === 3, '5. angre gjenoppretter det slettede punktet');
  // ---------- linje: følg eksisterende rute ----------
  await p.click('#rb-next'); await p.waitForTimeout(800);
  ok(/Rette linjer/.test(await rb(p).innerText()) && /ingen rutetjeneste/i.test(await rb(p).innerText()), '4. linjetype forklart (rette linjer, ingen rutetjeneste)');
  ok(/Distanse[\s\S]*km/.test(await p.locator('#rb-summary').innerText()), '4. distanse vises');
  await p.waitForTimeout(1500);
  ok(/\d+ \/ \d+ m/.test(await p.locator('#rb-summary').innerText()), '4. stigning/fall fra høydedata vises');
  await p.click('#rb-next'); await p.fill('#rb-name', 'Søkerute'); await p.click('#rb-save'); await p.waitForTimeout(600);
  st = await state(p);
  const sok = st.routes.find((r) => r.name === 'Søkerute');
  ok(sok && sok.waypoints.length === 5 && sok.waypoints[0].name === 'Finse' && sok.waypoints[4].name === 'Rjukan', `2. søkerute: Finse → … → Rjukan (${sok?.waypoints.map((w) => w.name ?? '·').join(' → ')})`);
  ok(Math.abs(sok.waypoints[0].lat - 60.6012) < 1e-9 && Math.abs(sok.waypoints[0].lon - 7.5034) < 1e-9 && Math.abs(sok.waypoints[4].lat - 59.8783) < 1e-9, '2. koordinatene fra søket lagres eksakt');
  ok(sok.waypoints.some((w) => w.name === 'Kalhovd turisthytte'), '4. mellompunkt fra søk beholder navnet');

  // ---------- 6. eksport GPX fra veiviseren ----------
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#rb-gpx')]);
  const gpxPath = path.join(dir, 'sokerute.gpx'); await dl.saveAs(gpxPath);
  const gx = fs.readFileSync(gpxPath, 'utf8');
  ok(/<gpx version="1.1"/.test(gx) && /xmlns="http:\/\/www.topografix.com\/GPX\/1\/1"/.test(gx), '8. GPX 1.1');
  const trk = [...gx.slice(gx.indexOf('<trk>')).matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)"/g)].map((m) => [+m[1], +m[2]]);
  ok(trk.length === sok.waypoints.length && trk.every(([la, lo], i) => Math.abs(la - sok.waypoints[i].lat) < 5e-8 && Math.abs(lo - sok.waypoints[i].lon) < 5e-8), '8/10. sporet har alle punktene i riktig rekkefølge, lat/lon riktig vei');
  ok(/<rte>[\s\S]*<name>Start<\/name>[\s\S]*<name>Mål<\/name>[\s\S]*<\/rte>/.test(gx), '8. rute (rte) fra Start til Mål for GPS-navigasjon');
  ok(/<name>Start: Finse<\/name>/.test(gx) && /<name>Mål: Rjukan<\/name>/.test(gx), '8. START/MÅL-punkter med navn');
  await p.locator('#route-builder button', { hasText: 'Ferdig' }).click(); await p.waitForTimeout(300);

  // ---------- 3. koordinater for hånd ----------
  await p.locator('#ov-route button', { hasText: 'Ny rute' }).click(); await p.waitForTimeout(300);
  await p.fill('.pk-c', '95, 7'); await p.press('.pk-c', 'Enter'); await p.waitForTimeout(200);
  ok(/Bredde \(lat\) må være mellom/.test(await rb(p).innerText()), '3. ugyldige koordinater gir forståelig feilmelding');
  ok(await p.locator('.leaflet-marker-pane .dpin.dp-start').count() === 0, '3. … og settes ikke');
  await p.fill('.pk-c', '60.5, 7.9'); await p.press('.pk-c', 'Enter'); await p.waitForTimeout(300);
  await p.fill('.pk-c', `59°53'N 8°35'E`); await p.press('.pk-c', 'Enter'); await p.waitForTimeout(300);
  await p.locator('.rbs', { hasText: 'Lagre' }).click(); await p.waitForTimeout(200);
  await p.fill('#rb-name', ''); await p.waitForTimeout(150);
  ok(await p.locator('#rb-save').isDisabled() && /Gi ruten et navn/.test(await rb(p).innerText()), '5. tomt navn: lagring sperret med forklaring');
  await p.fill('#rb-name', 'Koordinatrute'); await p.click('#rb-save'); await p.waitForTimeout(600);
  st = await state(p);
  const koord = st.routes.find((r) => r.name === 'Koordinatrute');
  ok(koord && koord.waypoints[0].lat === 60.5 && koord.waypoints[0].lon === 7.9 && Math.abs(koord.waypoints[1].lat - (59 + 53 / 60)) < 1e-9 && Math.abs(koord.waypoints[1].lon - (8 + 35 / 60)) < 1e-9, '3. koordinater (desimal og grader/minutter) lagres riktig');
  await p.locator('#route-builder button', { hasText: 'Ferdig' }).click(); await p.waitForTimeout(300);

  // ---------- manglende mål: kan ikke lagres ----------
  await p.locator('#ov-route button', { hasText: 'Ny rute' }).click(); await p.waitForTimeout(300);
  await clickMap(p, 0.5, 0.5);
  await p.locator('.rbs', { hasText: 'Lagre' }).click(); await p.waitForTimeout(200);
  ok(await p.locator('#rb-save').isDisabled() && /Mangler mål/.test(await p.locator('.rb-errs').innerText()), '5. mangler mål: lagring sperret, forklaring + lenke til steg 2');
  await p.locator('.rb-errs button', { hasText: 'Gå til steg 2' }).click(); await p.waitForTimeout(200);
  ok(/Hvor er målet/.test(await rb(p).innerText()), '5. «Gå til steg 2» åpner målsteget');
  p.once('dialog', (d) => d.accept());
  await p.locator('button[aria-label="Lukk veiviseren"]').click(); await p.waitForTimeout(300);
  st = await state(p);
  ok(st.routes.length === before.routes.length + 3, '5. avbrutt utkast lagres ikke');

  // ---------- 6. lagre og gjenåpne ----------
  await p.reload(); await p.waitForTimeout(3500);
  st = await state(p);
  const sok2 = st.routes.find((r) => r.name === 'Søkerute');
  ok(sok2 && JSON.stringify(sok2.waypoints.map((w) => [w.lat, w.lon])) === JSON.stringify(sok.waypoints.map((w) => [w.lat, w.lon])), '6. etter omlasting: samme punkter i samme rekkefølge');
  ok(st.activeRouteId === koord.id, '6. sist lagrede rute er fortsatt aktiv');

  // ---------- 7. redigere en lagret rute ----------
  await p.evaluate(() => { location.hash = 'oversikt'; }); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelectorAll('details.ov-adv').forEach((d) => { d.open = true; }));
  await p.locator('.route-row button', { hasText: 'Søkerute' }).click(); await p.waitForTimeout(400);
  await p.locator('#ov-route button', { hasText: 'Rediger start, mål' }).click(); await p.waitForTimeout(400);
  ok(/Rediger rute/.test(await rb(p).innerText()) && /Se over og lagre/.test(await rb(p).innerText()), '7. redigering åpner ruten i veiviseren');
  await p.locator('.rbs', { hasText: 'Mål' }).click(); await p.waitForTimeout(200);
  ok((await coordsOf(p, '.ptcard.finish'))[0] === 59.8783, '7. målet er lastet fra ruten');
  await p.fill('.pk-c', '59.9, 8.6'); await p.press('.pk-c', 'Enter'); await p.waitForTimeout(300);
  await p.locator('.rbs', { hasText: 'Lagre' }).click(); await p.fill('#rb-name', 'Søkerute endret'); await p.click('#rb-save'); await p.waitForTimeout(600);
  st = await state(p);
  const ed = st.routes.find((r) => r.id === sok.id);
  ok(ed.name === 'Søkerute endret' && ed.waypoints[ed.waypoints.length - 1].lat === 59.9 && ed.waypoints.length === 5, '7. nytt mål og navn lagret på samme rute (id uendret)');
  ok(ed.waypoints[0].id === sok.waypoints[0].id && ed.waypoints[0].name === 'Finse' && ed.waypoints[2].id === sok.waypoints[2].id, '7. uendrede punkter beholder id og navn');
  ok(st.routes.length === before.routes.length + 3, '7. redigering lager ikke ny rute');
  await p.locator('#route-builder button', { hasText: 'Ferdig' }).click(); await p.waitForTimeout(300);

  // ---------- 9/10. importer den eksporterte GPX-filen ----------
  await p.evaluate(() => document.querySelectorAll('details.ov-adv').forEach((d) => { d.open = true; }));
  const nMarkers = (st.markers || []).length;
  await p.setInputFiles('input[type=file][accept=".gpx,application/gpx+xml"]', gpxPath); await p.waitForTimeout(1500);
  st = await state(p);
  const imp = st.routes.filter((r) => r.name === 'Søkerute');
  ok(imp.length === 1, `9. import gir én rute (ikke dobbel fra spor + rute): ${imp.length}`);
  const ir = imp[0];
  ok(ir && ir.waypoints.length === sok.waypoints.length && ir.waypoints.every((w, i) => Math.abs(w.lat - sok.waypoints[i].lat) < 5e-8 && Math.abs(w.lon - sok.waypoints[i].lon) < 5e-8), '9/10. importert geometri = eksportert (alle koordinater, samme rekkefølge)');
  ok(ir.waypoints[0].name === 'Finse' && ir.waypoints[ir.waypoints.length - 1].name === 'Rjukan', '9. start- og målnavn bevart gjennom GPX');
  ok((st.markers || []).length === nMarkers, `9. START/MÅL-punktene blir ikke ekstra markører (${(st.markers || []).length - nMarkers} nye)`);

  // ---------- 10. følge eksisterende rute gir terrengtilpasset linje ----------
  const gpxRoute = st.routes.find((r) => r.id === 'gpx-original') || st.routes.find((r) => r.waypoints.length > 50);
  await p.locator('#ov-route button', { hasText: 'Ny rute' }).click(); await p.waitForTimeout(300);
  await p.fill('.pk-c', `${gpxRoute.waypoints[2].lat}, ${gpxRoute.waypoints[2].lon}`); await p.press('.pk-c', 'Enter');
  const L = gpxRoute.waypoints.length;
  await p.fill('.pk-c', `${gpxRoute.waypoints[L - 3].lat}, ${gpxRoute.waypoints[L - 3].lon}`); await p.press('.pk-c', 'Enter'); await p.waitForTimeout(300);
  await p.click('#rb-next'); await p.waitForTimeout(300);
  await p.locator('.rb-opt', { hasText: 'Følg linjen' }).locator('input').check();
  await p.locator('select[aria-label="Rute å følge"]').selectOption(gpxRoute.id); await p.waitForTimeout(400);
  ok(/punkter hentet fra/.test(await rb(p).innerText()), '10. «følg rute» henter punktene fra den valgte ruten');
  await p.click('#rb-next'); await p.fill('#rb-name', 'Fulgt rute'); await p.click('#rb-save'); await p.waitForTimeout(600);
  st = await state(p);
  const fr = st.routes.find((r) => r.name === 'Fulgt rute');
  ok(fr.waypoints.length >= L - 4 && fr.waypoints.length <= L, `10. lagret linje følger GPX-geometrien (${fr.waypoints.length} av ${L} punkter)`);
  const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('#rb-gpx')]);
  const g2 = fs.readFileSync(await dl2.path(), 'utf8');
  ok(([...g2.matchAll(/<trkpt /g)].length === fr.waypoints.length), '10. GPX-sporet inneholder hele den fulgte linjen, ikke bare rette linjer');
  await p.locator('#route-builder button', { hasText: 'Ferdig' }).click(); await p.waitForTimeout(300);

  // ---------- beskyttelse av START/MÅL på hovedkartet ----------
  const startPin = p.locator('.leaflet-marker-pane .endpin.ep-start').first();
  ok(await startPin.count() === 1 && await p.locator('.leaflet-marker-pane .endpin.ep-finish').count() === 1, 'START og MÅL vises tydelig på den aktive ruten');
  const sb = await startPin.boundingBox();
  const st0 = (await state(p)).routes.find((r) => r.id === fr.id).waypoints[0];
  p.once('dialog', (d) => d.dismiss());
  await p.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await p.mouse.down(); await p.mouse.move(sb.x + 80, sb.y + 60, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(500);
  const st1 = (await state(p)).routes.find((r) => r.id === fr.id).waypoints[0];
  ok(st0.lat === st1.lat && st0.lon === st1.lon, 'dra START ved et uhell + «Avbryt» → starten flyttes ikke');

  // ---------- eksport av ugyldig rute forklares ----------
  await p.evaluate(() => document.querySelectorAll('details.ov-adv').forEach((d) => { d.open = true; }));
  ok(errs.length === 0, `ingen JS-feil (${errs.slice(0, 2).join(' | ')})`);

  // ---------- mobil ----------
  const m = await b.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  const mp = await m.newPage(); const merr = []; mp.on('pageerror', (e) => merr.push(e.message));
  await stubs(mp);
  await mp.goto(URL0 + '#oversikt'); await mp.waitForTimeout(3500);
  await mp.locator('button', { hasText: 'Vis oversikt' }).click().catch(() => {});
  await mp.locator('#ov-route button', { hasText: 'Ny rute' }).click(); await mp.waitForTimeout(400);
  ok(!(await mp.locator('.side.open').count()), 'mobil: sidepanelet lukkes så kartet er synlig');
  await mp.locator('.leaflet-container').scrollIntoViewIfNeeded();
  const rbb = await mp.locator('#route-builder').boundingBox(), mbb = await mp.locator('.leaflet-container').boundingBox();
  ok(rbb && mbb && rbb.width <= 390 && await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, 'mobil: veiviseren passer i skjermen uten sidescroll');
  await mp.locator('button[aria-label="Minimer"]').click(); await mp.waitForTimeout(200);
  const mb2 = await mp.locator('.leaflet-container').boundingBox();
  await mp.mouse.click(mb2.x + mb2.width * 0.5, mb2.y + mb2.height * 0.35); await mp.waitForTimeout(300);
  ok(await mp.locator('.leaflet-marker-pane .dpin.dp-start').count() === 1, 'mobil: minimer veiviseren og trykk i kartet setter start');
  ok(merr.length === 0, `mobil: ingen JS-feil (${merr.slice(0, 2).join(' | ')})`);
  await b.close();
  console.log(fails ? `${fails} FEIL` : 'ALLE RUTE-E2E OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('KRASJ', e.message); process.exit(1); });
