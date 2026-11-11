const { chromium, devices } = require('playwright');
const fs = require('fs');
const dir = process.argv[2];
const URL0 = process.env.URL0 || 'http://localhost:4174/';
let fail = 0;
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fail++; };

// v5-navigasjon: gamle fanenavn → hovedmeny + undermeny
const NAV = { 'Scenarioer': ['Dagplan', 'Scenarioer'], 'Prosjekt': ['Oversikt', 'Prosjekt'], 'Eksport': ['Eksport', 'Eksport & deling'], 'Kart & rute': ['Oversikt'], 'Overstyringer': ['Utstyr & planlegging', 'Vann-godkjenninger'], 'Kite-quiver': ['Vær & kite', 'Kitedatabase'], 'Kalender': ['Dagplan', 'Kalender og sol'], 'Dagplan': ['Dagplan', 'Avansert dagsfordeling'], 'Dagene': ['Dagplan', 'Dagene'], 'Kite og vind': ['Vær & kite', 'Kite og vind'], 'Utstyr & offline': ['Utstyr & planlegging', 'Utstyr'], 'Mat': ['Utstyr & planlegging', 'Mat og vann'], 'Vær langs ruten': ['Vær & kite', 'Vær langs ruten'], 'Overnatting': ['Dagplan', 'Overnatting'], 'Status': ['Oversikt', 'Status'], 'Oppgaver': ['Oversikt', 'Oppgaver og team'], 'Vær & vind': ['Vær & kite', 'Værmelding'], 'Sikkerhet': ['Utstyr & planlegging', 'Sikkerhet'], 'YTELSESSIMULATOR': ['Vær & kite', 'Simulator'], 'Modell & kalibrering': ['Innstillinger', 'Modell og kalibrering'], 'Datakilder & diagnose': ['Innstillinger', 'Datakilder'], 'Innstillinger / Lagring': ['Innstillinger', 'Lagring og backup'] };
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

