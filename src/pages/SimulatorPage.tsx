import { Advanced, Term } from '../components/ux';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useStore } from '../state/store';
import { useSimSetup, kiteInput } from '../state/sim';
import { usePlay } from '../state/play';
import { KITES } from '../data/kites';
import { KITE_SPECS, knToMs } from '../data/kiteSpecs';
import { airDensity, bestVMG, canStart, heightFactor, overpowered, physWindow, polar, polarV } from '../lib/sim/physics';
import { monteCarlo, type SimResult, type Uncertainty } from '../lib/sim/route';
import { DIRS8, DIR_DEG, cumulative, pointAt } from '../lib/geo';
import { addDays, daysBetween, fmtClock, hourOf, sunDay } from '../lib/sun';
import { forecast } from '../lib/api/met';
import { Card, Kind, Progress } from '../components/ui';
import DailySim from '../components/sim/DailySim';
import ItinerarySim from '../components/sim/ItinerarySim';

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

export const hm = (h: number) => (Number.isFinite(h) ? `${Math.floor(h)} t ${String(Math.round((h % 1) * 60)).padStart(2, '0')} m` : '–');
const kname = (id: string) => { const k = KITES.find((x) => x.id === id); return k ? `${k.name.replace(/^(Flysurfer|Ozone|Naish) /, '')} ${k.size}` : id; };
const dt = (ms: number) => new Date(ms).toLocaleString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' });

export function resultSummary(r: SimResult | null) {
  if (!r) return null;
  const T = r.totals;
  return { ...T, arrival: r.end, durationH: (r.end - r.start) / 3600000, km: (r.reachedD - (r.legs[0]?.d0 ?? 0)) / 1000, avgProgress: T.kiteH > 0 ? r.legs.filter((l) => l.mode === 'kite').reduce((a, l) => a + (l.d1 - l.d0), 0) / 1000 / (T.kiteH + T.tackH) : 0 };
}

