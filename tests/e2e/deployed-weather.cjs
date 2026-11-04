const { chromium } = require('playwright');
const fs = require('fs');
const { execFileSync } = require('child_process');
const URL0 = 'http://localhost:4180/Kite-finse/';
const tile = fs.readFileSync(__dirname + '/testtile.png');
eval(fs.readFileSync(__dirname + '/wxstubs.inc', 'utf8').replace(/async function weatherStubs\(p\)/, 'global.weatherStubs = async function (p)').replace(/^const /gm, 'global.').replace(/global\.addDays = .*$/m, ''));
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1366, height: 1000 }, acceptDownloads: true });
  await ctx.route('**/cache.kartverket.no/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: tile }));
  await weatherStubs(ctx);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL0); await p.waitForTimeout(3000); await p.reload(); await p.waitForTimeout(3500);
  console.log('SW controller:', await p.evaluate(() => !!navigator.serviceWorker.controller), '| map tiles:', await p.locator('img.leaflet-tile-loaded').count());
  await p.locator('nav.mainnav button', { hasText: 'Dagplan' }).click(); await p.waitForTimeout(800);
  const t = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await p.fill('#plan-date', t); await p.waitForTimeout(800);
  await p.locator('nav.mainnav button', { hasText: 'Vær & kite' }).click(); await p.locator('nav.subnav button', { hasText: 'Vær langs ruten' }).click(); await p.waitForTimeout(1200);
  await p.click('#wx-fetch'); await p.waitForTimeout(6000);
  console.log('providers fetched:', await p.locator('.prov', { hasText: 'punkter' }).count(), '| alert shown:', /Kuling/.test(await p.locator('body').innerText()));
  await p.locator('button', { hasText: 'Bruk prognosen alle dager' }).first().click(); await p.waitForTimeout(1500);
  console.log('day 1 covered:', !/Utenfor prognosen/.test(await p.locator('.wxday').first().innerText()), '| hours rows:', await p.locator('.wxtable tbody tr').count());
  for (const [m, s] of [['Oversikt', 'Status'], ['Dagplan', 'Overnatting'], ['Utstyr', 'Mat og vann'], ['Oversikt', 'Oppgaver og team']]) {
    await p.locator('nav.mainnav button', { hasText: m }).first().click(); await p.locator('nav.subnav button', { hasText: s }).click(); await p.waitForTimeout(1200);
    console.log(`page ${s}: ok`, (await p.locator('.page').innerText()).length > 200);
  }
  await p.locator('nav.mainnav button', { hasText: 'Eksport' }).click(); await p.waitForTimeout(1500);
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), p.click('#exp-pdf')]);
  const f = __dirname + '/shots/swv7.pdf'; await dl.saveAs(f);
  const txt = execFileSync('pdftotext', [f, '-'], { encoding: 'utf8' });
  console.log('PDF: tile maps', (txt.match(/Kartgrunnlag/g) || []).length, '| grid', (txt.match(/Kartfliser var ikke/g) || []).length, '| forecast label', /PROGNOSE: YR\/MET/.test(txt), '| food page', /Mat, vann og brensel/.test(txt));
  console.log('errors:', errs);
  await b.close();
})();
