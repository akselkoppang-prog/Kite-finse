import { cumulative, dirName, pointAt } from '../geo';
import { cachedElevation } from '../api/kartverket';
import { hhmm } from '../sim/expedition';
import { hourOf } from '../sun';
import { KITES } from '../../data/kites';
import { runPlan } from '../plan/context';
import { kiteName, compareRows } from '../plan/compare';
import { STATUS_TEXT } from '../project/meta';
import { gearListOf } from '../plan/context';
import { assumedKg } from '../project/model';
import type { ExportSnapshot } from './snapshot';
import type { Sheet, Cell } from './table';

const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Klokkeslett når du forventes å passere en avstand langs ruten (fra simuleringen), eller null. */
export function passTime(snap: ExportSnapshot, d: number): { day: number; time: string } | null {
  for (const day of snap.run.days) {
    if (d < day.startD - 1 || d > day.endD + 1) continue;
    const leg = day.result.legs.find((l) => d >= l.d0 && d <= l.d1);
    if (!leg) return { day: day.day, time: d <= day.startD + 1 ? hhmm(day.departure) : hhmm(day.arrival) };
    const t = leg.t0 + ((leg.t1 - leg.t0) * (d - leg.d0)) / Math.max(1, leg.d1 - leg.d0);
    return { day: day.day, time: hhmm(hourOf(new Date(t))) };
  }
  return null;
}

export function overviewSheet(snap: ExportSnapshot): Sheet {
  const { st, run, summary, stats } = snap;
  const p = st.project;
  const rows: Cell[][] = [
    ['Prosjekt', p.name],
    ['Beskrivelse', p.description],
    ['Fra – til', `${p.origin} – ${p.destination}`],
    ['Status', STATUS_TEXT[p.status]],
    ['Startdato', fmtDate(st.tripDate)],
    ['Sluttdato', fmtDate(snap.endDate)],
    ['Scenario', `${run.plan.name}${run.plan.id === st.mainPlanId ? ' (hovedplan)' : ''}`],
    ['Rute', snap.route?.name ?? '–'],
    ['Distanse (km)', +summary.totalKm.toFixed(2)],
    ['Stigning (m)', Math.round(stats.up)],
    ['Fall (m)', Math.round(stats.down)],
    ['Høyeste punkt (moh)', stats.hi != null ? Math.round(stats.hi) : '–'],
    ['Høydedata', stats.src],
    ['Antall dager', summary.days],
    ['Forventet ankomst', summary.doneDay ? `Dag ${summary.doneDay.day} (${fmtDate(summary.doneDay.date)}) kl. ${hhmm(summary.doneDay.arrival)}` : `Når ikke frem – ${summary.remainingKm.toFixed(1)} km igjen`],
    ['Sum kitetid (t)', +summary.movingH.toFixed(1)],
    ['Kroppsvekt (kg)', st.riderKg],
    ['Pulk (kg)', st.pulkKg],
    ['Kites med', (st.quivers.find((q) => q.id === st.activeQuiverId)?.kiteIds ?? []).map(kiteName).join(', ')],
    ['Generert', new Date(snap.generatedAt).toLocaleString('nb-NO')],
    ['Merk', 'Planlagte verdier og simuleringer – ikke verifisert i terrenget og ikke værmelding med mindre det står «prognose».'],
  ];
  return { name: 'Oversikt', header: ['Felt', 'Verdi'], rows, widths: [26, 90] };
}

export function itinerarySheet(snap: ExportSnapshot): Sheet {
  const { run, st } = snap;
  const rows = run.days.map((d, i) => {
    const p = run.plan.days[i];
    const camp = st.camps.find((c) => c.id === p?.campId);
    const reserve = d.reason.startsWith('allerede');
    return [d.day, fmtDate(d.date), reserve ? 'Reservedag' : 'Reise', +(d.startD / 1000).toFixed(2), +(d.endD / 1000).toFixed(2), reserve ? 0 : +((d.endD - d.startD) / 1000).toFixed(2), hhmm(d.departure), reserve ? '–' : hhmm(d.arrival), reserve ? '–' : `${hhmm(d.rangeArrival[0])}–${hhmm(d.rangeArrival[1])}`, p?.activeH, p?.breakH, p?.speedKmh, kiteName(d.kiteId) + (d.kiteAuto ? ' (auto)' : ''), dirName(p?.wind.dir ?? 0), p?.wind.dir, p?.wind.avg, p?.wind.min, p?.wind.max, p?.wind.gust, d.windSource, hhmm(d.sunrise), hhmm(d.sunset), d.daylightLeftH != null ? +d.daylightLeftH.toFixed(1) : null, +d.remainingKm.toFixed(2), camp?.name ?? '', p?.note ?? '', d.issues.join(' | ')] as Cell[];
  });
  return {
    name: 'Dagsplan',
    header: ['Dag', 'Dato', 'Type', 'Fra km', 'Til km', 'Distanse km', 'Avreise', 'Ankomst', 'Ankomst usikkerhet', 'Aktive timer', 'Pauser t', 'Fart km/t', 'Kite', 'Vind fra', 'Vind fra (°)', 'Snittvind m/s', 'Min m/s', 'Maks m/s', 'Kast m/s', 'Vindkilde', 'Soloppgang', 'Solnedgang', 'Dagslys igjen t', 'Igjen km', 'Teltplass', 'Notat', 'Merknader'],
    rows,
    formats: ['int', null, null, 'km', 'km', 'km', null, null, null, 'dec1', 'dec1', 'int', null, null, 'int', 'dec1', 'dec1', 'dec1', 'dec1', null, null, null, 'dec1', 'km', null, null, null],
  };
}