/** Forenkling: én rad per ~2 km for tabellen. */
function chunkLegs(r: SimResult, m = 2000) {
  const out: { d0: number; d1: number; t0: number; t1: number; twa: number; course: string; wind: string; kite: string; mode: string; ground: number; progress: number; tacks: number; sailed: number; src: string }[] = [];
  let cur: typeof r.legs = [];
  const flush = () => {
    if (!cur.length) return;
    const L = cur[cur.length - 1].d1 - cur[0].d0;
    const h = cur.reduce((a, l) => a + (l.t1 - l.t0), 0) / 3600000;
    const kites = new Map<string, number>();
    cur.forEach((l) => l.kiteId && kites.set(l.kiteId, (kites.get(l.kiteId) ?? 0) + 1));
    const modes = new Map<string, number>();
    cur.forEach((l) => modes.set(l.mode, (modes.get(l.mode) ?? 0) + 1));
    const w = cur[0].wind;
    out.push({
      d0: cur[0].d0, d1: cur[cur.length - 1].d1, t0: cur[0].t0, t1: cur[cur.length - 1].t1,
      twa: cur.reduce((a, l) => a + l.twa, 0) / cur.length,
      course: cur[Math.floor(cur.length / 2)].course + (cur.some((l) => l.courseMode && l.courseMode !== 'direkte') ? ` (${cur.find((l) => l.courseMode && l.courseMode !== 'direkte')!.courseMode})` : ''),
      wind: `${w.speed.toFixed(1)} (${w.gust.toFixed(0)}) m/s fra ${Math.round(w.dirFrom)}°`,
      kite: [...kites.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '–',
      mode: [...modes.entries()].sort((a, b) => b[1] - a[1])[0][0],
      ground: cur.reduce((a, l) => a + l.groundKmh * (l.d1 - l.d0), 0) / L,
      progress: L / 1000 / Math.max(1e-6, h),
      tacks: cur.reduce((a, l) => a + l.tacks, 0),
      sailed: cur.reduce((a, l) => a + l.sailedM, 0),
      src: w.source,
    });
    cur = [];
  };
  for (const l of r.legs) {
    if (cur.length && (l.d1 - cur[0].d0 > m || l.day !== cur[0].day)) flush();
    cur.push(l);
  }
  flush();
  return out;
}

function PolarChart({ ids, windMs }: { ids: string[]; windMs: number }) {
  const s = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts>();
  useEffect(() => {
    if (!ref.current) return;
    chart.current = echarts.init(ref.current);
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.current?.dispose(); };
  }, []);
  useEffect(() => {
    const p = { ...s.simParams, riderKg: s.riderKg, pulkKg: s.pulkKg, snow: s.snow };
    const rho = airDensity(s.sim.manual.tempC, 1150);
    const W = windMs * heightFactor(p);
    const css = getComputedStyle(document.documentElement);
    const muted = css.getPropertyValue('--muted').trim() || '#8b9bb4';
    chart.current?.setOption({
      backgroundColor: 'transparent',
      grid: { left: 44, right: 12, top: 30, bottom: 34 },
      legend: { top: 0, textStyle: { color: muted, fontSize: 10 }, type: 'scroll' },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${v.toFixed(1)} km/t` },
      xAxis: { type: 'value', name: 'TWA °', nameLocation: 'middle', nameGap: 22, min: 0, max: 180, interval: 30, axisLabel: { color: muted }, splitLine: { lineStyle: { color: '#1e293b' } } },
      yAxis: { type: 'value', name: 'km/t', axisLabel: { color: muted }, splitLine: { lineStyle: { color: '#1e293b' } } },
      series: ids.map((id) => {
        const k = kiteInput(id, s);
        const pol = polar(k, p, rho);
        const data = Array.from({ length: 37 }, (_, i) => [i * 5, +(polarV(pol, W, i * 5) * 3.6).toFixed(1)]);
        return { type: 'line', name: kname(id), data, showSymbol: false, lineStyle: { width: 2 } };
      }),
    }, true);
  }, [ids, windMs, s.simParams, s.riderKg, s.pulkKg, s.snow, s.kiteModelEdits, s.sim.manual.tempC]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={ref} style={{ height: 260 }} />;
}

export default function SimulatorPage() {
  const s = useStore();
  const setup = useSimSetup();
  const load = usePlay((p) => p.load);
  const [unc, setUnc] = useState<Uncertainty | null>(null);
  const [mcProg, setMcProg] = useState<number | null>(null);
  const [fcBusy, setFcBusy] = useState(false);
  const [fcErr, setFcErr] = useState('');
  const m = s.sim.manual;
  const setSim = (p: Partial<typeof s.sim>) => s.set({ sim: { ...s.sim, ...p } });
  const setMan = (p: Partial<typeof m>) => setSim({ manual: { ...m, ...p } });
  const res = useMemo(() => setup.run(), [setup]);
  const sum = resultSummary(res);
  const inputsKey = JSON.stringify([s.sim, s.simParams, s.riderKg, s.pulkKg, s.snow, s.tripDate, s.activeQuiverId, s.kiteModelEdits]);
  useEffect(() => setUnc(null), [inputsKey]);

  const compare = useMemo(() => {
    const ids = s.sim.compareIds;
    const rows = ids.map((id) => ({ id, r: setup.run({ kiteIds: [id], maxDays: 10 }) }));
    rows.push({ id: 'quiver', r: setup.run({ kiteIds: setup.quiverIds }) });
    return rows;
  }, [setup, s.sim.compareIds]);

  const startDate = addDays(s.tripDate, s.sim.startDay - 1);
  const today = new Date().toISOString().slice(0, 10);
  const inHorizon = daysBetween(today, startDate) <= 9 && daysBetween(today, startDate) >= -1;
  const routeEnd = res && setup.route ? pointAt(setup.route.waypoints, cumulative(setup.route.waypoints), res.reachedD) : null;
  const sunEnd = routeEnd && res ? sunDay(new Date(res.end).toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' }), routeEnd) : null;
  const arrH = res ? hourOf(new Date(res.end)) : null;

  const loadForecast = async () => {
    if (!setup.route) return;
    setFcBusy(true);
    setFcErr('');
    const cum = cumulative(setup.route.waypoints);
    const total = cum[cum.length - 1];
    const n = Math.max(2, Math.round(total / 15000) + 1);
    const pts = Array.from({ length: n }, (_, i) => (total * i) / (n - 1)).map((d, i) => ({ d, ...pointAt(setup.route!.waypoints, cum, d), label: `Rutepunkt ${i + 1} (${(d / 1000).toFixed(0)} km)` }));
    const out = [];
    for (const p of pts) {
      try {
        out.push({ ...p, fc: await forecast(p) });
      } catch (e) {
        setFcErr((e as Error).message);
      }
    }
    s.set({ routeForecast: { points: out, fetchedAt: new Date().toISOString() }, sim: { ...s.sim, useForecast: out.length > 0 } });
    setFcBusy(false);
  };

  // Vindfordeling-tabell
  const p = { ...s.simParams, riderKg: s.riderKg, pulkKg: s.pulkKg, snow: s.snow };
  const rho = airDensity(m.tempC, 1150);
  const hf = heightFactor(p);
  const typicalTwa = res ? res.legs.reduce((a, l) => a + l.twa * (l.d1 - l.d0), 0) / Math.max(1, res.legs.reduce((a, l) => a + (l.d1 - l.d0), 0)) : 90;
  const evalAt = (id: string, w: number, gust: number) => {
    const k = kiteInput(id, s);
    if (k.personal) {
      if (w < k.personal.low) return { st: 'for lite', cls: 'GRÅ', vmg: 0 };
      if (w > k.personal.high) return { st: 'for mye', cls: 'RØD', vmg: 0 };
    } else {
      if (overpowered(k, p, rho, w * hf)) return { st: 'for mye', cls: 'RØD', vmg: 0 };
      if (!canStart(k, p, rho, w * hf)) return { st: 'for lite', cls: 'GRÅ', vmg: 0 };
    }
    const def = k.personal ? gust > k.personal.high : overpowered(k, p, rho, gust * hf);
    const v = bestVMG(polar(k, p, rho), w * hf, typicalTwa).vmg * 3.6 * (def ? p.defensiveFactor : 1);
    return { st: def ? 'kast over grense' : 'OK', cls: def ? 'GUL' : 'GRØNN', vmg: v };
  };
  const gustR = m.avg > 0 ? m.gust / m.avg : 1.35;

  return (
    <div className="page">
      <Card title="Ytelsessimulator – inndata" className="wide" right={<Kind k="beregnet" />}>
        <div className="form">
          <label>Dag<select id="sim-day" value={s.sim.startDay} onChange={(e) => setSim({ startDay: +e.target.value })}>{Array.from({ length: s.tripDays }, (_, i) => <option key={i} value={i + 1}>Dag {i + 1} – {addDays(s.tripDate, i)}</option>)}</select></label>
          <label>Starttid<input id="sim-start" type="number" step={0.25} min={4} max={14} value={s.sim.startHour} onChange={(e) => setSim({ startHour: +e.target.value })} /></label>
          <label>Fra km {s.sim.fromKm}<input id="sim-from" type="range" min={0} max={Math.floor(setup.total / 1000)} value={s.sim.fromKm} onChange={(e) => setSim({ fromKm: +e.target.value })} /></label>
          <label>Til km {s.sim.toKm ?? Math.round(setup.total / 1000)} (mål)<input id="sim-to" type="range" min={1} max={Math.ceil(setup.total / 1000)} value={s.sim.toKm ?? Math.ceil(setup.total / 1000)} onChange={(e) => setSim({ toKm: +e.target.value >= Math.ceil(setup.total / 1000) ? null : +e.target.value })} /></label>
          <label>Kites<select id="sim-kmode" value={s.sim.kiteMode} onChange={(e) => setSim({ kiteMode: e.target.value as 'quiver' | 'single' })}><option value="quiver">Min quiver (bytter ved behov)</option><option value="single">Én kite</option></select></label>
          {s.sim.kiteMode === 'single' && <label>Kite<select id="sim-kite" value={s.sim.kiteId} onChange={(e) => setSim({ kiteId: e.target.value })}>{KITES.map((k) => <option key={k.id} value={k.id}>{kname(k.id)} m²</option>)}</select></label>}
          <label className="chk"><input id="sim-multi" type="checkbox" checked={s.sim.multiDay} onChange={(e) => setSim({ multiDay: e.target.checked })} /> Fortsett neste dag(er) til mål</label>
        </div>
        <h4>Vind</h4>
        <div className="seg">
          {DIRS8.map((d) => <button key={d} className={`btn small ${m.dir === DIR_DEG[d] ? 'on' : ''}`} onClick={() => setMan({ dir: DIR_DEG[d] })}>{d}</button>)}
          <label className="small">Egendefinert°<input id="sim-dir" type="number" min={0} max={359} value={m.dir} onChange={(e) => setMan({ dir: ((+e.target.value % 360) + 360) % 360 })} style={{ width: 64 }} /></label>
        </div>
        <div className="form">
          <label>Middelvind {m.avg} m/s<input id="sim-avg" type="range" min={0} max={22} step={0.5} value={m.avg} onChange={(e) => setMan({ avg: +e.target.value, min: Math.min(m.min, +e.target.value), max: Math.max(m.max, +e.target.value), gust: Math.max(m.gust, +e.target.value) })} /></label>
          <label>Minimum {m.min} m/s<input id="sim-min" type="range" min={0} max={22} step={0.5} value={m.min} onChange={(e) => setMan({ min: Math.min(+e.target.value, m.avg) })} /></label>
          <label>Maksimum {m.max} m/s<input id="sim-max" type="range" min={0} max={28} step={0.5} value={m.max} onChange={(e) => setMan({ max: Math.max(+e.target.value, m.avg) })} /></label>
          <label>Vindkast {m.gust} m/s<input id="sim-gust" type="range" min={0} max={32} step={0.5} value={m.gust} onChange={(e) => setMan({ gust: Math.max(+e.target.value, m.avg) })} /></label>
          <label>Variabilitet (CV) {Math.round(s.simParams.variability * 100)} %<input id="sim-var" type="range" min={0} max={0.6} step={0.05} value={s.simParams.variability} onChange={(e) => s.set({ simParams: { ...s.simParams, variability: +e.target.value } })} /></label>
          <label>Temperatur {m.tempC} °C<input id="sim-temp" type="range" min={-30} max={5} value={m.tempC} onChange={(e) => setMan({ tempC: +e.target.value })} /></label>
        </div>
        <details className="small">
          <summary>Time for time (manuell, {m.hourly.length} rader)</summary>
          <table className="tbl small">
            <thead><tr><th>Fra kl.</th><th>Vind m/s</th><th>Kast</th><th>Fra °</th><th /></tr></thead>
            <tbody>
              {m.hourly.map((h, i) => (
                <tr key={i}>
                  {(['hour', 'speed', 'gust', 'dir'] as const).map((f) => <td key={f}><input type="number" value={h[f]} style={{ width: 64 }} onChange={(e) => setMan({ hourly: m.hourly.map((x, j) => (j === i ? { ...x, [f]: +e.target.value } : x)) })} /></td>)}
                  <td><button className="link danger" onClick={() => setMan({ hourly: m.hourly.filter((_, j) => j !== i) })}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn small" onClick={() => setMan({ hourly: [...m.hourly, { hour: (m.hourly[m.hourly.length - 1]?.hour ?? s.sim.startHour - 1) + 1, speed: m.avg, gust: m.gust, dir: m.dir }] })}>+ Legg til time</button>
          <span className="muted"> Raden gjelder fra klokkeslettet til neste rad. Tom tabell = konstant vind.</span>
        </details>
        <div className="row small">
          <label className="chk"><input id="sim-fc" type="checkbox" checked={s.sim.useForecast} disabled={!s.routeForecast} onChange={(e) => setSim({ useForecast: e.target.checked })} /> Bruk MET-prognose time for time langs ruten</label>
          <button className="btn small" onClick={loadForecast} disabled={fcBusy}>{fcBusy ? 'Henter…' : 'Hent prognose langs ruten'}</button>
          <span className={inHorizon ? 'ok' : 'warn'}>{inHorizon ? `${startDate} er innenfor prognosehorisonten` : `${startDate} er utenfor MET-horisonten (~9 døgn): simuleringen bruker manuell vind`}</span>
        </div>
        {fcErr && <p className="err small">Prognosefeil: {fcErr}</p>}
        {s.routeForecast && <p className="small muted">Prognose hentet {new Date(s.routeForecast.fetchedAt).toLocaleString('nb-NO')} for {s.routeForecast.points.length} punkter. Metode: nærmeste prognosepunkt og nærmeste time – ingen interpolasjon. Tider utenfor prognosen faller tilbake til manuell vind (merket i tabellen).</p>}
        <p className="small muted">Last: {s.riderKg} kg + pulk {s.pulkKg} kg + {s.simParams.extraKg} kg på kroppen · snø «{s.snow}» (endres i Kite-quiver) · alle modellparametre under fanen «Modell».</p>
      </Card>

      <Card title="Resultat" className="wide" right={res && <button className="btn small" onClick={() => { load(res, `${s.sim.kiteMode === 'single' ? kname(s.sim.kiteId) : 'Quiver'} · ${m.avg} m/s fra ${m.dir}°`); s.setTab('kart'); }}>▶ Spill av i kartet</button>}>
        {!res || !sum ? <p className="small muted">Ingen rute.</p> : (
          <>
            <div className="summary">
              <div><span>Ankomst</span><b>{dt(sum.arrival)}</b></div>
              <div><span>Total tid (inkl. netter)</span><b>{hm(sum.durationH)}</b></div>
              <div><span>Dager</span><b>{sum.days}{res.completed ? '' : ' (ikke i mål)'}</b></div>
              <div><span>Aktiv bevegelse</span><b>{hm(sum.movingH)}</b></div>
              <div><span>Kiting</span><b>{hm(sum.kiteH)}</b></div>
              <div><span>Stagvending/jibb</span><b>{hm(sum.tackH)}</b></div>
              <div><span>Ski (lite vind)</span><b>{hm(sum.skiH)}</b></div>
              <div><span>Gå (bratt/nedstigning)</span><b>{hm(sum.walkH)}</b></div>
              <div><span>For mye vind</span><b>{hm(sum.stormH)}</b></div>
              <div><span>Oppskyting/nav/bytte</span><b>{hm(sum.overheadH)}</b></div>
              <div><span>Ruteavstand / seilt</span><b>{sum.km.toFixed(1)} / {sum.sailedKm.toFixed(1)} km</b></div>
              <div><span>Fremdrift ved kiting</span><b>{sum.avgProgress.toFixed(1)} km/t</b></div>
            </div>
            <div className="small">
              {res.dayEnds.map((d) => <div key={d.day}>Dag {d.day}: slutt ved {(d.d / 1000).toFixed(1)} km kl. {fmtClock(new Date(d.t))} ({d.reason})</div>)}
              {sunEnd && arrH != null && <div>Ved ankomst: solnedgang {fmtClock(sunEnd.sunset)} → <b className={(hourOf(sunEnd.sunset) ?? 0) - arrH < s.sunCfg.descentMarginH ? 'err' : ''}>{((hourOf(sunEnd.sunset) ?? 0) - arrH).toFixed(1)} t dagslys igjen</b> (margin du ønsker: {s.sunCfg.descentMarginH} t)</div>}
              {res.warnings.map((w) => <div key={w} className="warn">⚠️ {w}</div>)}
            </div>
            <div className="row">
              <button className="btn small" disabled={mcProg != null} onClick={async () => { setMcProg(0); setUnc(await monteCarlo(setup.base({}), 20, setMcProg)); setMcProg(null); }}>Beregn usikkerhet (20 kjøringer)</button>
              {mcProg != null && <Progress f={mcProg} />}
              {unc && <span className="small">Total tid P10–P50–P90: <b>{hm(unc.p10)} – {hm(unc.p50)} – {hm(unc.p90)}</b> (varierer c_F/glidetall ±15 %, komfortfart ±10 %, vind ± variabilitet, retning ±15°)</span>}
            </div>
            <p className="small muted">Ord: <Term k="twa">TWA</Term> · <Term k="vmg">VMG</Term> · <Term k="polar">polar</Term> · <Term k="kast">kast</Term>. Alle tall er <b>beregnet</b> med en forenklet fysikkmodell og dine antakelser – ikke målt. Tidene er punktestimater; bruk usikkerhetsberegningen for et intervall.</p>
          </>
        )}
      </Card>

      <Advanced className="wide" title="Kitevurdering for vindfordelingen" hint="hvor godt hver kite passer vinden på ruten">
      <Card title={`Kitevurdering for vindfordelingen (typisk TWA på ruten ${Math.round(typicalTwa)}°)`} className="wide" right={<Kind k="beregnet" />}>
        <div className="tablewrap">
          <table className="tbl small">
            <thead><tr><th>Kite</th><th>Produsentens område <Kind k="kartdata" /></th><th>Fysikkvindu (din last)</th><th>Ditt vindu</th><th>Min {m.min}</th><th>Snitt {m.avg}</th><th>Maks {m.max}</th><th>Kast {m.gust}</th><th>Vurdering</th></tr></thead>
            <tbody>
              {KITES.map((k) => {
                const ki = kiteInput(k.id, s);
                const w = physWindow(ki, p, rho);
                const man = KITE_SPECS[k.id]?.windRangeKn;
                const mm = String(man?.v ?? '').match(/(\d+)\s*[–-]\s*(\d+)/);
                const cells = [m.min, m.avg, m.max].map((x) => evalAt(k.id, x, x * gustR));
                const g = evalAt(k.id, m.gust, m.gust);
                const okAll = cells.every((c) => c.cls === 'GRØNN');
                const verdict = okAll && g.cls !== 'RØD' ? 'Fungerer i hele fordelingen' : cells[1].cls === 'GRØNN' && cells[2].cls === 'RØD' ? 'OK i snitt, men for stor i maksvind – ikke ubetinget anbefalt' : cells[1].cls === 'GRØNN' && cells[0].cls === 'GRÅ' ? 'OK i snitt, for liten i minimumsvind' : cells[1].cls === 'GRØNN' ? 'Brukbar med forbehold (kast)' : cells[1].cls === 'GRÅ' ? 'For liten trekk i snittvind' : 'For stor i snittvind';
                return (
                  <tr key={k.id}>
                    <td><b>{kname(k.id)} m²</b></td>
                    <td>{man?.v ? `${man.v} kn${mm ? ` (${knToMs(+mm[1]).toFixed(1)}–${knToMs(+mm[2]).toFixed(1)} m/s)` : ''}` : 'ikke funnet'}<div className="muted">{man?.kind}</div></td>
                    <td>{w.low.toFixed(1)}–{w.high.toFixed(1)} m/s</td>
                    <td>{ki.personal ? `${ki.personal.low}–${ki.personal.high} m/s` : '–'}</td>
                    {[...cells, g].map((c, i) => <td key={i}><span className={`badge b-${c.cls}`}>{c.st}</span>{c.vmg > 0 && i < 3 ? <div className="muted">{c.vmg.toFixed(0)} km/t VMG</div> : null}</td>)}
                    <td>{verdict}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted">Produsentens vindområder gjelder vanligvis vann og ~75–80 kg uten pulk og vises bare som referanse. Fysikkvinduet er beregnet for {s.riderKg + s.pulkKg + s.simParams.extraKg} kg på «{s.snow}». Ditt eget vindu (Kite-quiver) overstyrer modellen.</p>
      </Card>
      </Advanced>

      <Advanced className="wide" title="Samme rute og vind med hver kite" hint="sammenlign tid og fart">
      <Card title={`Samme rute og vind med hver kite (${m.avg} m/s fra ${m.dir}°)`} className="wide" right={<Kind k="beregnet" />}>
        <div className="seg small">
          {KITES.map((k) => (
            <label key={k.id} className="chk"><input type="checkbox" checked={s.sim.compareIds.includes(k.id)} onChange={(e) => setSim({ compareIds: e.target.checked ? [...s.sim.compareIds, k.id] : s.sim.compareIds.filter((x) => x !== k.id) })} />{kname(k.id)}</label>
          ))}
        </div>
        <div className="tablewrap">
          <table className="tbl small">
            <thead><tr><th>Kite</th><th>Ankomst</th><th>Total</th><th>Kiting</th><th>Ski/storm</th><th>Kryss</th><th>Fremdrift (kiting)</th><th>Bakkefart</th><th>Hvorfor</th><th>Konfidens</th></tr></thead>
            <tbody>
              {compare.map(({ id, r }) => {
                const su = resultSummary(r);
                if (!r || !su) return null;
                const kiteLegs = r.legs.filter((l) => l.mode === 'kite');
                const ground = kiteLegs.length ? kiteLegs.reduce((a, l) => a + l.groundKmh * (l.d1 - l.d0), 0) / kiteLegs.reduce((a, l) => a + (l.d1 - l.d0), 0) : 0;
                const capped = ground >= s.simParams.comfortKmh * s.simParams.terrainFactor * 0.95;
                const why = [
                  su.skiH > 0.5 ? `${hm(su.skiH)} for lite vind` : '',
                  su.stormH > 0.5 ? `${hm(su.stormH)} for mye vind` : '',
                  r.legs.some((l) => (l.fracDefensive ?? 0) > 0.3) ? 'defensiv i kast' : '',
                  capped ? 'begrenset av komfortfarten, ikke kiten' : '',
                  su.tackH > 0.5 ? 'mye kryssing' : '',
                ].filter(Boolean).join(' · ') || 'jevn fremdrift';
                const spec = id === 'quiver' ? null : KITE_SPECS[id];
                const conf = id === 'quiver' ? 'som enkeltkitene' : (spec?.aspectRatio?.kind === 'produsent' || spec?.aspectRatio?.kind === 'forhandler') && !s.simParams.usePersonalCalibration ? 'middels (AR dokumentert, c_F antatt)' : s.simParams.usePersonalCalibration ? 'middels–høy (kalibrert)' : 'lav (AR ukjent)';
                return (
                  <tr key={id} className={id === 'quiver' ? 'sel' : ''}>
                    <td><b>{id === 'quiver' ? `Min quiver (${setup.quiverIds.map(kname).join(', ')})` : `${kname(id)} m²`}</b></td>
                    <td>{dt(r.end)}{!r.completed && <div className="err">ikke i mål</div>}</td>
                    <td>{hm(su.durationH)} · {su.days} d</td>
                    <td>{hm(su.kiteH)}</td>
                    <td>{hm(su.skiH + su.stormH)}</td>
                    <td>{hm(su.tackH)}</td>
                    <td>{su.avgProgress.toFixed(1)} km/t</td>
                    <td>{ground.toFixed(1)} km/t</td>
                    <td>{why}</td>
                    <td>{conf}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <h4>Fart over bakken etter vinkel mot vinden ({m.avg} m/s, din last)</h4>
        <PolarChart ids={s.sim.compareIds} windMs={m.avg} />
        <p className="small muted">Kurvene viser modellens fart over bakken (ikke fremdrift) ved hver TWA. Flatt topp-platå = begrenset av komfortfarten ({s.simParams.comfortKmh} km/t × terrengfaktor {s.simParams.terrainFactor}). Upwind-evnen vises der kurven stiger fra 0.</p>
      </Card>
      </Advanced>

      {res && (
        <Card title="Etapper (≈2 km)" className="wide">
          <div className="tablewrap" style={{ maxHeight: 420 }}>
            <table className="tbl small">
              <thead><tr><th>Dag</th><th>Km</th><th>Tid</th><th>Vind (kilde)</th><th>TWA</th><th>Kurs</th><th>Modus / kite</th><th>Bakkefart</th><th>Fremdrift</th><th>Stag/jibb</th><th>Seilt</th></tr></thead>
              <tbody>
                {chunkLegs(res).map((c, i) => (
                  <tr key={i}>
                    <td>{res.legs.find((l) => l.d0 === c.d0)?.day}</td>
                    <td>{(c.d0 / 1000).toFixed(1)}–{(c.d1 / 1000).toFixed(1)}</td>
                    <td>{fmtClock(new Date(c.t0))}–{fmtClock(new Date(c.t1))}</td>
                    <td>{c.wind}<div className="muted">{c.src}</div></td>
                    <td>{Math.round(c.twa)}°</td>
                    <td>{c.course}</td>
                    <td>{c.mode}{c.kite !== '–' ? ` · ${kname(c.kite)}` : ''}</td>
                    <td>{c.ground.toFixed(1)}</td>
                    <td>{c.progress.toFixed(1)}</td>
                    <td>{c.tacks}</td>
                    <td>{(c.sailed / 1000).toFixed(1)} km</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <DailySim />
      <ItinerarySim />
    </div>
  );
}
