const { chromium, devices } = require('playwright');
const fs = require('fs');
const dir = process.argv[2];
const URL0 = 'http://localhost:4174/';
let fail = 0;
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fail++; };

// v5-navigasjon: gamle fanenavn → hovedmeny + undermeny
const NAV = { 'Kart & rute': ['Oversikt'], 'Overstyringer': ['Utstyr & planlegging', 'Vann-godkjenninger'], 'Kite-quiver': ['Vær & kite', 'Kitedatabase'], 'Kalender': ['Dagplan', 'Kalender og sol'], 'Dagplan': ['Dagplan', 'Avansert dagsfordeling'], 'Dagene': ['Dagplan', 'Dagene'], 'Kite og vind': ['Vær & kite', 'Kite og vind'], 'Utstyr & offline': ['Utstyr & planlegging', 'Utstyr og mat'], 'Vær & vind': ['Vær & kite', 'Værmelding'], 'Sikkerhet': ['Utstyr & planlegging', 'Sikkerhet'], 'YTELSESSIMULATOR': ['Vær & kite', 'Simulator'], 'Modell & kalibrering': ['Innstillinger', 'Modell og kalibrering'], 'Datakilder & diagnose': ['Innstillinger', 'Datakilder'], 'Innstillinger / Lagring': ['Innstillinger', 'Lagring og backup'] };
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
        db.close(); res(st);
      } }; });
    };
  }));
};
const noScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const plan = (st) => st.plans.find((x) => x.id === st.activePlanId);
const tileText = (p, i, label) => p.locator('.daycard2').nth(i).locator('.tile', { hasText: label }).innerText();
const setRange = async (p, sel, v) => { await p.locator(sel).fill(String(v)); await p.waitForTimeout(400); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) errs.push(m.text()); });
  p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Min testvariant' : undefined));
  await stubs(p);
  await p.goto(URL0, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3000);

  // 1. Enkel navigasjon
  const nav = await p.locator('nav.mainnav button').allInnerTexts();
  ok(nav.length === 6 && /Oversikt/.test(nav[0]) && /Dagplan/.test(nav[1]) && /Vær & kite/.test(nav[2]) && /Utstyr/.test(nav[3]) && /Eksport/.test(nav[4]) && /Innstillinger/.test(nav[5]), `1. fem hovedseksjoner (${nav.map((x) => x.replace(/\s+/g, ' ')).join(' | ')})`);
  ok(await p.locator('.ov-hero').count() === 1 && await p.locator('.ov-day').count() >= 2 && await p.locator('.leaflet-container').count() === 1, '1. oversikt = kart + sammendrag + dagliste');
  await p.screenshot({ path: dir + '/v5-oversikt.png' });

  // 2. Lag en 3-dagers plan
  await go(p, 'Dagene'); await p.waitForTimeout(800);
  await p.locator('.pt-field .seg button', { hasText: /^3$/ }).click(); await p.waitForTimeout(600);
  ok(await p.locator('.daycard2').count() === 3, '2. tre dagkort');

  // 3. Avreise, fart og timer for dag 1
  const arr0 = await tileText(p, 0, 'Ankomst');
  await setRange(p, '#d0-dep', 9.5);
  ok(/09:30/.test(await p.locator('.daycard2').nth(0).locator('.bigslider', { hasText: 'Avreise' }).innerText()), '3. avreise kan settes (09:30)');
  await setRange(p, '#d0-act', 5); await setRange(p, '#d0-spd', 18); await setRange(p, '#d0-brk', 1);
  const arr1 = await tileText(p, 0, 'Ankomst');
  ok(arr0 !== arr1, `3. ankomst oppdateres (${arr0.split('\n')[1]} → ${arr1.split('\n')[1]})`);
  const st3 = await state(p);
  const d0 = plan(st3).days[0];
  ok(d0.departure === 9.5 && d0.activeH === 5 && d0.speedKmh === 18 && d0.breakH === 1, '3. verdiene lagres i planen');

  // 4. Dag 1 = 50 km → sluttpunkt i kartet
  await p.locator('.daycard2').nth(0).locator('button', { hasText: 'Bestemt distanse' }).click(); await p.waitForTimeout(300);
  await setRange(p, '#d0-km', 50);
  const prog = await tileText(p, 0, 'Fremdrift');
  ok(/\b50 km/.test(prog) || /\b4[0-9] km/.test(prog), `4. dag 1 settes til 50 km (${prog.split('\n')[1]})`);
  const rem1 = await tileText(p, 1, 'Igjen til Rjukan');
  await p.screenshot({ path: dir + '/v5-dagplan.png', fullPage: true });

  // 5. Uavhengig vind for dag 2
  const card2 = p.locator('.daycard2').nth(1);
  if (!(await card2.locator('.windeditor').count())) await card2.locator('.dc-windsum').click();
  await card2.locator('.cbtn', { hasText: /^SV$/ }).click();
  await card2.locator('.windsliders input[type=range]').first().fill('3'); await p.waitForTimeout(600);
  const rem2 = await tileText(p, 1, 'Igjen til Rjukan');
  const st5 = await state(p);
  ok(plan(st5).days[1].wind.dir === 225 && plan(st5).days[1].wind.avg === 3 && plan(st5).days[0].wind.avg !== 3, '5. dag 2 har egen vind (SV 3 m/s), dag 1 uendret');
  ok(rem1 !== rem2, `5. endret vind dag 2 endrer gjenstående (${rem1.split('\n')[1]} → ${rem2.split('\n')[1]})`);
  ok(/scenario|prognose/i.test(await card2.locator('.windeditor').innerText()), '5. tydelig merket som eget scenario, ikke værmelding');

  // 6. Én kite per dag, manuelt valg
  const chips = card2.locator('.kchip2:not(:has-text("Auto"))');
  const nChips = await chips.count();
  await chips.nth(nChips - 1).click(); await p.waitForTimeout(500);
  const kite2 = await card2.locator('.dc-kite').innerText();
  ok(nChips >= 2 && !/auto/.test(kite2), `6. kite valgt manuelt for dag 2 (${kite2})`);
  const st6 = await state(p);
  ok(plan(st6).days[1].kiteId !== 'auto' && plan(st6).days[0].kiteId === 'auto', '6. kitevalg per dag (dag 1 auto, dag 2 manuell)');

  // 7. Varianter uten å overskrive hovedplanen
  await p.locator('button', { hasText: 'Prøv dag 1 = 35 / 50 / 60 km' }).click(); await p.waitForTimeout(1200);
  const st7 = await state(p);
  ok(st7.plans.length >= 4 && plan(st7).id === 'plan-main' && plan(st7).days[0].target.km === 50, `7. tre varianter laget, hovedplanen urørt (${st7.plans.length} planer)`);
  ok((await state(p)).compareIds.length >= 4, '7. varianter lagt i sammenligningen');
  await p.locator('button', { hasText: 'Lagre som nytt scenario' }).click(); await p.waitForTimeout(600);
  ok((await state(p)).plans.some((x) => x.name === 'Min testvariant'), '7. lagre som egen variant (navngitt)');
  await p.selectOption('#plan-sel', 'plan-main'); await p.waitForTimeout(500);

  // 8. Sluttpunkt i kartet
  await go(p, 'Kart & rute'); await p.waitForTimeout(1200);
  const ends = await p.locator('.dayend').allInnerTexts();
  ok(ends.length >= 2 && /Dag 1/.test(ends.join(' ')), `8. 🏁 sluttpunkt per dag i kartet (${ends.join(', ')})`);
  ok(await p.locator('.daywind').count() >= 2, '8. vindpil per dag i kartet');

  // 9. Teltplass via klikk i kartet
  const box = await p.locator('.leaflet-container').boundingBox();
  let opened = false;
  for (const [fx, fy] of [[0.3, 0.85], [0.6, 0.15], [0.15, 0.5], [0.8, 0.8]]) {
    await p.mouse.click(box.x + box.width * fx, box.y + box.height * fy); await p.waitForTimeout(400);
    if (await p.locator('.clickmenu').count()) { opened = true; break; }
  }
  ok(opened, '9. klikk i kartet gir hurtigmeny');
  await p.locator('.clickmenu button', { hasText: 'Legg til teltplass' }).click(); await p.waitForTimeout(500);
  await p.fill('#camp-name', 'Testleir'); await p.fill('#camp-desc', 'Le bak rygg'); await p.fill('#camp-assess', 'Befart før');
  await p.selectOption('#camp-useday', '0'); await p.waitForTimeout(600);
  const st9 = await state(p);
  const camp = st9.camps.find((c) => c.name === 'Testleir');
  ok(camp && camp.description === 'Le bak rygg' && camp.assessment === 'Befart før', '9. teltplass med navn, beskrivelse og vurdering');
  ok(plan(st9).days[0].campId === camp?.id && plan(st9).days[0].target.mode === 'stopp' && camp.role === 'foretrukket', '9. valgt som overnatting etter dag 1');
  ok(/forventet ankomst/.test(await p.locator('.drawer').innerText()), '9. forventet ankomst vises');
  await p.locator('.drawer button[aria-label="Lukk"]').click();

  // 10. Notat via kart + beskrivelse
  for (const [fx, fy] of [[0.3, 0.85], [0.6, 0.15], [0.15, 0.5], [0.8, 0.8]]) {
    await p.mouse.click(box.x + box.width * fx, box.y + box.height * fy); await p.waitForTimeout(400);
    if (await p.locator('.clickmenu').count()) break;
  }
  await p.locator('.clickmenu button', { hasText: 'Notat' }).click(); await p.waitForTimeout(400);
  await p.fill('#wp-name', 'Testnotat'); await p.fill('#wp-desc', 'Bratt utforkjøring, gå rundt på østsiden');
  await p.waitForTimeout(500);
  ok((await state(p)).markers.some((m) => m.name === 'Testnotat' && /østsiden/.test(m.description)), '10. beskrivelse på punkt lagres');
  await p.locator('.drawer button[aria-label="Lukk"]').first().click().catch(() => {});

  // 11. Advarsler: tre nivåer, merk som vurdert (ikke blokkerende)
  const ws = await p.locator('.warn-sum').first().innerText();
  ok(/viktige/.test(ws) && /advarsler/.test(ws) && /info/.test(ws), `11. tre nivåer (${ws.replace(/\s+/g, ' ')})`);
  const showAll = p.locator('.warn-sum button', { hasText: 'vis alle' });
  if (await showAll.count()) await showAll.first().click();
  const ackBtn = p.locator('.warn-row button', { hasText: 'Merk som vurdert' }).first();
  if (await ackBtn.count()) {
    const title = await ackBtn.locator('xpath=ancestor::div[contains(@class,"warn-row")]').locator('.warn-head').innerText();
    await ackBtn.click(); await p.locator('.ackform button', { hasText: 'Lagre vurdering' }).first().click(); await p.waitForTimeout(500);
    ok(await p.locator('.warn-row .badge', { hasText: 'VURDERT AV DEG' }).count() >= 1, `11. advarsel merket som vurdert (${title.replace(/\s+/g, ' ').slice(0, 60)})`);
    ok(Object.values((await state(p)).acks).some((v) => /jeg kjenner området/.test(v)), '11. vurderingen lagres med tekst');
  } else ok(false, '11. fant ingen advarsel å vurdere');
  ok(!/BLOKKERT/.test(await p.locator('body').innerText()), '11. ingen «BLOKKERT» i grensesnittet');

  // 12. Reload – alt er der
  await p.waitForTimeout(800);
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3000);
  const st12 = await state(p);
  const pm = plan(st12);
  ok(pm.days.length === 3 && pm.days[0].departure === 9.5 && pm.days[1].wind.avg === 3 && pm.days[1].kiteId !== 'auto', '12. plan, vind og kite per dag bevart etter reload');
  ok(st12.camps.some((c) => c.name === 'Testleir') && st12.plans.length >= 5 && Object.keys(st12.acks).length >= 1, '12. teltplass, varianter og vurderinger bevart');
  await go(p, 'Dagene'); await p.waitForTimeout(800);
  ok(/Testleir/.test(await p.locator('.daycard2').nth(0).innerText()), '12. dagkort viser valgt teltplass etter reload');

  // 13. Dra 🏁 for å flytte stoppet
  await go(p, 'Kart & rute'); await p.waitForTimeout(1200);
  const flag = p.locator('.dayend', { hasText: 'Dag 2' }).first();
  if (await flag.count()) {
    const before = plan(await state(p)).days[1].target;
    const fb = await flag.boundingBox();
    await p.mouse.move(fb.x + 8, fb.y + 12); await p.mouse.down(); await p.mouse.move(fb.x + 60, fb.y + 50, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(900);
    const after = plan(await state(p)).days[1].target;
    ok(after.mode === 'stopp' && after.stopD !== before.stopD, `13. sluttpunkt dag 2 kan dras (${before.mode} → stopp ${(after.stopD / 1000).toFixed(1)} km)`);
  } else ok(false, '13. fant ikke 🏁 dag 2');

  // 14. Slett teltplass
  await p.evaluate(() => {});
  await go(p, 'Dagene'); await p.waitForTimeout(600);
  await p.locator('.daycard2').nth(0).locator('button.link', { hasText: 'rediger' }).click(); await p.waitForTimeout(800);
  await p.locator('.drawer button', { hasText: 'Slett teltplass' }).click(); await p.locator('.drawer button', { hasText: 'Ja, slett' }).click(); await p.waitForTimeout(600);
  const st14 = await state(p);
  ok(!st14.camps.some((c) => c.name === 'Testleir') && !plan(st14).days[0].campId, '14. teltplass slettet, koblingen fjernet (stoppet beholdt)');
  ok(plan(st14).days[0].target.mode === 'stopp', '14. ditt manuelle stopp er ikke overskrevet');

  // 15. Endre antall dager uten å miste manuelle stopp
  await go(p, 'Dagene'); await p.waitForTimeout(600);
  await p.locator('.pt-field .seg button', { hasText: /^4$/ }).click(); await p.waitForTimeout(800);
  const st15 = await state(p);
  ok(plan(st15).days.length === 4 && plan(st15).days[0].departure === 9.5 && plan(st15).days[1].target.mode === 'stopp', '15. 4 dager – eksisterende dager og stopp beholdt');
  ok(errs.length === 0, `ingen JS-feil desktop (${errs.slice(0, 3).join(' | ')})`);
  await ctx.close();

  // 16. iPad og mobil: ingen horisontal scroll, store kontroller
  for (const [name, dev] of [['iPad', { ...devices['iPad (gen 7)'] }], ['iPad liggende', { ...devices['iPad (gen 7) landscape'] }], ['mobil', { ...devices['iPhone 13'] }]]) {
    const c = await b.newContext({ ...dev, serviceWorkers: 'block' });
    const mp = await c.newPage(); await stubs(mp);
    const merr = []; mp.on('pageerror', (e) => merr.push(e.message));
    await mp.goto(URL0, { waitUntil: 'domcontentloaded' }); await mp.waitForTimeout(2500);
    let worst = 0;
    for (const t of ['Kart & rute', 'Dagene', 'Kite og vind', 'Utstyr & offline', 'Innstillinger / Lagring']) {
      await go(mp, t); await mp.waitForTimeout(600);
      worst = Math.max(worst, await noScroll(mp));
    }
    ok(worst <= 1, `16. ${name}: ingen horisontal scroll i noen seksjon (${worst}px)`);
    await go(mp, 'Dagene'); await mp.waitForTimeout(600);
    const h = await mp.locator('.daycard2 .dc-windsum').first().boundingBox();
    const kb = await mp.locator('.kchip2').first().boundingBox();
    ok(h && h.height >= 40 && kb && kb.height >= 36, `16. ${name}: store trykkflater (${Math.round(h?.height)} / ${Math.round(kb?.height)} px)`);
    await mp.screenshot({ path: `${dir}/v5-${name.replace(' ', '-')}-dag.png`, fullPage: false });
    await go(mp, 'Kart & rute'); await mp.waitForTimeout(800);
    await mp.screenshot({ path: `${dir}/v5-${name.replace(' ', '-')}-oversikt.png` });
    ok(merr.length === 0, `16. ${name}: ingen JS-feil`);
    await c.close();
  }
  console.log(fail ? `${fail} FEIL` : 'ALLE V5-TESTER OK');
  await b.close();
})();