/** Sjekkpunkter hver 5. km + navngitte punkter, med forventet passeringstid. */
export function checkpointSheet(snap: ExportSnapshot, everyKm = 5): Sheet {
  const r = snap.route;
  if (!r) return { name: 'Sjekkpunkter', header: ['Ingen rute'], rows: [] };
  const cum = cumulative(r.waypoints);
  const total = cum[cum.length - 1];
  const ds = new Map<number, string>();
  for (let d = 0; d < total; d += everyKm * 1000) ds.set(Math.round(d), `${(d / 1000).toFixed(0)} km`);
  ds.set(Math.round(total), 'Mål');
  r.waypoints.forEach((w, i) => w.name && ds.set(Math.round(cum[i]), w.name));
  const rows = [...ds.entries()].sort((a, b) => a[0] - b[0]).map(([d, name]) => {
    const p = pointAt(r.waypoints, cum, d);
    const z = cachedElevation(p)?.z ?? snap.profile.reduce((b, x) => (Math.abs(x.d - d) < Math.abs(b.d - d) ? x : b), snap.profile[0] ?? { d: 0, z: null }).z;
    const t = passTime(snap, d);
    return [name, +(d / 1000).toFixed(2), p.lat, p.lon, z != null ? Math.round(z) : null, t ? t.day : null, t?.time ?? ''] as Cell[];
  });
  return { name: 'Sjekkpunkter', header: ['Punkt', 'Km', 'Breddegrad', 'Lengdegrad', 'Høyde moh', 'Dag', 'Forventet passering'], rows, formats: [null, 'km', 'coord', 'coord', 'int', 'int', null] };
}

export function waypointSheet(snap: ExportSnapshot, allRoutes = false): Sheet {
  const routes = allRoutes ? snap.st.routes : snap.route ? [snap.route] : [];
  const rows: Cell[][] = [];
  routes.forEach((r) => {
    const cum = cumulative(r.waypoints);
    r.waypoints.forEach((w, i) => rows.push(['Rutepunkt', r.name, i + 1, w.name ?? '', +(cum[i] / 1000).toFixed(2), w.lat, w.lon, w.eleGpx ?? cachedElevation(w)?.z ?? null, w.category ?? '', w.description ?? '', w.notes ?? '', w.verification ?? 'uverifisert', w.source]));
  });
  snap.st.markers.forEach((m, i) => rows.push(['Markør', '', i + 1, m.name, null, m.lat, m.lon, null, m.category, m.description ?? '', m.notes ?? '', m.verification ?? 'uverifisert', m.source]));
  return { name: 'Rutepunkter', header: ['Type', 'Rute', 'Nr', 'Navn', 'Km', 'Breddegrad', 'Lengdegrad', 'Høyde moh', 'Kategori', 'Beskrivelse', 'Notater', 'Status', 'Kilde'], rows, formats: [null, null, 'int', null, 'km', 'coord', 'coord', 'int', null, null, null, null, null] };
}

export function campSheet(snap: ExportSnapshot): Sheet {
  const { st, run } = snap;
  const rows = st.camps.map((c) => {
    const di = run.plan.days.findIndex((d) => d.campId === c.id);
    return [c.name, c.lat, c.lon, cachedElevation(c)?.z ?? null, di >= 0 ? `Etter dag ${di + 1}` : '', di >= 0 ? hhmm(run.days[di]?.arrival) : '', c.role === 'foretrukket' ? 'Foretrukket' : c.role === 'reserve' ? 'Reserve' : '', c.description ?? '', c.assessment ?? '', c.notes ?? c.note ?? '', c.approved ? 'Godkjent av deg (ikke verifisert)' : 'Ikke vurdert', c.source] as Cell[];
  });
  return { name: 'Teltplasser', header: ['Navn', 'Breddegrad', 'Lengdegrad', 'Høyde moh', 'Overnatting', 'Forventet ankomst', 'Rolle', 'Beskrivelse', 'Din vurdering', 'Notater', 'Status', 'Kilde'], rows, formats: [null, 'coord', 'coord', 'int', null, null, null, null, null, null, null, null] };
}

