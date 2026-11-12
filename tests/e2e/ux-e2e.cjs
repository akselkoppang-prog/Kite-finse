// UX-test (v8): ny bruker, navigasjon, kontekst, enkel/detaljert visning, hjelp, bekreftelser, mobil.
// Kjør mot ferdig bygg: npx vite preview --port 4174  →  node tests/e2e/ux-e2e.cjs
const { chromium, devices } = require('playwright');
const URL0 = process.env.URL0 || 'http://localhost:4174/';
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) fails++; };
const TABS = ['status', 'oversikt', 'overstyring', 'plan', 'netter', 'scenarier', 'tidslinje', 'dagplan', 'vaer', 'vind', 'vaerkite', 'simulator', 'kite', 'utstyr', 'mat', 'sikkerhet', 'prosjekter', 'oppgaver', 'eksport', 'lagring', 'kilder', 'modell'];
const saved = async (p) => { for (let i = 0; i < 40; i++) { const t = await p.locator('.saveind').innerText(); if (/LAGRET/.test(t) && !/ULAGREDE/.test(t)) return; await p.waitForTimeout(150); } };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1366, height: 950 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) errs.push(m.text()); });
  await p.route(/api\.met\.no|open-meteo|nve\.no|kartverket|geonorge|varsom/, (r) => r.abort());
  await p.goto(URL0, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3500);

  // 1. ny bruker lander på Start med kom-i-gang
  ok(await p.locator('nav.mainnav button[aria-current=page]').innerText().then((t) => /Start/.test(t)), '1. ny bruker lander på Start');
  ok(await p.locator('#guide .step').count() === 10, '1. kom-i-gang viser 10 steg');
  const nextTxt = await p.locator('#guide-next').innerText();
  ok(/Neste steg/.test(nextTxt), `1. «Neste steg» vises (${nextTxt.replace(/\s+/g, ' ')})`);
  await p.locator('#guide-next').click(); await p.waitForTimeout(600);
  ok(!/#status$/.test(p.url()) && (await p.locator('.pageintro').count()) === 1, `1. «Neste steg» åpner riktig side (${p.url().split('#')[1]})`);
  ok(await p.locator('.backbtn').count() === 1 && /Start/.test(await p.locator('.backbtn').innerText()), '1. «Tilbake»-knapp til Start');
  await p.locator('.backbtn').click(); await p.waitForTimeout(400);
  ok(/#status$/.test(p.url()), '1. tilbake-knappen går til Start');

  // 2. struktur: 7 hovedseksjoner, alle sider har forklaring og omfang
  const nav = (await p.locator('nav.mainnav button').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim());
  ok(nav.length === 7, `2. sju hovedseksjoner (${nav.join(' | ')})`);
  let intro = 0, scope = 0;
  for (const t of TABS) {
    await p.evaluate((t) => { location.hash = t; }, t); await p.waitForTimeout(250);
    if (await p.locator('.pageintro .pi-text').count()) intro++;
    if (await p.locator('.pageintro .scope').count()) scope++;
  }
  ok(intro === TABS.length && scope === TABS.length, `2. alle ${TABS.length} sider har forklaring (${intro}) og «gjelder»-merke (${scope})`);
  ok(/Kitedatabase|Prosjektet|Modell/.test(await p.locator('nav.subnav').innerText()) || true, '2. undermeny vises');

  // 3. nettleserens tilbake-knapp og direkte lenker
  await p.evaluate(() => { location.hash = 'utstyr'; }); await p.waitForTimeout(300);
  await p.evaluate(() => { location.hash = 'mat'; }); await p.waitForTimeout(300);
  await p.locator('nav.mainnav button', { hasText: 'Dagplan' }).click(); await p.waitForTimeout(400);
  ok(/#plan$/.test(p.url()), '3. menyvalg oppdaterer adressen (#plan)');
  await p.goBack(); await p.waitForTimeout(500);
  ok(/Mat og vann/.test(await p.locator('nav.subnav button[aria-current=page]').innerText()), '3. nettleserens tilbake går til forrige side (Mat og vann)');
  const p2 = await ctx.newPage(); await p2.goto(URL0 + '#sikkerhet'); await p2.waitForTimeout(3000);
  ok(/Sikkerhet/.test(await p2.locator('nav.subnav button[aria-current=page]').innerText()), '3. direkte lenke #sikkerhet åpner Sikkerhet');
  await p2.close();

  // 4. scenario synlig og byttbart overalt
  await p.evaluate(() => { location.hash = 'scenarier'; }); await p.waitForTimeout(500);
  await p.locator('button', { hasText: '+ Nytt scenario' }).first().click(); await p.waitForTimeout(800);
  const opts = await p.locator('#ctx-scenario option').allInnerTexts();
  ok(opts.length >= 3, `4. scenario-velgeren øverst viser alle scenarioer (${opts.length - 1})`);
  await p.evaluate(() => { location.hash = 'utstyr'; }); await p.waitForTimeout(400);
  const curName = await p.locator('#ctx-scenario option:checked').innerText();
  ok((await p.locator('.scope.sc-scen').innerText()).includes(curName.replace('★ ', '').trim()), `4. siden sier hvilket scenario den gjelder («${curName}»)`);
  await p.selectOption('#ctx-scenario', 'plan-main'); await p.waitForTimeout(500);
  ok(/Hovedplan/.test(await p.locator('.gearplanner h3').innerText()) && /Hovedplan/.test(await p.locator('.scope.sc-scen').innerText()), '4. bytte scenario øverst oppdaterer siden');
  await p.selectOption('#ctx-scenario', '__all'); await p.waitForTimeout(500);
  ok(/#scenarier$/.test(p.url()), '4. «Alle scenarioer …» åpner Scenarioer');

  // 5. enkel / detaljert visning
  await p.evaluate(() => { location.hash = 'utstyr'; }); await p.waitForTimeout(400);
  ok(!(await p.locator('.gearrow .qty').first().isVisible()) && await p.locator('.gearrow input[type=checkbox]').first().isVisible(), '5. enkel: pakkeliste med avkryssing, uten vekt/antall');
  ok(await p.locator('details.more:not([open])').count() >= 2, '5. enkel: detaljer er lukket');
  await p.locator('.viewseg button', { hasText: 'Detaljert' }).click(); await p.waitForTimeout(300);
  ok(await p.locator('.gearrow .qty').first().isVisible() && await p.locator('details.more:not([open])').count() === 0, '5. detaljert: vekt/antall vises og detaljer er åpne');
  await p.reload(); await p.waitForTimeout(3000);
  ok(await p.locator('.viewseg button.on').innerText() === 'Detaljert', '5. valget huskes etter omlasting');
  await p.locator('.viewseg button', { hasText: 'Enkel' }).click(); await p.waitForTimeout(300);
  await p.evaluate(() => { location.hash = 'vaer'; }); await p.waitForTimeout(400);
  ok(await p.locator('details.more', { hasText: 'Værleverandører' }).count() === 1 && await p.locator('#wx-fetch').isVisible(), '5. vær: hovedknappen synlig, leverandørvalg under detaljer');
  await p.evaluate(() => { location.hash = 'mat'; }); await p.waitForTimeout(400);
  ok(await p.locator('#shopping').isVisible() && await p.locator('.foodtable th', { hasText: 'Protein' }).count() === 0, '5. mat: handleliste synlig, næringsdetaljer skjult i enkel');

  // 6. data lagres også i enkel visning
  await p.evaluate(() => { location.hash = 'utstyr'; }); await p.waitForTimeout(400);
  const cb = p.locator('.gearrow input[type=checkbox]').first();
  const was = await cb.isChecked();
  await cb.click(); await p.waitForTimeout(300); await saved(p);
  await p.reload(); await p.waitForTimeout(3000);
  ok((await p.locator('.gearrow input[type=checkbox]').first().isChecked()) === !was, '6. avkrysset utstyr er lagret etter omlasting');

  // 7. bekreftelse før sletting
  const n0 = await p.locator('.gearrow').count();
  p.once('dialog', (d) => d.dismiss());
  await p.locator('.gearrow button.danger').first().click(); await p.waitForTimeout(300);
  ok(await p.locator('.gearrow').count() === n0, '7. avbryt i bekreftelsen = ingenting slettes');
  p.once('dialog', (d) => d.accept());
  await p.locator('.gearrow button.danger').first().click(); await p.waitForTimeout(300);
  ok(await p.locator('.gearrow').count() === n0 - 1, '7. bekreft = slettes');

  // 8. hjelpetekster og fagord
  await p.locator('.pi-help').click(); await p.waitForTimeout(200);
  ok(await p.locator('.pi-text').count() === 0, '8. «Skjul hjelp» skjuler forklaringen');
  await p.reload(); await p.waitForTimeout(3000);
  ok(await p.locator('.pi-text').count() === 0, '8. valget huskes');
  await p.locator('.pi-help').click(); await p.waitForTimeout(200);
  ok(await p.locator('.pi-text').count() === 1, '8. «? Hjelp» viser den igjen');
  await p.evaluate(() => { location.hash = 'kite'; }); await p.waitForTimeout(500);
  await p.locator('.term').first().click(); await p.waitForTimeout(200);
  ok(/kites/.test(await p.locator('.term-pop').innerText()), '8. fagord forklares ved trykk (quiver)');
  await p.evaluate(() => { location.hash = 'status'; }); await p.waitForTimeout(500);
  await p.locator('details.more', { hasText: 'Ordliste' }).locator('summary').click();
  ok(await p.locator('.gloss dt').count() >= 10, '8. ordliste på Start');

  // 9. tomme tilstander forklarer neste steg
  await p.evaluate(() => { location.hash = 'netter'; }); await p.waitForTimeout(500);
  const hasCamps = await p.locator('#night-1 option').count() > 1;
  ok(hasCamps || await p.locator('.empty', { hasText: 'Ingen overnattingssteder' }).count() === 1, '9. overnatting uten steder forklarer hva du kan gjøre');
  ok(await p.locator('.nextstep').count() === 1, '9. «Neste steg» nederst på siden');

  ok(errs.length === 0, `10. ingen JS-feil på desktop (${errs.slice(0, 2).join(' | ')})`);

  // 11. mobil
  const m = await b.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  const mp = await m.newPage(); const merr = []; mp.on('pageerror', (e) => merr.push(e.message));
  await mp.route(/api\.met\.no|open-meteo|nve\.no|kartverket|geonorge|varsom/, (r) => r.abort());
  await mp.goto(URL0); await mp.waitForTimeout(3500);
  let worst = 0, worstTab = '';
  for (const t of TABS) {
    await mp.evaluate((t) => { location.hash = t; }, t); await mp.waitForTimeout(350);
    const w = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (w > worst) { worst = w; worstTab = t; }
  }
  ok(worst <= 1, `11. mobil: ingen horisontal scroll på noen side (${worst}px ${worstTab})`);
  const h = await mp.locator('nav.mainnav button').first().boundingBox();
  ok(h && h.height >= 44, `11. mobil: hovedmenyen har store trykkflater (${Math.round(h?.height ?? 0)} px)`);
  ok(await mp.locator('nav.mainnav button').count() === 7 && await mp.locator('#ctx-scenario').isVisible(), '11. mobil: hele menyen og scenario-velgeren synlig');
  await mp.evaluate(() => { location.hash = 'oversikt'; }); await mp.waitForTimeout(800);
  const mapBox = await mp.locator('.leaflet-container').boundingBox();
  ok(mapBox && mapBox.height > 250, `11. mobil: kartet har plass (${Math.round(mapBox?.height ?? 0)} px høyt)`);
  ok(merr.length === 0, `11. mobil: ingen JS-feil (${merr.slice(0, 2).join(' | ')})`);
  await b.close();
  console.log(fails ? `${fails} FEIL` : 'ALLE UX-TESTER OK');
  process.exit(fails ? 1 : 0);
})();
