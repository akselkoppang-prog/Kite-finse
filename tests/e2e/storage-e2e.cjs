// Ende-til-ende lagringstest i ekte Chromium (IndexedDB), med vedvarende profil for «lukk og åpne nettleseren».
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
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
  if (s) await p.locator('nav.subnav button', { hasText: s }).first().click();
  if (m === 'Kart og rute') { await p.waitForTimeout(200); await openAdv(p); }
}
const profile = path.join(dir, 'profile-a');
const profileB = path.join(dir, 'profile-b');
fs.rmSync(profile, { recursive: true, force: true });
fs.rmSync(profileB, { recursive: true, force: true });

async function stubs(p) {
  await p.route('**/stedsnavn/v1/navn**', (r) => { const q = new URL(r.request().url()).searchParams.get('sok'); const h = [...q].reduce((a, c) => a + c.charCodeAt(0), 0); r.fulfill({ json: { navn: [{ skrivemåte: q, navneobjekttype: 'Turisthytte', representasjonspunkt: { øst: 7.5 + (h % 100) / 100, nord: 59.9 + (h % 70) / 100 }, kommuner: [{ kommunenavn: 'Test' }] }] } }); });
  await p.route('**/hoydedata/v1/punkt**', (r) => { const u = new URL(r.request().url()); const pts = JSON.parse(u.searchParams.get('punkter') || '[]'); r.fulfill({ json: { punkter: pts.map(([x, y]) => ({ x, y, z: 1100 + Math.sin(x * 40) * 80, terreng: 'T', datakilde: 'stub' })) } }); });
  await p.route('**/Vannkraft1/MapServer/layers**', (r) => r.fulfill({ json: { layers: [{ id: 6, name: 'Magasin', geometryType: 'esriGeometryPolygon' }] } }));
  await p.route('**/Vannkraft1/MapServer/6/query**', (r) => r.fulfill({ json: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { magasinNavn: 'Testmagasin', magasinNr: 77 }, geometry: { type: 'Polygon', coordinates: [[[8.1, 60.12], [8.25, 60.12], [8.25, 60.2], [8.1, 60.2], [8.1, 60.12]]] } }] } }));
  await p.route('**/Innsjodatabase2/MapServer/layers**', (r) => r.fulfill({ json: { layers: [{ id: 5, name: 'Innsjø', geometryType: 'esriGeometryPolygon' }] } }));
  await p.route('**/Innsjodatabase2/MapServer/5/query**', (r) => r.fulfill({ json: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { navn: 'Testtjern', vatnLnr: 1 }, geometry: { type: 'Polygon', coordinates: [[[7.55, 60.53], [7.6, 60.53], [7.6, 60.56], [7.55, 60.56], [7.55, 60.53]]] } }] } }));
}

// Leser IndexedDB direkte (uavhengig av appens minne)
const dump = (p) => p.evaluate(() => new Promise((res, rej) => {
  const r = indexedDB.open('kite-finse-rjukan');
  r.onerror = () => rej(r.error);
  r.onsuccess = () => {
    const db = r.result;
    const names = ['slices', 'routes', 'blobs', 'backups', 'meta', 'projects'];
    const tx = db.transaction(names, 'readonly');
    const out = {};
    let n = 0;
    names.forEach((s) => {
      const q = tx.objectStore(s).getAll();
      q.onsuccess = () => {
        out[s] = q.result.map((x) => (s === 'blobs' ? { id: x.id, role: x.role, size: x.size, projectId: x.projectId, mime: x.mime } : s === 'backups' ? { id: x.id, reason: x.reason, size: x.size, auto: x.auto } : x));
        if (++n === names.length) { db.close(); res(out); }
      };
    });
  };
}));
const proj = (d) => {
  const pid = (d.meta.find((m) => m.key === 'activeProject') || {}).value || 'default';
  const sl = {};
  d.slices.filter((s) => s.projectId === pid).forEach((s) => (sl[s.slice] = s.value));
  const routes = d.routes.filter((r) => r.projectId === pid).map((r) => r.value);
  const flat = Object.assign({}, ...Object.entries(sl).filter(([k]) => k !== 'routeOrder').map(([, v]) => v));
  return { pid, ...flat, routes, blobs: d.blobs.filter((b) => b.projectId === pid), backups: d.backups, migration: (d.meta.find((m) => m.key === 'migration') || {}).value, projects: d.projects };
};
const saveState = (p) => p.locator('.saveind').innerText();
const waitSaved = async (p, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (/LAGRET/.test(await saveState(p)) && !/ULAGREDE/.test(await saveState(p))) return true; await p.waitForTimeout(150); } return false; };