/** Vind per dag for alle scenarioer (eller bare det valgte). */
export function windSheet(snap: ExportSnapshot, allScenarios = true): Sheet {
  const plans = allScenarios ? snap.st.plans : [snap.run.plan];
  const rows: Cell[][] = [];
  plans.forEach((p) =>
    p.days.forEach((d, i) => rows.push([p.name + (p.id === snap.st.mainPlanId ? ' ★' : ''), i + 1, d.windMode === 'manuell' ? 'Eget scenario (ikke prognose)' : d.windMode === 'prognose' ? 'MET-prognose' : 'Prognose + justering', dirName(d.wind.dir), d.wind.dir, d.wind.avg, d.wind.min, d.wind.max, d.wind.gust, Math.round(d.wind.variability * 100) / 100, d.wind.favorableH, d.kiteId === 'auto' ? 'Auto' : kiteName(d.kiteId)])),
  );
  return { name: 'Vindscenarioer', header: ['Scenario', 'Dag', 'Kilde', 'Vind fra', 'Retning (°)', 'Snitt m/s', 'Min m/s', 'Maks m/s', 'Kast m/s', 'Variasjon', 'Timer med vinden', 'Kite'], rows, formats: [null, 'int', null, null, 'int', 'dec1', 'dec1', 'dec1', 'dec1', 'dec1', 'dec1', null] };
}

export function kiteSheet(snap: ExportSnapshot): Sheet {
  const st = snap.st;
  const q = st.quivers.find((x) => x.id === st.activeQuiverId);
  const used = new Set(snap.run.days.map((d) => d.kiteId));
  const rows = KITES.filter((k) => q?.kiteIds.includes(k.id)).map((k) => {
    const o = st.kiteOverrides[k.id];
    return [k.name, k.size, k.type, k.maker, used.has(k.id) ? 'Ja' : 'Nei', o ? `${o.low}–${o.high} m/s (ditt eget)` : 'Modell', k.role, st.kiteNotes?.[k.id] ?? ''] as Cell[];
  });
  return { name: 'Kites', header: ['Kite', 'Størrelse m²', 'Type', 'Produsent', 'Brukt i scenarioet', 'Vindvindu', 'Rolle', 'Dine notater'], rows, formats: [null, 'dec1', null, null, null, null, null, null] };
}

export function assumptionSheet(snap: ExportSnapshot): Sheet {
  const st = snap.st;
  const p = st.simParams;
  const rows: Cell[][] = [
    ['Kroppsvekt', st.riderKg, 'kg'],
    ['Pulk', st.pulkKg, 'kg'],
    ['Ekstra utstyr på kroppen', p.extraKg, 'kg'],
    ['Snøforhold', String(st.snow), ''],
    ['Temperatur (luftetthet)', p.tempC, '°C'],
    ['Komfortfart (maks)', p.comfortKmh, 'km/t'],
    ['Sidedrag pulk/skrens (λ)', p.groundDragDeg, 'grader'],
    ['Stagvending', p.tackSec, 's'],
    ['Kitebytte', p.kiteChangeMin, 'min'],
    ['Ski uten kite', p.skiKmh, 'km/t'],
    ['Gå bratt med pulk', p.walkSteepKmh, 'km/t'],
    ['Oppskyting/landing', st.travel.launchMin, 'min'],
    ['Navigasjon/drikke', st.travel.navMinPerHour, 'min per time'],
    ['Personlig kalibrering', p.usePersonalCalibration ? 'På' : 'Av', ''],
    ['Dagens slutt', 'Borgerlig skumring', ''],
    ['Metode', 'Fysisk modell (luftetthet, vindprofil, kitekraft, glid, friksjon) per 500 m, én kite om gangen, usikkerhet fra vindvariasjon. Se «Modell og kalibrering» i appen.', ''],
  ];
  return { name: 'Forutsetninger', header: ['Forutsetning', 'Verdi', 'Enhet'], rows, widths: [32, 70, 14] };
}

export function routeCoordSheet(snap: ExportSnapshot): Sheet {
  const r = snap.route;
  if (!r) return { name: 'Rutekoordinater', header: ['Ingen rute'], rows: [] };
  const cum = cumulative(r.waypoints);
  return { name: 'Rutekoordinater', header: ['Nr', 'Breddegrad', 'Lengdegrad', 'Høyde GPX', 'Km', 'Navn'], rows: r.waypoints.map((w, i) => [i + 1, w.lat, w.lon, w.eleGpx ?? null, +(cum[i] / 1000).toFixed(3), w.name ?? '']), formats: ['int', 'coord', 'coord', 'dec1', 'km', null] };
}

