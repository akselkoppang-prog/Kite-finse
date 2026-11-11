// Test av det FERDIGE bygget (servert som på GitHub Pages under /Kite-finse/, service worker PÅ):
// versjon, full offline-bruk, oppdatering til ny versjon og gjenoppretting når en gammel fane mangler sidefiler.
const { chromium } = require('playwright');
const fs = require('fs');
const { execFileSync } = require('child_process');
const URL0 = 'http://localhost:4180/Kite-finse/';
const SITE = __dirname + '/site/Kite-finse';
const REPO = '/home/user/Kite-finse';
const tile = fs.readFileSync(__dirname + '/testtile.png');
let fail = 0;
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fail++; };
const ver = () => JSON.parse(fs.readFileSync(SITE + '/version.json', 'utf8')).version;
const shown = (p) => p.locator('#app-version').innerText();
const swInfo = (p) => p.evaluate(async () => { const keys = await caches.keys(); const app = keys.filter((k) => k.startsWith('kite-app-')); const n = app.length ? (await (await caches.open(app[0])).keys()).length : 0; return { ctrl: !!navigator.serviceWorker.controller, app, n }; });
async function allTabs(p, errs, label) {
  let blank = 0, visited = 0;
  const mains = await p.locator('nav.mainnav button').count();
  for (let i = 0; i < mains; i++) {
    await p.locator('nav.mainnav button').nth(i).click(); await p.waitForTimeout(300);
    const subs = Math.max(1, await p.locator('nav.subnav button').count());
    for (let j = 0; j < subs; j++) {
      if (await p.locator('nav.subnav button').count()) await p.locator('nav.subnav button').nth(j).click();
      await p.waitForTimeout(700); visited++;
      if (await p.locator('.errorboundary').count() || !(await p.locator('main > *').count())) blank++;
    }
  }
  ok(blank === 0 && errs.length === 0, `${label}: ${visited} sider åpnet, ${blank} med feil, ${errs.length} JS-feil ${errs.slice(0, 2).join(' | ')}`);
}
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1366, height: 950 } });
  await ctx.route('**/cache.kartverket.no/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: tile }));
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto(URL0); await p.waitForTimeout(4000);
  const v1 = ver();
  ok(/^\d{4}\.\d\d\.\d\d\.\d{3}(-lokal)?$/.test(v1), `versjon i version.json har riktig format: ${v1}`);
  ok((await shown(p)).includes(v1), `bunnteksten viser versjonen (${await shown(p)})`);
  await p.reload(); await p.waitForTimeout(3000);
  let info = await swInfo(p);
  const pre = JSON.parse(/const PRECACHE = (\[[^\]]*\])/.exec(fs.readFileSync(SITE + '/sw.js', 'utf8'))[1]).length;
  ok(info.ctrl && info.app.length === 1 && info.app[0] === `kite-app-${v1}`, `service worker aktiv med egen cache for versjonen (${info.app.join(', ')})`);
  ok(info.n >= pre, `hele appen er lagret for offline-bruk: ${info.n} filer i cachen (${pre} i pakken)`);
  // --- Innstillinger viser versjon ---
  await p.locator('#app-version').click(); await p.waitForTimeout(1200);
  ok((await p.locator('#about-version').innerText()).includes(v1) && /Lokalt bygg|Publisert/.test(await p.locator('.card', { hasText: 'Om appen' }).innerText()), 'Innstillinger → Datakilder → «Om appen» viser versjon og byggtype');
  // --- OFFLINE: last på nytt og åpne alle sider (også de som aldri har vært åpnet) ---
  await ctx.setOffline(true);
  await p.reload().catch(() => {}); await p.waitForTimeout(3500);
  ok(await p.locator('nav.mainnav').count() === 1 && await p.locator('.leaflet-container').count() >= 0, 'UTEN NETT: appen starter fra lagret versjon');
  errs.length = 0;
  await allTabs(p, errs, 'UTEN NETT');
  // lagring uten nett
  await p.locator('nav.mainnav button').nth(1).click(); await p.locator('nav.subnav button').first().click(); await p.waitForTimeout(800);
  await p.locator('#d0-dep').fill('9.25'); await p.waitForTimeout(1500);
  ok(/LAGRET/.test(await p.locator('.saveind').innerText()), 'UTEN NETT: endringer lagres (IndexedDB)');
  // eksport uten nett (PDF-motoren ligger i offline-pakken)
  await p.locator('nav.mainnav button', { hasText: 'Eksport' }).click(); await p.waitForTimeout(1200);
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), p.click('#exp-pdf')]);
  const pf = __dirname + '/shots/offline.pdf'; await dl.saveAs(pf);
  const txt = execFileSync('pdftotext', [pf, '-'], { encoding: 'utf8' });
  ok(txt.replace(/\s+/g, ' ').includes(`appversjon ${v1}`), 'UTEN NETT: PDF lages, og versjonen står i dokumentet');
  await ctx.setOffline(false);

  // --- NY VERSJON LEGGES UT mens fanen står åpen ---
  execFileSync('npm', ['run', 'build'], { cwd: REPO, stdio: 'ignore' });
  fs.rmSync(SITE, { recursive: true, force: true }); fs.cpSync(REPO + '/dist', SITE, { recursive: true });
  const v2 = ver();
  ok(v2 !== v1 && Number(v2.slice(11, 14)) === Number(v1.slice(11, 14)) + 1, `nytt bygg får neste nummer: ${v1} → ${v2}`);
  // gammel fane: fortsatt gammel SW/cache → alle sider virker fortsatt
  errs.length = 0;
  await allTabs(p, errs, 'GAMMEL FANE etter at ny versjon er lagt ut');
  // en annen fane åpner appen → ny service worker tar over og rydder gammel cache
  const p2 = await ctx.newPage(); await p2.goto(URL0); await p2.waitForTimeout(5000);
  ok((await shown(p2)).includes(v2), `ny fane får ny versjon (${await shown(p2)})`);
  info = await swInfo(p2);
  ok(info.app.length === 1 && info.app[0] === `kite-app-${v2}`, `gammel app-cache er ryddet bort (${info.app.join(', ')})`);
  const tiles = await p2.evaluate(async () => (await caches.keys()).includes('kv-tiles-v1'));
  ok(tiles, 'kartfliser for offline-bruk er beholdt ved oppdatering');
  // gammel fane sier fra om ny versjon når den blir synlig igjen
  await p.bringToFront();
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await p.waitForTimeout(600);
  // (sjekken har 5 min sperre – oppdateringsbanneret testes derfor etter omlasting under)
  ok((await shown(p)).includes(v1), 'gammel fane kjører fortsatt gammel versjon');
  // gammel fane uten sine filer: last siden på nytt = ny versjon, og data er der
  await p.reload(); await p.waitForTimeout(4000);
  ok((await shown(p)).includes(v2), `etter omlasting kjører fanen ny versjon (${await shown(p)})`);
  const dep = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open('kite-finse-rjukan'); r.onsuccess = () => { const q = r.result.transaction('slices').objectStore('slices').getAll(); q.onsuccess = () => { const pl = q.result.find((x) => x.slice === 'plan'); r.result.close(); res(pl?.value?.plans?.[0]?.days?.[0]?.departure); }; }; }));
  ok(dep === 9.25, 'endringen som ble gjort uten nett er bevart etter oppdateringen');
  errs.length = 0;
  await allTabs(p, errs, 'NY VERSJON');

  // --- manglende sidefil (gammel fane, ny SW): automatisk omlasting i stedet for blank side ---
  const p3 = await ctx.newPage(); const e3 = []; p3.on('pageerror', (e) => e3.push(e.message));
  await p3.goto(URL0); await p3.waitForTimeout(3500);
  await p3.locator('nav.mainnav button').first().click(); await p3.waitForTimeout(500);
  // simuler: sidefilene finnes ikke lenger (slett cachen og svar 404 på én sidefil)
  let blocked = 0, reloaded = false;
  await p3.evaluate(async () => { for (const k of await caches.keys()) if (k.startsWith('kite-app-')) await caches.delete(k); });
  // filen «finnes ikke» helt til siden lastes på nytt (som etter en ny utrulling)
  p3.on('framenavigated', (f) => { if (f === p3.mainFrame()) reloaded = true; });
  await ctx.route('**/assets/StatusPage-*.js', (r) => (reloaded ? r.continue() : (blocked++, r.fulfill({ status: 404, contentType: 'text/html', body: 'not found' }))));
  await p3.locator('nav.subnav button', { hasText: 'Status' }).click();
  await p3.waitForTimeout(9000);
  ok(blocked >= 1 && reloaded && await p3.locator('#ready-pct').count() === 1 && !(await p3.locator('.errorboundary').count()), `manglende sidefil: appen lastet seg selv på nytt og viser siden brukeren ba om (${blocked} mislykkede hentinger, omlastet: ${reloaded})`);
  await ctx.unroute('**/assets/StatusPage-*.js');

  // --- oppdateringsbanner: serveren har nyere versjon enn fanen ---
  const p4 = await ctx.newPage();
  await ctx.route('**/version.json*', (r) => r.fulfill({ json: { version: '2099.01.01.001' } }));
  await p4.goto(URL0); await p4.waitForTimeout(3500);
  ok(/Ny versjon er tilgjengelig \(2099\.01\.01\.001\)/.test(await p4.locator('.updateb').innerText().catch(() => '')), 'banner sier fra når en nyere versjon finnes, med «Lagre og last inn»');
  console.log(fail ? `${fail} FEIL` : 'ALLE PRODUKSJONSTESTER OK');
  await b.close();
})();