async function bigJpeg(p, seed) {
  const b64 = await p.evaluate((seed) => {
    const c = document.createElement('canvas'); c.width = 4000; c.height = 3000;
    const g = c.getContext('2d');
    for (let i = 0; i < 400; i++) { g.fillStyle = `hsl(${(i * 37 + seed * 91) % 360},70%,${30 + (i % 40)}%)`; g.fillRect((i * 97) % 4000, (i * 53) % 3000, 300, 200); }
    const id = g.getImageData(0, 0, 4000, 300); for (let i = 0; i < id.data.length; i += 4) id.data[i] = (i * seed) % 255; g.putImageData(id, 0, 0);
    return c.toDataURL('image/jpeg', 0.95).split(',')[1];
  }, seed);
  return Buffer.from(b64, 'base64');
}

(async () => {
  let ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true }); await ctx.addInitScript(DETAILED);
  let p = ctx.pages()[0] || (await ctx.newPage());
  const errs = [];
  const watch = (pg) => { pg.on('pageerror', (e) => errs.push('PAGEERR ' + e.message)); pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::|QuotaExceeded|Testfeil/.test(m.text())) errs.push(m.text()); }); };
  watch(p);
  await stubs(p);

  // ---- 17 + 1: migrering fra gammel localStorage-plan (stor, med base64-bilde) ----
  await p.goto(URL0 + 'sw.js'); await openAdv(p);
  const legacyInfo = await p.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 900; const g = c.getContext('2d'); g.fillStyle = '#3b82f6'; g.fillRect(0, 0, 1200, 900); g.fillStyle = '#fff'; g.fillRect(100, 100, 400, 300);
    const img = c.toDataURL('image/jpeg', 0.9);
    const ring = []; for (let i = 0; i < 9000; i++) ring.push([7.5 + Math.cos(i / 1432) * 0.3 + i * 1e-9, 60.2 + Math.sin(i / 1432) * 0.2]);
    const poly = (n) => ({ type: 'Feature', properties: { navn: `Magasin ${n}` }, geometry: { type: 'Polygon', coordinates: [ring] } });
    const lakes = {}; for (let v = 0; v < 6; v++) lakes[`old-route:${v}`] = { lakes: [poly(v), poly(v + 10)], fetchedAt: '2026-11-03', layer: 'Innsjø' };
    const wps = Array.from({ length: 127 }, (_, i) => ({ id: `w${i}`, lat: 60.6 - i * 0.005, lon: 7.5 + i * 0.008, kind: 'via', source: 'GPX', dataKind: 'forslag', ...(i === 0 ? { name: 'Start (GPX)', description: 'Gammel beskrivelse', attachments: [{ id: 'a1', name: 'gammelt.jpg', href: img, kind: 'bilde', addedAt: '2026-11-03' }] } : {}) }));
    const state = {
      routes: [{ id: 'gpx-original', name: 'Din GPX: Finse–Rjukan', kind: 'gpx', color: '#ef4444', description: 'x', waypoints: wps, visible: true, createdAt: '', updatedAt: '' }],
      activeRouteId: 'gpx-original', tripDate: '2027-03-21', tripDays: 3, camps: [{ id: 'cold', lat: 60.3, lon: 7.7, name: 'Gammel leir', night: 1, source: 'manuell', notes: 'gammel note' }],
      markers: [], lakeOverrides: [{ id: 'oold', barrierKey: 'lake_9', name: 'Gammelt tjern', originalKind: 'innsjø', originalLabel: 'IKKE VERIFISERT', centroid: { lat: 60, lon: 8 }, scope: 'permanent', reviewRequired: false, note: 'gammel', createdAt: '2026-11-01', active: true }],
      quivers: [{ id: 'q-forslag', name: 'Gammel quiver', kiteIds: ['sonic10', 'soul15'], primary: 'sonic10' }], activeQuiverId: 'q-forslag',
      hydro: { reservoirs: [poly(1), poly(2)], dams: [], layers: [], fetchedAt: '2026-11-03' }, lakes, terrain: {}, history: [],
    };
    const raw = JSON.stringify({ state, version: 0 });
    localStorage.setItem('kite.plan.v1', raw);
    localStorage.setItem('kite.elevCache.v1', JSON.stringify({ '60.00000,7.00000': { lat: 60, lon: 7, z: 1200 } }));
    return { bytes: raw.length * 2 };
  });
  console.log(`(gammel plan i localStorage: ${(legacyInfo.bytes / 1048576).toFixed(1)} MB)`);
  await p.goto(URL0 + '#oversikt', { waitUntil: 'domcontentloaded' }); await openAdv(p);
  await p.waitForSelector('.saveind', { timeout: 20000 });
  await p.waitForTimeout(1500);
  let d = proj(await dump(p));
  ok(d.migration?.status === 'verified', `migrering verifisert (${d.migration?.status})`);
  ok(d.routes.length === 1 && d.routes[0].waypoints.length === 127 && d.camps?.[0]?.notes === 'gammel note' && d.lakeOverrides?.[0]?.note === 'gammel' && d.tripDate === '2027-03-21' && d.quivers?.[0]?.name === 'Gammel quiver', 'migrering: ruter, leir, overstyring, dato og quiver flyttet');
  ok(d.routes[0].waypoints[0].attachments[0].blobId && !d.routes[0].waypoints[0].attachments[0].href, 'migrering: base64-bilde gjort om til Blob-referanse');
  ok(d.blobs.filter((b) => b.role === 'main').length === 1 && d.blobs.find((b) => b.role === 'thumb'), 'migrering: bilde + miniatyr i blobs-lageret');
  ok(d.backups.some((b) => /Original localStorage/.test(b.reason)), 'migrering: beskyttet kopi av originalen');
  ok(await p.evaluate(() => !!localStorage.getItem('kite.plan.v1')), 'migrering: gammel localStorage-kopi IKKE slettet');
  ok(await p.evaluate(() => !localStorage.getItem('kite.elevCache.v1')), 'høydecache flyttet ut av localStorage');
  ok(d.migration.bySize[0].key === 'lakes' || d.migration.bySize[0].key === 'hydro', `rotårsak rapporteres: største felt = ${d.migration.bySize[0].key}`);
  ok(/LAGRET/.test(await saveState(p)), `lagringsstatus i toppfeltet: ${await saveState(p)}`);

  // ---- 1-2: ny ekspedisjon + GPX ----
  await go(p, 'Innstillinger / Lagring'); await p.waitForTimeout(800);
  ok(/VERIFISERT/.test(await p.locator('.page .card', { hasText: 'Flytting fra gammel lagring' }).innerText()), 'lagringssiden viser verifisert migrering og rotårsak');
  // v6: nye prosjekter lages under Oversikt → Prosjekt
  await go(p, 'Prosjekt'); await p.waitForTimeout(600);
  await p.click('button:has-text("+ Nytt prosjekt")'); await p.fill('#new-proj-name', 'Ny ekspedisjon test');
  await p.locator('.newproj button', { hasText: 'Finse–Rjukan-ruten' }).click(); await p.click('#new-proj-ok'); await p.waitForTimeout(2500);
  d = proj(await dump(p));
  ok(d.projects.length === 2 && d.pid !== 'default' && d.routes.length === 1 && d.routes[0].kind === 'gpx', 'ny ekspedisjon opprettet med GPX importert');
  await go(p, 'Kart & rute'); await p.waitForTimeout(600);
  await p.setInputFiles('input[type=file][accept*=".gpx"]', path.join('/home/user/Kite-finse/public/data/Finse_Rjukan_kite_27.gpx')); await p.waitForTimeout(800);
  ok(await waitSaved(p), 'GPX-import lagret');
  d = proj(await dump(p));
  ok(d.routes.length === 2 && d.backups.some((b) => /GPX-import/.test(b.reason)), 'GPX-import: ny rute + sikkerhetskopi før import');

  // ---- 3: 100 rutepunkter ----
  await p.click('button:has-text("+ Forleng (nytt mål)")');
  const mb = await p.locator('.map').boundingBox();
  for (let i = 0; i < 100; i++) await p.mouse.click(mb.x + 80 + (i % 20) * 30, mb.y + 120 + Math.floor(i / 20) * 40);
  await p.click('button:has-text("Panorer")');
  ok(await waitSaved(p), 'lagret etter 100 klikk');
  d = proj(await dump(p));
  const active = d.routes.find((r) => r.id === d.activeRouteId);
  ok(active.waypoints.length >= 227, `100 rutepunkter lagt til og lagret (${active.waypoints.length})`);

  // ---- 4: teltplass med beskrivelse ----
  await p.click('button:has-text("⛺ Teltplass")');
  await p.mouse.click(mb.x + 400, mb.y + 500);
  await p.click('button:has-text("Panorer")');
  await p.locator('.camp').last().locator('xpath=..').dispatchEvent('click'); await p.waitForTimeout(300);
  await p.fill('#camp-notes', 'Le bak morene, god snø til smelting');
  await p.selectOption('#camp-role', 'foretrukket');

  // ---- 6: store bilder (4000×3000) ----
  const big1 = await bigJpeg(p, 1), big2 = await bigJpeg(p, 2);
  await p.setInputFiles('#camp-img', { name: 'stort1.jpg', mimeType: 'image/jpeg', buffer: big1 }); await p.waitForTimeout(1500);
  await p.setInputFiles('#camp-img', { name: 'stort2.jpg', mimeType: 'image/jpeg', buffer: big2 }); await p.waitForTimeout(1500);
  await p.setInputFiles('#camp-img', { name: 'kopi-av-stort1.jpg', mimeType: 'image/jpeg', buffer: big1 }); await p.waitForTimeout(1500);
  ok(await waitSaved(p), 'lagret etter bildeopplasting');
  d = proj(await dump(p));
  const camp = d.camps.find((c) => /Le bak morene/.test(c.notes || ''));
  const mains = d.blobs.filter((b) => b.role === 'main');
  ok(camp && camp.attachments.length === 3 && camp.role === 'foretrukket', 'teltplass med notat, rolle og 3 bildereferanser lagret');
  ok(mains.length === 2, `duplikat lagret én gang (${mains.length} filer for 3 opplastinger)`);
  ok(mains.every((b) => b.size < 900000), `bilder komprimert: ${mains.map((b) => `${(b.size / 1024).toFixed(0)} kB`).join(', ')} (original ${(big1.length / 1024).toFixed(0)} kB)`);
  ok(await p.locator('.drawer .att img').count() === 3, 'bildene vises fra Blob');
  await p.click('.drawer button[aria-label="Lukk"]');

  // ---- 5: flere vann-overstyringer ----
  for (const t of ['2. Last', '3. Finn']) { await p.click(`button:has-text("${t}")`); await p.waitForTimeout(1500); }
  const crossBtns = p.locator('.cross button:has-text("Godkjenn / detaljer")');
  const nCross = await crossBtns.count();
  for (let i = 0; i < nCross; i++) {
    await p.locator('.cross button:has-text("Godkjenn / detaljer")').nth(i).click(); await p.waitForTimeout(300);
    const ap = p.locator('.drawer button:has-text("GODKJENN FOR MIN RUTE")');
    if (await ap.count()) { await ap.first().click(); await p.waitForTimeout(300); }
    await p.click('.drawer button[aria-label="Lukk"]');
  }
  ok(await waitSaved(p), 'overstyringer lagret');
  d = proj(await dump(p));
  ok(d.lakeOverrides.length >= 2, `${d.lakeOverrides.length} vann-overstyringer lagret`);

  // ---- 7-9: kite, dato, simulering ----
  await go(p, 'Kite-quiver'); await p.waitForTimeout(400);
  await p.check('#kp-stoke9');
  await go(p, 'Kalender'); await p.waitForTimeout(400);
  await p.click('.cal-d[aria-label="2027-03-27"]');
  await go(p, 'YTELSESSIMULATOR'); await p.waitForTimeout(1200);
  for (const dir of ['SØ', 'NV', 'SV']) { await p.click(`.page .card button:has-text("${dir}")`); await p.waitForTimeout(700); }
  ok(await waitSaved(p), 'lagret etter kite/dato/simulering');
  d = proj(await dump(p));
  ok(d.tripDate === '2027-03-27' && d.quivers.find((q) => q.id === d.activeQuiverId).kiteIds.includes('stoke9') && d.sim.manual.dir === 225, 'kite, dato og simuleringsvalg lagret');
  const snapshotBefore = JSON.stringify({ n: active.waypoints.length, camps: d.camps.length, ov: d.lakeOverrides.length, date: d.tripDate });

  // ---- 10: lukk og åpne nettleseren ----
  await ctx.close();
  ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true }); await ctx.addInitScript(DETAILED);
  p = ctx.pages()[0] || (await ctx.newPage()); watch(p); await stubs(p);
  await p.goto(URL0, { waitUntil: 'domcontentloaded' }); await openAdv(p); await p.waitForSelector('.saveind', { timeout: 20000 }); await p.waitForTimeout(1200);
  d = proj(await dump(p));
  const act2 = d.routes.find((r) => r.id === d.activeRouteId);
  ok(JSON.stringify({ n: act2.waypoints.length, camps: d.camps.length, ov: d.lakeOverrides.length, date: d.tripDate }) === snapshotBefore, 'alt bevart etter at nettleseren ble lukket og åpnet');
  ok(/27\. mar/.test(await p.locator('.hsum').innerText()), 'appen viser lagret dato etter omstart');
  ok(/Simulator/.test(await p.locator('nav.subnav button.on').innerText()), 'siste åpne fane huskes');
  await go(p, 'Kart & rute'); await p.waitForTimeout(500);
  await p.locator('.camp').last().locator('xpath=..').dispatchEvent('click'); await p.waitForTimeout(800);
  ok(await p.locator('.drawer .att img[src^="blob:"]').count() === 3, 'bildene lastes fra IndexedDB etter omstart');
  await p.click('.drawer button[aria-label="Lukk"]');

  // ---- 11: last inn på nytt ----
  await p.reload(); await openAdv(p); await p.waitForSelector('.saveind'); await p.waitForTimeout(1000);
  ok(/27\. mar/.test(await p.locator('.hsum').innerText()), 'data bevart etter omlasting');

  // ---- 16: avbrutt lagring (endring rett før omlasting) ----
  await go(p, 'Kalender'); await p.waitForTimeout(300);
  await p.click('.cal-d[aria-label="2027-03-29"]');
  await p.reload(); await openAdv(p); await p.waitForSelector('.saveind'); await p.waitForTimeout(1000);
  d = proj(await dump(p));
  ok(d.tripDate === '2027-03-29', `endring rett før omlasting ble lagret (pagehide-lagring): ${d.tripDate}`);

  // ---- 15: kvotefeil ----
  await p.evaluate(() => {
    const orig = IDBObjectStore.prototype.put;
    window.__origPut = orig;
    IDBObjectStore.prototype.put = function (...a) { if (this.name === 'slices') throw new DOMException('Testfeil: kvote', 'QuotaExceededError'); return orig.apply(this, a); };
  });
  await go(p, 'Kalender'); await p.waitForTimeout(200);
  await p.click('.cal-d[aria-label="2027-03-30"]'); await p.waitForTimeout(1500);
  ok(/FEILET/.test(await saveState(p)), `kvotefeil vises: ${await saveState(p)}`);
  ok(await p.locator('.banner.err').count() > 0, 'tydelig advarsel ved lagringsfeil');
  ok(/30\. mar/.test(await p.locator('.hsum').innerText()), 'endringen beholdes i minnet');
  ok(await p.evaluate(() => /2027-03-30/.test(localStorage.getItem('kite.emergency') || '')), 'nødkopi skrevet');
  d = proj(await dump(p));
  ok(d.tripDate === '2027-03-29', 'databasen har siste vellykkede versjon (ingenting halvveis skrevet)');
  await p.evaluate(() => { IDBObjectStore.prototype.put = window.__origPut; });
  await p.click('.banner button:has-text("Prøv igjen nå")');
  ok(await waitSaved(p), 'lagring lykkes etter at feilen er borte');
  d = proj(await dump(p));
  ok(d.tripDate === '2027-03-30' && await p.evaluate(() => !localStorage.getItem('kite.emergency')), 'endringen er lagret og nødkopien ryddet');

  // ---- 15b: nødkopi gjenopprettes etter lukking under feil ----
  await p.evaluate(() => { IDBObjectStore.prototype.put = function (...a) { if (this.name === 'slices') throw new DOMException('Testfeil', 'QuotaExceededError'); return window.__origPut.apply(this, a); }; });
  await p.fill('#trip-date', '2027-04-03'); await p.waitForTimeout(1200);
  await p.evaluate(() => { IDBObjectStore.prototype.put = window.__origPut; window.onbeforeunload = null; });
  await p.goto('about:blank'); await p.goto(URL0); await openAdv(p); await p.waitForSelector('.saveind'); await p.waitForTimeout(1000);
  const rec = await p.locator('.banner', { hasText: 'Fant ulagrede endringer' }).count();
  if (rec) { await p.click('button:has-text("Gjenopprett endringene")'); await waitSaved(p); }
  d = proj(await dump(p));
  ok(d.tripDate === '2027-04-03', `ulagret endring gjenopprettet fra nødkopi etter omstart (${rec ? 'via banner' : 'lagret ved pagehide'})`);

  // ---- 12: gjenopprett tidligere kopi ----
  await go(p, 'Innstillinger / Lagring'); await p.waitForTimeout(600);
  await p.click('button:has-text("Ta sikkerhetskopi nå")'); await p.waitForTimeout(600);
  await go(p, 'Kalender'); await p.waitForTimeout(200);
  await p.fill('#trip-date', '2027-04-10'); await waitSaved(p);
  await go(p, 'Innstillinger / Lagring'); await p.waitForTimeout(600);
  await p.locator('tr', { hasText: 'Manuell sikkerhetskopi' }).first().locator('button:has-text("Gjenopprett")').click();
  await p.click('.modal button:has-text("Ja, fortsett")'); await p.waitForTimeout(1200); await waitSaved(p);
  d = proj(await dump(p));
  ok(d.tripDate === '2027-04-03' && d.backups.some((b) => b.reason === 'Før gjenoppretting'), 'gjenoppretting av tidligere versjon (og forrige tilstand tatt vare på)');

  // ---- 13: eksport ZIP ----
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("Last ned komplett ZIP")')]);
  const zipPath = path.join(dir, 'prosjekt.zip'); await dl.saveAs(zipPath);
  const zsize = fs.statSync(zipPath).size;
  ok(zsize > 50000, `ZIP eksportert (${(zsize / 1024).toFixed(0)} kB)`);
  const listing = require('child_process').execSync(`python3 -c "import zipfile,sys;print('\\n'.join(zipfile.ZipFile('${zipPath}').namelist()))"`).toString();
  ok(/project\.json/.test(listing) && /metadata\.json/.test(listing) && /routes\/.+\.gpx/.test(listing) && /images\/img_/.test(listing) && /images\/thumbs\//.test(listing) && /attachments\//.test(listing), 'ZIP inneholder project.json, metadata.json, routes/, images/, attachments/');
  const finalState = proj(await dump(p));
  const act3 = finalState.routes.find((r) => r.id === finalState.activeRouteId);

  // ---- 14: importer i ren nettleserprofil ----
  const ctxB = await chromium.launchPersistentContext(profileB, { viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' }); await ctxB.addInitScript(DETAILED);
  const pb = ctxB.pages()[0] || (await ctxB.newPage()); watch(pb); await stubs(pb);
  await pb.goto(URL0); await openAdv(pb); await pb.waitForSelector('.saveind'); await pb.waitForTimeout(800);
  await go(pb, 'Innstillinger / Lagring'); await pb.waitForTimeout(400);
  await pb.setInputFiles('input[type=file][accept*=".zip"]', zipPath); await pb.waitForTimeout(3000);
  const db2 = proj(await dump(pb));
  const actB = db2.routes.find((r) => r.id === db2.activeRouteId);
  ok(actB && actB.waypoints.length === act3.waypoints.length && db2.camps.length === finalState.camps.length && db2.lakeOverrides.length === finalState.lakeOverrides.length && db2.tripDate === finalState.tripDate, `import i ren profil: ${actB?.waypoints.length} punkter, ${db2.camps.length} leirer, ${db2.lakeOverrides.length} overstyringer, dato ${db2.tripDate}`);
  ok(db2.blobs.filter((b) => b.role === 'main').length === 2, 'bilder fulgte med i importen');
  ok(JSON.stringify(actB.waypoints.map((w) => [w.lat, w.lon])) === JSON.stringify(act3.waypoints.map((w) => [w.lat, w.lon])), 'koordinater identiske etter eksport/import');
  await go(pb, 'Kart & rute'); await pb.waitForTimeout(500);
  await pb.locator('.camp').last().locator('xpath=..').dispatchEvent('click'); await pb.waitForTimeout(800);
  ok(await pb.locator('.drawer .att img[src^="blob:"]').count() >= 2, 'importerte bilder vises');
  await pb.screenshot({ path: path.join(dir, 'v4-import.png') });
  await ctxB.close();

  // ---- 17b: avbrutt migrering kjøres trygt på nytt ----
  fs.rmSync(path.join(dir, 'profile-c'), { recursive: true, force: true });
  const ctxC = await chromium.launchPersistentContext(path.join(dir, 'profile-c'), { serviceWorkers: 'block' }); await ctxC.addInitScript(DETAILED);
  const pc = ctxC.pages()[0] || (await ctxC.newPage()); await stubs(pc);
  await pc.goto(URL0 + 'sw.js'); await openAdv(pc);
  await pc.evaluate(() => localStorage.setItem('kite.plan.v1', JSON.stringify({ state: { routes: [{ id: 'r', name: 'R', kind: 'egen', color: '#f00', description: '', visible: true, createdAt: '', updatedAt: '', waypoints: [{ id: 'a', lat: 60, lon: 7.5, kind: 'via', source: 't', dataKind: 'forslag' }, { id: 'b', lat: 60.1, lon: 7.6, kind: 'via', source: 't', dataKind: 'forslag' }] }], activeRouteId: 'r', tripDate: '2027-04-15' } })));
  await pc.addInitScript(() => { if (!sessionStorage.getItem('broke')) { sessionStorage.setItem('broke', '1'); const o = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...a) { if (this.name === 'routes') throw new DOMException('Testfeil: avbrutt', 'AbortError'); return o.apply(this, a); }; } });
  await pc.goto(URL0); await openAdv(pc); await pc.waitForSelector('.saveind', { timeout: 20000 }); await pc.waitForTimeout(800);
  let dc = proj(await dump(pc));
  ok(dc.migration?.status === 'failed' && await pc.evaluate(() => !!localStorage.getItem('kite.plan.v1')), 'avbrutt migrering: status «failed», original urørt');
  await pc.reload(); await openAdv(pc); await pc.waitForSelector('.saveind'); await pc.waitForTimeout(1000);
  dc = proj(await dump(pc));
  ok(dc.migration?.status === 'verified' && dc.tripDate === '2027-04-15', 'migreringen fullføres ved neste oppstart');
  await ctxC.close();

  // ---- mobil (iPad-størrelse) ----
  await p.setViewportSize({ width: 820, height: 1180 });
  await go(p, 'Innstillinger / Lagring'); await p.waitForTimeout(600);
  const ow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(ow <= 1, `iPad-bredde: ingen horisontal scroll på lagringssiden (${ow}px)`);
  await p.screenshot({ path: path.join(dir, 'v4-storage-ipad.png'), fullPage: true });
  console.log('ERRORS:', errs.slice(0, 6));
  ok(errs.length === 0, 'ingen JS-feil');
  console.log(fail ? `${fail} FEIL` : 'ALLE LAGRINGS-E2E OK');
  await ctx.close();
})().catch((e) => { console.error('KRASJ', e); process.exit(1); });