export function compareSheet(snap: ExportSnapshot, ids: string[]): Sheet {
  const runs = ids.map((id) => snap.st.plans.find((p) => p.id === id)).filter(Boolean).map((p) => runPlan(snap.st, p!));
  return compareFromRuns(runs, snap);
}
function compareFromRuns(runs: ReturnType<typeof runPlan>[], snap: ExportSnapshot): Sheet {
  const rows = compareRows(runs, snap.st.camps, snap.st.project.destination, snap.st);
  return { name: 'Sammenligning', header: ['', ...runs.map((r) => r.plan.name)], rows: rows.map((r) => [r.label, ...r.values]), widths: [22, ...runs.map(() => 45)] };
}

export function nightsSheet(snap: ExportSnapshot): Sheet {
  const rows = snap.insights.nights.map((n) => [n.night, fmtDate(n.date), n.camp?.name ?? 'ikke valgt', n.camp?.kind ?? '', n.camp?.capacity ?? null, +n.distFromPrevKm.toFixed(2), hhmm(n.arrival), n.camp?.resupply ? 'ja' : '', n.camp?.costPerPerson ?? null, n.issues.join(' | ')] as Cell[]);
  return { name: 'Netter', header: ['Natt', 'Dato', 'Sted', 'Type', 'Plasser', 'Dagsetappe km', 'Ankomst', 'Påfyll', 'kr/person', 'Merknader'], rows, formats: ['int', null, null, null, 'int', 'km', null, null, 'int', null] };
}

export function gearSheet(snap: ExportSnapshot): Sheet {
  const list = gearListOf(snap.st, snap.run.plan);
  const owner = (id?: string) => (id && id !== 'felles' ? snap.st.team.find((m) => m.id === id)?.name ?? '' : 'felles');
  const rows = (list?.items ?? []).map((g) => [g.cat, g.name, g.qty, g.kg ?? null, assumedKg(g) ?? null, (assumedKg(g) ?? 0) * g.qty, g.carry, owner(g.owner), g.packed ? 'ja' : 'nei', g.ratingC ?? null, g.capacity ?? null] as Cell[]);
  return { name: 'Utstyr', header: ['Kategori', 'Utstyr', 'Antall', 'Vekt kg (din)', 'Vekt kg (brukt)', 'Sum kg', 'Bæres', 'Eier', 'Pakket', 'Komfort °C', 'Personer'], rows, formats: [null, null, 'int', 'dec1', 'dec1', 'dec1', null, null, null, 'int', 'int'] };
}

export function foodSheet(snap: ExportSnapshot): Sheet {
  const f = snap.insights.food;
  const rows = f.perDay.map((n, i) => [i < f.days ? `Dag ${i + 1}` : `Reserve ${i - f.days + 1}`, Math.round(n.kcal), Math.round(f.target), Math.round(n.protein), Math.round(n.fat), Math.round(n.carbs), Math.round(n.g), i < f.days ? +(f.remainingKgByDay[i] ?? 0).toFixed(2) : null] as Cell[]);
  return { name: 'Mat', header: ['Dag', 'kcal/person', 'Behov kcal', 'Protein g', 'Fett g', 'Karbo g', 'Vekt g/person', 'Mat igjen kg (gruppen)'], rows, formats: [null, 'int', 'int', 'int', 'int', 'int', 'int', 'dec1'] };
}

export function shoppingSheet(snap: ExportSnapshot): Sheet {
  return { name: 'Handleliste', header: ['Vare', 'Gram', 'Pakninger', 'g per pakning'], rows: snap.insights.food.shopping.map((x) => [x.food.name, Math.round(x.g), x.packs, x.food.packG ?? null]), formats: [null, 'int', 'int', 'int'] };
}

export function tasksSheet(snap: ExportSnapshot): Sheet {
  const st = snap.st;
  return { name: 'Oppgaver', header: ['Oppgave', 'Ferdig', 'Frist', 'Ansvarlig', 'Prioritet', 'Milepæl', 'Scenario'], rows: st.tasks.map((t) => [t.title, t.done ? 'ja' : 'nei', t.due ?? '', st.team.find((m) => m.id === t.assignee)?.name ?? '', t.priority ?? '', t.milestone ? 'ja' : '', st.plans.find((p) => p.id === t.scenarioId)?.name ?? '']) };
}

export function workbook(snap: ExportSnapshot, compareIds: string[] = []): Sheet[] {
  const sh = [overviewSheet(snap), itinerarySheet(snap), nightsSheet(snap), checkpointSheet(snap), waypointSheet(snap, true), campSheet(snap), windSheet(snap), kiteSheet(snap), gearSheet(snap), foodSheet(snap), shoppingSheet(snap), tasksSheet(snap), assumptionSheet(snap)];
  if (compareIds.length > 1) sh.push(compareSheet(snap, compareIds));
  return sh;
}
