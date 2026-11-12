const { chromium } = require('playwright');
const fs = require('fs');
const { execFileSync } = require('child_process');
const URL0 = 'http://localhost:4180/Kite-finse/';
const tile = fs.readFileSync(__dirname + '/testtile.png');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1366, height: 1000 }, acceptDownloads: true }); // service worker PÅ (som på nettsiden)
  // Kartverket-fliser (sandkassen har ikke nett): svar som ekte server med CORS-header
  await ctx.route('**/cache.kartverket.no/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: tile }));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto(URL0 + '#oversikt'); await p.waitForTimeout(3000);
  await p.reload(); await p.waitForTimeout(3500); // nå styrt av service workeren
  if (process.env.SWAP) {
    // gammel versjon har cachet fliser fra kartet → bytt til ny versjon (som et nytt deploy)
    console.log('old build: tiles in map', await p.locator('img.leaflet-tile-loaded').count());
    execFileSync('cp', ['-r', __dirname + '/site-new/.', __dirname + '/site/Kite-finse/']);
    await p.reload(); await p.waitForTimeout(3000); await p.reload(); await p.waitForTimeout(3500);
    console.log('new SW active:', await p.evaluate(async () => (await (await fetch('sw.js')).text()).includes('opak kopi')));
  }
  console.log('SW controller:', await p.evaluate(() => !!navigator.serviceWorker.controller));
  console.log('tiles loaded in map:', await p.locator('img.leaflet-tile-loaded').count(), '| broken:', await p.evaluate(() => [...document.querySelectorAll('img.leaflet-tile')].filter((i) => i.complete && i.naturalWidth === 0).length));
  console.log('route drawn:', await p.locator('path.leaflet-interactive').count());
  await p.locator('nav.mainnav button', { hasText: 'Eksport' }).click(); await p.waitForTimeout(1500);
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), p.click('#exp-pdf')]);
  const f = __dirname + '/shots/sw.pdf'; await dl.saveAs(f);
  const txt = execFileSync('pdftotext', [f, '-'], { encoding: 'utf8' });
  console.log('PDF size', fs.statSync(f).size, '| grid fallback used:', /Kartfliser var ikke tilgjengelige/.test(txt), '| Kartverket attribution:', /Kartgrunnlag: © Kartverket/.test(txt));
  // kartinteraksjon med service worker på
  await p.locator('nav.mainnav button', { hasText: 'Oversikt' }).click(); await p.waitForTimeout(1500);
  const box = await p.locator('.leaflet-container').boundingBox();
  for (const [fx, fy] of [[0.3, 0.85], [0.6, 0.15], [0.15, 0.5]]) { await p.mouse.click(box.x + box.width * fx, box.y + box.height * fy); await p.waitForTimeout(400); if (await p.locator('.clickmenu').count()) break; }
  console.log('map click menu:', await p.locator('.clickmenu').count() === 1);
  await p.locator('.leaflet-control-zoom-in').click(); await p.waitForTimeout(1200);
  console.log('zoom ok, tiles after zoom:', await p.locator('img.leaflet-tile-loaded').count());
  // offline: PDF fra flisene som nå ligger lesbart i cachen
  await ctx.setOffline(true);
  await p.locator('nav.mainnav button', { hasText: 'Eksport' }).click(); await p.waitForTimeout(1000);
  const [dl2] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), p.click('#exp-pdf')]);
  const f2 = __dirname + '/shots/sw-offline.pdf'; await dl2.saveAs(f2);
  const t2 = execFileSync('pdftotext', [f2, '-'], { encoding: 'utf8' });
  console.log('OFFLINE PDF: grid pages', (t2.match(/Kartfliser var ikke/g) || []).length, '| tile maps', (t2.match(/Kartgrunnlag/g) || []).length);
  console.log('errors:', errs.filter((e) => !/ERR_TUNNEL|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e)).slice(0, 5));
  await b.close();
})();
