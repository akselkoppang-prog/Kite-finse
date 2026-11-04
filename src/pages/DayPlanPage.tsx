import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { useActiveRoute, useBarrierCheck, useDayPlan, useProfile, useTerrain } from '../state/derived';
import { campCandidates } from '../lib/analysis/camps';
import { daysNeeded, equalBreaks, legTimes, DEFAULT_PARAMS, DEFAULT_SCENARIOS, type TravelParams, type Scenario } from '../lib/analysis/feasibility';
import { windLegs, scoreColor } from '../lib/analysis/wind';
import { cumulative, fmtCoord, fmtKm, haversine, nearestOnRoute, pointAt, uid } from '../lib/geo';
import { categoryOf } from '../data/categories';
import { fmtClock } from '../lib/sun';
import { DaylightBar } from '../components/Trip';
import { Badge, Card, Kind } from '../components/ui';
import { useSimSetup } from '../state/sim';

const hm = (h: number) => `${Math.floor(h)} t ${String(Math.round((h % 1) * 60)).padStart(2, '0')} min`;
const clock = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

const PARAM_LABELS: [keyof TravelParams, string, number][] = [
  ['reachKmh', 'Fremdrift slør/halvvind (km/t)', 0.5],
  ['broadKmh', 'Fremdrift bredslør (km/t)', 0.5],
  ['closeKmh', 'Fremdrift kryss høyt (km/t langs ruten)', 0.5],
  ['upwindVmgKmh', 'Motvind: fremdrift langs ruten (VMG)', 0.5],
  ['downwindVmgKmh', 'Rett medvind: fremdrift (VMG)', 0.5],
  ['skiKmh', 'Ski med pulk uten kite (km/t)', 0.1],
  ['walkSteepKmh', 'Bratt/nedstigning med pulk (km/t)', 0.1],
  ['launchMin', 'Min per oppskyting + landing', 1],
  ['launchesPerDay', 'Oppskytinger per dag', 1],
  ['navMinPerHour', 'Navigasjon/pauser (min per time)', 1],
  ['fatiguePctPerDay', 'Tretthet (% tregere per dag)', 1],
  ['startHour', 'Planlagt start (klokke)', 0.25],
  ['campSetupH', 'Leir før mørket (timer)', 0.25],
  ['maxMovingH', 'Maks reisetid per dag (timer)', 0.5],
];