const noise = /Failed to load resource|ERR_|net::|Download the React DevTools|\[vite\]|favicon|tunnel|TUNNEL/i;
function watch(p, bag0, tag) {
  const bag = { push: (x) => { if (!bag0.includes(x)) { bag0.push(x); console.log('FUNN', x); } } };
  p.on('pageerror', (e) => bag.push(`[${tag()}] PAGEERROR ${e.message.split('\n')[0]}`));
  p.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !noise.test(m.text())) bag.push(`[${tag()}] ${m.type().toUpperCase()} ${m.text().replace(/\s+/g, ' ').slice(0, 300)}`); });
}
async function tabs(p) {
  const out = [];
  const mains = await p.locator('nav.mainnav button').count();
  for (let i = 0; i < mains; i++) {
    await p.locator('nav.mainnav button').nth(i).click(); await p.waitForTimeout(250);
    const subs = await p.locator('nav.subnav button').count();
    if (!subs) out.push([i, -1]);
    for (let j = 0; j < subs; j++) out.push([i, j]);
  }
  return out;
}
async function open(p, [i, j]) {
  await p.locator('nav.mainnav button').nth(i).click();
  if (j >= 0) await p.locator('nav.subnav button').nth(j).click();
  await p.waitForTimeout(700);
  const m = (await p.locator('nav.mainnav button.on').innerText().catch(() => '?')).replace(/\s+/g, ' ').trim();
  const s = j >= 0 ? (await p.locator('nav.subnav button.on').innerText().catch(() => '?')).trim() : '';
  return `${m}${s ? ' › ' + s : ''}`;
}
const alive = (p) => p.evaluate(() => !!document.querySelector('nav.mainnav') && !!document.querySelector('main') && document.querySelector('main').children.length > 0 && !document.querySelector('.errorboundary')).catch(() => false);
(async () => {
  const mode = process.argv[3] || 'all';
  const b = await chromium.launch();
  const bag0 = []; const bag = { push: (x) => { if (!bag0.includes(x)) { bag0.push(x); console.log('FUNN', x); } } }; let where = 'start';
  const mk = async (dev) => { const c = await b.newContext({ ...(dev || { viewport: { width: 1366, height: 950 } }), serviceWorkers: 'block', acceptDownloads: true }); const p = await c.newPage(); watch(p, bag0, () => where); await stubs(p); await weatherStubs(p); return { c, p }; };

  // ---------- A: alle sider, standardprosjekt (desktop + mobil) ----------
  let { c, p } = await mk();
  let confirmMode = 'dismiss';
  p.on('dialog', (d) => (confirmMode === 'accept' || d.type() === 'beforeunload' ? d.accept(d.type() === 'prompt' ? 'Testnavn' : undefined) : d.dismiss()));
  await p.goto(URL0, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3500);
  const T = await tabs(p);
  console.log('faner:', T.length);
  // legg inn data så sidene har noe å vise
  where = 'oppsett';
  await go(p, 'Dagene'); await p.waitForTimeout(500);
  await p.fill('#plan-date', addDays(new Date().toISOString().slice(0, 10), 1)); await p.waitForTimeout(500);
  await go(p, 'Vær langs ruten'); await p.waitForTimeout(500); await p.click('#wx-fetch'); await p.waitForTimeout(6000);
  const names = [];
  for (const t of T) { where = await open(p, t); names.push(where); if (!(await alive(p))) bag.push(`[${where}] BLANK SIDE`); const o = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (o > 1) bag.push(`[${where}] HORISONTAL SCROLL ${o}px (desktop)`); }
  console.log('A desktop ferdig:', names.join(' | '));

  // ---------- B: «ape»-test: trykk på alle ufarlige knapper på hver side ----------
  if (mode === 'all' || mode === 'monkey') {
    const danger = /slett|fjern|tøm|nullstill|✕|rydd|gjenopprett|erstatt|importer|last ned|eksport|pdf|zip|gpx|geojson|excel|csv|skriv ut|utskrivbar|forhåndslast|arkiver|dupliser|kopier|opprett|ja,|start på nytt|bytt|åpne|windy/i;
    let clicks = 0;
    for (const t of T) {
      where = await open(p, t);
      const n = Math.min(45, await p.locator('main button:visible').count());
      for (let k = 0; k < n; k++) {
        const btn = p.locator('main button:visible').nth(k);
        const txt = ((await btn.innerText().catch(() => '')) + ' ' + ((await btn.getAttribute('aria-label').catch(() => '')) || '')).replace(/\s+/g, ' ').trim();
        if (!txt || danger.test(txt) || (await btn.isDisabled().catch(() => true))) continue;
        const pre = where; where = `${pre} » klikk «${txt.slice(0, 40)}»`;
        await btn.click({ timeout: 1500 }).catch(() => {});
        clicks++;
        await p.waitForTimeout(120);
        if (!(await alive(p))) { bag.push(`[${where}] BLANK ETTER KLIKK`); await p.reload({ timeout: 15000 }).catch(() => {}); await p.waitForTimeout(2500); }
        where = pre;
        // tilbake til samme fane hvis klikket navigerte bort
        await open(p, t);
      }
    }
    console.log('B ape-klikk:', clicks);
  }

  // ---------- D: rare verdier i tallfelt og datoer ----------
  if (mode === 'all' || mode === 'inputs') {
    let n = 0;
    for (const t of T) {
      const base = await open(p, t);
      const cnt = Math.min(30, await p.locator('main input[type=number]:visible').count());
      for (let k = 0; k < cnt; k++) {
        const inp = p.locator('main input[type=number]:visible').nth(k);
        const old = await inp.inputValue().catch(() => null);
        if (old == null) continue;
        for (const v of ['', '-5', '0', '99999']) { where = `${base} » tallfelt #${k} = «${v}»`; await inp.fill(v, { timeout: 1000 }).catch(() => {}); await p.waitForTimeout(60); n++; if (!(await alive(p))) { bag.push(`[${where}] BLANK`); await p.reload({ timeout: 15000 }).catch(() => {}); await p.waitForTimeout(2500); await open(p, t); break; } }
        await p.locator('main input[type=number]:visible').nth(k).fill(old, { timeout: 1000 }).catch(() => {});
      }
    }
    console.log('D tallfelt-forsøk:', n);
    // etter rare verdier: alle sider må fortsatt virke
    for (const t of T) { where = (await open(p, t)) + ' (etter rare verdier)'; if (!(await alive(p))) bag.push(`[${where}] BLANK SIDE`); }
  }
  await c.close();

  // ---------- mobil ----------
  ({ c, p } = await mk(devices['iPhone 13']));
  p.on('dialog', (d) => (d.type() === 'beforeunload' ? d.accept() : d.dismiss()));
  await p.goto(URL0, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3500);
  for (const t of T) { where = (await open(p, t)) + ' (mobil)'; if (!(await alive(p))) bag.push(`[${where}] BLANK SIDE`); const o = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (o > 1) bag.push(`[${where}] HORISONTAL SCROLL ${o}px`); }
  console.log('A mobil ferdig');
  await c.close();

  // ---------- C: tomt prosjekt + E: ugyldige importfiler ----------
  if (mode === 'all' || mode === 'empty') {
    ({ c, p } = await mk());
    p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Testnavn' : undefined));
    await p.goto(URL0, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3500);
    where = 'tomt prosjekt: opprett';
    await go(p, 'Prosjekt'); await p.waitForTimeout(600);
    await p.locator('button', { hasText: '+ Nytt prosjekt' }).click(); await p.fill('#new-proj-name', 'Tomt testprosjekt'); await p.click('#new-proj-ok'); await p.waitForTimeout(2500);
    for (const t of T) { where = (await open(p, t)) + ' (tomt prosjekt)'; if (!(await alive(p))) { bag.push(`[${where}] BLANK SIDE`); await p.reload({ timeout: 15000 }).catch(() => {}); await p.waitForTimeout(2500); } }
    // eksport uten rute: skal gi melding, ikke krasj
    await go(p, 'Eksport'); await p.waitForTimeout(800);
    for (const id of ['#exp-pdf', '#exp-gpx', '#exp-geojson', '#exp-xlsx', '#exp-csv-days', '#exp-zip']) { where = `tomt prosjekt: eksport ${id}`; await p.click(id, { timeout: 3000 }).catch((e) => bag.push(`[${where}] KLIKK FEILET ${e.message.split('\n')[0]}`)); await p.waitForTimeout(2500); if (!(await alive(p))) bag.push(`[${where}] BLANK`); }
    console.log('C eksportlogg (tomt prosjekt):', (await p.locator('#exp-log').innerText().catch(() => '(ingen)')).replace(/\n/g, ' | ').slice(0, 600));
    // E: ugyldige filer
    const bad = { 'tekst.zip': 'dette er ikke en zip', 'tom.json': '{}', 'liste.json': '[1,2,3]', 'halv.json': '{"format":"kite-finse-rjukan-plan","version":3,"slices":', 'feilrute.json': '{"routes":"nei"}', 'nullrute.json': '{"format":"kite-finse-rjukan-plan","version":3,"schema":1,"name":"X","slices":{"plans":"feil","camps":5},"routes":[{"id":"r","name":"R","waypoints":[{"lat":"abc","lon":null}]}]}' };
    fs.mkdirSync(dir + '/bad', { recursive: true });
    const projBefore = (await projects(p)).length;
    await go(p, 'Prosjekt'); await p.waitForTimeout(600);
    for (const [fn, body] of Object.entries(bad)) {
      where = `import ${fn}`;
      fs.writeFileSync(`${dir}/bad/${fn}`, body);
      await go(p, 'Prosjekt'); await p.waitForTimeout(400);
      await p.locator('label', { hasText: 'Importer prosjekt' }).locator('input').setInputFiles(`${dir}/bad/${fn}`); await p.waitForTimeout(2500);
      const msg = (await p.locator('main .msg').allInnerTexts().catch(() => [])).join(' / ').slice(0, 160);
      const now = (await projects(p)).length;
      console.log(`E ${fn}: prosjekter ${projBefore}→${now} · «${msg}»`);
      if (!(await alive(p))) { bag.push(`[${where}] BLANK`); await p.reload({ timeout: 15000 }).catch(() => {}); await p.waitForTimeout(2500); }
      else for (const t of T.slice(0, 8)) { where = `etter import ${fn}: ` + (await open(p, t)); if (!(await alive(p))) { bag.push(`[${where}] BLANK SIDE`); await p.reload({ timeout: 15000 }).catch(() => {}); await p.waitForTimeout(2500); break; } }
    }
    where = 'scenario-import søppel';
    await go(p, 'Scenarioer'); await p.waitForTimeout(500);
    for (const fn of ['tom.json', 'liste.json', 'tekst.zip']) { await p.locator('label', { hasText: 'Importer delt scenario' }).locator('input').setInputFiles(`${dir}/bad/${fn}`); await p.waitForTimeout(600); console.log(`E scenario ${fn}: «${(await p.locator('main .msg').first().innerText().catch(() => '')).slice(0, 100)}»`); if (!(await alive(p))) bag.push(`[${where} ${fn}] BLANK`); }
    where = 'GPX-import søppel';
    await go(p, 'Kart & rute'); await p.waitForTimeout(500); await openAdv(p);
    fs.writeFileSync(`${dir}/bad/feil.gpx`, '<gpx><trk><trkseg><trkpt lat="x" lon="y"/></trkseg></trk>'); fs.writeFileSync(`${dir}/bad/tom.gpx`, '<?xml version="1.0"?><gpx></gpx>');
    for (const fn of ['feil.gpx', 'tom.gpx']) { await p.setInputFiles('input[type=file][accept*=".gpx"]', `${dir}/bad/${fn}`).catch((e) => bag.push(`[${where}] ${e.message.split('\n')[0]}`)); await p.waitForTimeout(1200); if (!(await alive(p))) { bag.push(`[${where} ${fn}] BLANK`); await p.reload({ timeout: 15000 }).catch(() => {}); await p.waitForTimeout(2500); await openAdv(p); } }
    const st = await state(p);
    console.log('E etter GPX-søppel: ruter', (st.routes || []).length, (st.routes || []).map((r) => `${r.name}:${r.waypoints.length}pkt:${r.waypoints.some((w) => !Number.isFinite(w.lat) || !Number.isFinite(w.lon)) ? 'UGYLDIG' : 'ok'}`).join(', '));
    for (const t of T) { where = (await open(p, t)) + ' (etter GPX-søppel)'; if (!(await alive(p))) { bag.push(`[${where}] BLANK SIDE`); await p.reload({ timeout: 15000 }).catch(() => {}); await p.waitForTimeout(2500); } }
    await c.close();
  }
  const uniq = [...new Set(bag0)];
  console.log(`\n==== ${uniq.length} funn ====`);
  uniq.forEach((x) => console.log(x));
  await b.close();
})();