export default function DayPlanPage() {
  const s = useStore();
  const route = useActiveRoute();
  const { profile } = useProfile(route);
  const terrain = useTerrain(route);
  const check = useBarrierCheck(route);
  const plan = useDayPlan(route);
  const setup = useSimSetup();
  const physDays = useMemo(() => plan.days.map((d) => setup.run({ fromD: d.d0, toD: d.d1, startDate: d.date, startHour: s.sim.startHour, maxDays: 1 })), [plan.days, setup, s.sim.startHour]);
  const [dragD, setDragD] = useState<number | null>(null);
  const sc = s.scenarios.find((x) => x.id === s.scenarioId)!;
  const places = Object.values(s.places);
  const wps = route?.waypoints ?? [];
  const cum = useMemo(() => cumulative(wps), [wps]);

  const checkpoints = useMemo(() => {
    if (!route) return [];
    const fromWps = route.waypoints.map((w, i) => ({ id: w.id, name: w.name ?? categoryOf(w.category, s.customCategories)?.label ?? `Punkt ${i + 1}`, d: cum[i], icon: categoryOf(w.category, s.customCategories)?.icon ?? '📍', desc: w.description, has: !!(w.name || w.category) })).filter((x) => x.has);
    const fromMarkers = s.markers.map((m) => ({ m, n: nearestOnRoute(route.waypoints, m) })).filter((x) => x.n.dist < 3000).map(({ m, n }) => ({ id: m.id, name: m.name, d: n.d, icon: categoryOf(m.category, s.customCategories)?.icon ?? '📝', desc: m.description, has: true }));
    return [...fromWps, ...fromMarkers].sort((a, b) => a.d - b.d);
  }, [route, s.markers, s.customCategories, cum]);

  if (!route) return <div className="page"><Card title="Dagplan"><p>Ingen aktiv rute.</p></Card></div>;

  const setBreaks = (b: number[], text: string) => {
    s.setDayBreaks(route.id, b);
    s.log('rute', text);
  };
  const moveToDay = (cpD: number, k: number) => {
    const cur = plan.days.findIndex((d) => cpD >= d.d0 && cpD <= d.d1);
    if (cur < 0 || cur === k) return;
    const nb = [...plan.breaks];
    if (k === cur - 1) nb[k] = Math.min(cpD + 50, plan.total - 10); // flytt til slutten av forrige dag
    else if (k === cur + 1) nb[cur] = Math.max(cpD - 50, 10); // flytt til starten av neste dag
    else return;
    setBreaks(nb, `Flyttet sjekkpunkt ved ${(cpD / 1000).toFixed(1)} km til dag ${k + 1}`);
    setDragD(null);
  };
  const dropOnDay = (e: React.DragEvent, k: number) => {
    e.preventDefault();
    const v = Number(e.dataTransfer.getData('text/plain'));
    const cpD = Number.isFinite(v) && e.dataTransfer.getData('text/plain') !== '' ? v : dragD;
    if (cpD != null) moveToDay(cpD, k);
  };
  const setScenario = (patch: Partial<Scenario>) => s.set({ scenarios: s.scenarios.map((x) => (x.id === sc.id ? { ...x, ...patch } : x)) });
  const modelBreaks = () => {
    const legs = windLegs(route.waypoints, s.windFrom, 500, terrain?.samples);
    const lt = legTimes(legs, s.travel, sc, plan.walkRanges, plan.pulkFactor);
    const avail = (day: number) => {
      const d = plan.days[Math.min(day - 1, plan.days.length - 1)];
      return d ? Math.min(s.travel.maxMovingH + sc.downtimeH, ((d.sun.civilDusk ? d.startH + (d.civilLeftH ?? 0) + d.totalH : 18) - d.startH) - s.travel.campSetupH) : s.travel.maxMovingH;
    };
    const r = daysNeeded(lt, s.travel, sc, avail);
    s.set({ tripDays: r.days });
    setBreaks(r.breaks, `Fordelte dagene etter modell (scenario ${sc.id}): ${r.days} dager`);
  };
  const near = (p: { lat: number; lon: number }) => places.map((pl) => ({ pl, km: haversine(p, pl) / 1000 })).sort((a, b) => a.km - b.km)[0];
  const exits = (p: { lat: number; lon: number }) => [
    ...places.filter((pl) => pl.role.includes('avbrudd') || pl.role.includes('transport')).map((pl) => ({ name: pl.name, km: haversine(p, pl) / 1000, kind: pl.type })),
    ...s.markers.filter((m) => m.category === 'exit' || m.category === 'pickup').map((m) => ({ name: m.name, km: haversine(p, m) / 1000, kind: m.category === 'exit' ? 'nødutgang (din)' : 'henteplass (din)' })),
  ].sort((a, b) => a.km - b.km).slice(0, 3);

  return (
    <div className="page">
      <Card title="Grovmodell – hvor mange dager? (andel brukbar vind)" className="wide" right={<Kind k="beregnet" />}>
        <p className="small note">Dette er den enkle scenariomodellen. Den fysikkbaserte simuleringen (kite, vindretning og -styrke, kryss, time-for-time-vind) ligger i <button className="link" onClick={() => s.setTab('simulator')}>Ytelsessimulator</button> og vises også per dag under.</p>
        <p className="small">Målet er <b>3 dager</b>. Modellen regner fremdrift langs ruten etappe for etappe ut fra kurs mot vind fra <b>{s.windFrom}</b> (endres i Vær & vind), andel brukbar vind, gåstrekk (bratt terreng og sluttnedstigning), oppskytinger, navigasjon, værstans, tretthet og dagslys.</p>
        <div className="scen">
          {s.scenarios.map((x) => {
            const r = plan.scenarioDays.find((y) => y.id === x.id);
            return (
              <button key={x.id} className={`scen-card ${s.scenarioId === x.id ? 'on' : ''}`} onClick={() => s.set({ scenarioId: x.id })}>
                <div className="scen-h">{x.id}. {x.name}</div>
                <div className="small">{x.text}</div>
                <div className="big">{r ? `${r.totalDays} dag${r.totalDays === 1 ? '' : 'er'}` : '–'}</div>
                <div className="small">{Math.round(x.usableWind * 100)} % brukbar vind · snø ×{x.snowFactor} · sikt ×{x.visFactor} · {x.downtimeH} t værstans/dag{x.restDays ? ` · ${x.restDays} liggedag` : ''}</div>
                <div className="small"><b>{r && r.totalDays <= 3 ? 'Tre dager er innenfor modellen' : r && r.totalDays === 4 ? 'Krever trolig én ekstra dag' : 'Plan B: lengre tur eller tidlig avbrudd'}</b></div>
              </button>
            );
          })}
        </div>
        <details className="small">
          <summary>Juster scenario {sc.id} og reiseparametre</summary>
          <div className="form">
            <label>Brukbar vind (andel av distansen) {Math.round(sc.usableWind * 100)} %<input id="sc-usable" type="range" min={0} max={1} step={0.05} value={sc.usableWind} onChange={(e) => setScenario({ usableWind: +e.target.value })} /></label>
            <label>Snøfaktor ×{sc.snowFactor}<input id="sc-snow" type="range" min={0.5} max={1.1} step={0.05} value={sc.snowFactor} onChange={(e) => setScenario({ snowFactor: +e.target.value })} /></label>
            <label>Sikt/navigasjon ×{sc.visFactor}<input id="sc-vis" type="range" min={0.5} max={1} step={0.05} value={sc.visFactor} onChange={(e) => setScenario({ visFactor: +e.target.value })} /></label>
            <label>Værstans {sc.downtimeH} t/dag<input id="sc-down" type="range" min={0} max={6} step={0.5} value={sc.downtimeH} onChange={(e) => setScenario({ downtimeH: +e.target.value })} /></label>
            <label>Liggedager<input id="sc-rest" type="number" min={0} max={5} value={sc.restDays} onChange={(e) => setScenario({ restDays: +e.target.value })} /></label>
          </div>
          <div className="form">
            {PARAM_LABELS.map(([k, label, step]) => (
              <label key={k}>{label}<input id={`tp-${k}`} type="number" step={step} value={s.travel[k]} onChange={(e) => s.set({ travel: { ...s.travel, [k]: +e.target.value } })} /></label>
            ))}
          </div>
          <button className="btn small ghost" onClick={() => s.set({ travel: DEFAULT_PARAMS, scenarios: DEFAULT_SCENARIOS })}>Tilbakestill til standard</button>
          <p className="muted">Standardverdiene er antagelser for en erfaren kiter med ~40 kg pulk. Pulkfaktor nå: ×{plan.pulkFactor.toFixed(2)} ({s.riderKg + s.pulkKg} kg). Kalibrer mot egne GPS-logger.</p>
        </details>
        <div className="note small">
          Fremdrift er <b>ikke</b> det samme som kitefart: på motvindsstrekk regner modellen kun fremdrift langs ruten (VMG), og medvind krever jibber. Gåstrekk i modellen: {plan.walkRanges.length ? plan.walkRanges.map(([a, b]) => `${(a / 1000).toFixed(1)}–${(b / 1000).toFixed(1)} km`).join(', ') : 'ingen funnet (kjør terrenganalyse)'}.
        </div>
      </Card>

      <Card
        title={`Dagsetapper – ${s.tripDays} dager fra ${s.tripDate} (scenario ${sc.id})`}
        className="wide"
        right={
          <div className="row">
            <select id="dp-days" value={s.tripDays} onChange={(e) => { s.set({ tripDays: +e.target.value }); setBreaks(equalBreaks(plan.total, +e.target.value), `Antall dager satt til ${e.target.value}`); }}>
              {[2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n} dager</option>)}
            </select>
            <button className="btn small" onClick={() => setBreaks(equalBreaks(plan.total, s.tripDays), 'Lik fordeling av dagene')}>Lik fordeling</button>
            <button className="btn small" onClick={modelBreaks}>Fordel etter modell</button>
          </div>
        }
      >
        <p className="small muted">Dra et sjekkpunkt til nabodagen (eller trykk ◀ ▶) for å flytte dagsskiftet, eller dra 🏁-flaggene i kartet. Dager kan utvides fra 3 til 7 uten å endre ruten.</p>
        <div className="days">
          {plan.days.map((d, i) => {
            const p0 = pointAt(wps, cum, d.d0), p1 = pointAt(wps, cum, d.d1);
            const cps = checkpoints.filter((c) => c.d >= d.d0 && c.d < d.d1 + 1);
            const prof = profile.filter((p) => p.d >= d.d0 && p.d <= d.d1 && p.z != null);
            const zs = prof.map((p) => p.z!);
            const zmin = Math.min(...zs), zmax = Math.max(...zs);
            const path = prof.map((p, k) => `${k ? 'L' : 'M'}${(((p.d - d.d0) / Math.max(1, d.d1 - d.d0)) * 300).toFixed(1)},${(60 - ((p.z! - zmin) / Math.max(1, zmax - zmin)) * 56 - 2).toFixed(1)}`).join(' ');
            const cands = terrain && i < plan.days.length - 1 ? campCandidates(terrain.samples, d.d1, 5000, s.windFrom, check.barriers, places, 2) : [];
            const cross = check.crossings.filter((c) => c.fromD < d.d1 && c.toD > d.d0);
            const late = d.civilLeftH != null && d.civilLeftH < s.travel.campSetupH;
            const key = `${route.id}:${d.day}`;
            return (
              <div key={d.day} className={`daycard ${dragD != null ? 'droppable' : ''}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => dropOnDay(e, i)}>
                <h4>Dag {d.day} · {d.date}</h4>
                <div className="small">
                  <b>{near(p0)?.pl.name ?? fmtCoord(p0)}</b> → <b>{near(p1)?.pl.name ?? fmtCoord(p1)}</b> <span className="muted">(nærmeste kjente sted)</span>
                </div>
                <div className="small mono muted">{fmtCoord(p0)} → {fmtCoord(p1)}</div>
                <div className="kv small">
                  <span>Distanse</span><b>{fmtKm(d.d1 - d.d0)} <span className="muted">({d.kmKite.toFixed(0)} km kite / {d.kmSki.toFixed(0)} km ski/gå)</span></b>
                  <span>Kitetid</span><b>{hm(d.kiteH)}</b>
                  <span>Ski/gåtid</span><b>{hm(d.skiH)}</b>
                  <span>Oppskyting/navigasjon</span><b>{hm(d.overheadH)}</b>
                  <span>Forventet værstans</span><b>{hm(d.downtimeH)}</b>
                  <span>Total</span><b>{hm(d.totalH)} · {clock(d.startH)}–{clock(d.endH)}</b>
                  <span>Sol</span><b>opp {fmtClock(d.sun.sunrise)} · ned {fmtClock(d.sun.sunset)} · borgerlig skumring {fmtClock(d.sun.civilDusk)}</b>
                  <span>Dagslys igjen ved ankomst</span><b className={late ? 'err' : ''}>{d.daylightLeftH != null ? `${d.daylightLeftH >= 0 ? '' : '−'}${hm(Math.abs(d.daylightLeftH))} til solnedgang` : '–'}{late ? ' – for lite tid til leir' : ''}</b>
                  <span>Fysikkmodell ({s.sim.manual.avg} m/s fra {s.sim.manual.dir}°)</span>
                  <b>{physDays[i] ? (physDays[i]!.reachedD >= d.d1 - 50 ? `${hm((physDays[i]!.end - physDays[i]!.start) / 3600000)} · ankomst ${fmtClock(new Date(physDays[i]!.end))}` : <span className="err">rekker {((physDays[i]!.reachedD - d.d0) / 1000).toFixed(1)} av {((d.d1 - d.d0) / 1000).toFixed(1)} km før mørket</span>) : '–'}</b>
                  <span>Kiteforhold ({s.windFrom})</span><b><span className="dot" style={{ background: scoreColor(d.windScore) }}>{Math.round(d.windScore * 100)}</span> beregnet kurs-egnethet</b>
                </div>
                <DaylightBar sun={d.sun} startH={d.startH} endH={d.endH} />
                {prof.length > 1 && (
                  <svg viewBox="0 0 300 60" className="spark" preserveAspectRatio="none" aria-label={`Høydeprofil dag ${d.day}: ${Math.round(zmin)}–${Math.round(zmax)} moh`}>
                    <path d={`${path} L300,60 L0,60 Z`} className="spark-fill" />
                    <path d={path} className="spark-line" />
                  </svg>
                )}
                {prof.length > 1 && <div className="small muted">{Math.round(zmin)}–{Math.round(zmax)} moh</div>}
                {cross.length > 0 && <div className="small">{cross.map((c) => <div key={c.barrier.id}><Badge s={c.blocking ? 'RØD' : c.label === 'BRUKERGODKJENT' ? 'BRUKER' : 'GUL'}>{c.label}</Badge> {c.barrier.name}</div>)}</div>}
                <div className="small"><b>Sjekkpunkter</b></div>
                <div className="cps">
                  {cps.length === 0 && <span className="small muted">Ingen – legg til i kartet</span>}
                  {cps.map((c) => (
                    <div key={c.id} className="cp" draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(c.d)); e.dataTransfer.effectAllowed = 'move'; setDragD(c.d); }} onDragEnd={() => setDragD(null)} title={c.desc ?? ''}>
                      {i > 0 && <button className="link" onClick={() => moveToDay(c.d, i - 1)} aria-label={`Flytt ${c.name} til dag ${i}`}>◀</button>}
                      {c.icon} {c.name} <span className="muted">{(c.d / 1000).toFixed(1)} km</span>
                      {i < plan.days.length - 1 && <button className="link" onClick={() => moveToDay(c.d, i + 1)} aria-label={`Flytt ${c.name} til dag ${i + 2}`}>▶</button>}
                    </div>
                  ))}
                </div>
                {i < plan.days.length - 1 && (
                  <>
                    <div className="small"><b>Leir natt {d.day}</b> {!terrain && <span className="warn">(kjør terrenganalyse for kandidater)</span>}</div>
                    {cands.map(({ s: c, ev }, k) => (
                      <div key={k} className="campcard">
                        <b>{k === 0 ? 'Foreslått' : 'Alternativ'}</b> <Badge s="GUL">beregnet – ikke befart</Badge>
                        <div className="mono">{fmtCoord(c)} · {fmtKm(c.d)} · {ev.z != null ? `${Math.round(ev.z)} moh` : ''}</div>
                        <div>{ev.exposure} · skred: {ev.avalanche.level} · {ev.waterText}</div>
                        {ev.flags.map((f) => <div key={f} className="warn">{f}</div>)}
                        <div className="btns">
                          <button className="btn small" onClick={() => s.focusOn(c.lat, c.lon, 14)}>Vis</button>
                          <button className="btn small" onClick={() => s.set({ camps: [...s.camps, { id: uid('camp'), lat: c.lat, lon: c.lon, name: `Leir ${d.day}${k ? 'B' : 'A'}`, night: d.day, source: 'beregnet kandidat' }] })}>Legg til</button>
                        </div>
                      </div>
                    ))}
                    {s.camps.filter((c) => c.night === d.day).map((c) => (
                      <div key={c.id} className="campcard">
                        ⛺ <b>{c.name}</b> ({c.source}) {c.approved ? <Badge s="BRUKER" /> : <Badge s="GRÅ">ikke godkjent</Badge>}
                        <div className="btns">
                          <button className="btn small" onClick={() => s.set({ camps: s.camps.map((x) => (x.id === c.id ? { ...x, approved: !x.approved } : x)) })}>{c.approved ? 'Fjern godkjenning' : 'Godkjenn (mitt valg)'}</button>
                          <button className="btn small ghost" onClick={() => s.focusOn(c.lat, c.lon, 14)}>Vis</button>
                          <button className="btn small danger" onClick={() => s.set({ camps: s.camps.filter((x) => x.id !== c.id) })}>Fjern</button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
                <div className="small"><b>Nødutganger nær dagsslutt</b>: {exits(p1).map((x) => `${x.name} ${x.km.toFixed(1)} km (${x.kind})`).join(' · ') || 'hent stedsnavn / legg til egne'}</div>
                <textarea id={`dn-${d.day}`} rows={2} placeholder="Personlige notater for dagen" value={s.dayNotes[key] ?? ''} onChange={(e) => s.set({ dayNotes: { ...s.dayNotes, [key]: e.target.value } })} />
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Plan B – forlenge eller avbryte" className="wide">
        <ul className="small">
          <li><b>Forlenge:</b> velg 4–6 dager over – ruten beholdes, dagsskiftene fordeles på nytt. Mat og brensel beregnes i Utstyr-fanen (husk reservedøgn).</li>
          <li><b>Venting:</b> ved for lite vind er det ofte bedre å vente ved en hytte enn å gå med pulk i mange timer. Scenario B/C viser effekten.</li>
          <li><b>Avbrudd dag 1:</b> tilbake til Finse eller nordøst mot Haugastøl (Bergensbanen/Rv7).</li>
          <li><b>Avbrudd dag 2:</b> Rauhelleren/Mårbu/Kalhovd som venteplass. Brøytet vei er ikke kontrollert i dette området.</li>
          <li><b>Avbrudd dag 3:</b> Helberghytta/Gvepseborg → Rjukan til fots (Krossobanen stengt) eller vest mot Rjukan Fjellstue.</li>
          <li><b>Stopp-kriterier (forslag):</b> faregrad 3+ og ruten i/under skredterreng; whiteout + vind over komfortvindu; skade/frostskade; svikt på telt eller primærkite.</li>
        </ul>
      </Card>
    </div>
  );
}
