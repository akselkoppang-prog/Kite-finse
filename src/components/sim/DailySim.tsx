import { useMemo, useState } from 'react';
import * as turf from '@turf/turf';
import { useStore } from '../../state/store';
import { useSimSetup } from '../../state/sim';
import { useBarrierCheck, useTerrain } from '../../state/derived';
import { analyseTerrain, type TerrainSample } from '../../lib/analysis/terrain';
import { evaluateCamp } from '../../lib/analysis/camps';
import { cumulative, densify, dirName, fmtCoord, haversine, pointAt, uid } from '../../lib/geo';
import { addDays, fmtClock, hourOf, sunDay } from '../../lib/sun';
import { Badge, Card, Kind, Progress } from '../ui';
import { hm } from '../../pages/SimulatorPage';

/** «SIMULER DAGSDISTANSE»: hvor ender du etter X km, hvor kan du telte, hva gjenstår. */
export default function DailySim() {
  const s = useStore();
  const setup = useSimSetup();
  const terrain = useTerrain(setup.route);
  const check = useBarrierCheck(setup.route);
  const [local, setLocal] = useState<TerrainSample[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const d = s.daily;
  const setD = (p: Partial<typeof d>) => {
    s.set({ daily: { ...d, ...p }, dailyView: null });
    setLocal(null);
  };
  const route = setup.route;
  const total = setup.total;
  const cum = useMemo(() => (route ? cumulative(route.waypoints) : []), [route]);
  const startD = Math.min(d.startKm * 1000, Math.max(0, total - 1000));
  const targetD = Math.min(total, startD + d.targetKm * 1000);
  const date = addDays(s.tripDate, d.day - 1);
  const res = useMemo(() => setup.run({ fromD: startD, toD: targetD, startDate: date, startHour: d.startHour, maxDays: 1 }), [setup, startD, targetD, date, d.startHour]);
  if (!route || !res) return null;
  const reached = res.reachedD;
  const endP = pointAt(route.waypoints, cum, reached);
  const sun = sunDay(date, endP);
  const arrH = hourOf(new Date(res.end)) ?? 0;
  const left = (hourOf(sun.sunset) ?? 0) - arrH;
  const remainingKm = (total - reached) / 1000;
  const daysLeft = Math.max(1, s.tripDays - d.day);
  const rest = setup.run({ fromD: reached, toD: total, startDate: addDays(date, 1), startHour: s.sim.startHour, maxDays: 10 });

  // Teltplasskandidater rundt sluttpunktet
  const zones = check.barriers.filter((b) => b.kind === 'sone' && b.status === 'RØD');
  const samples = (local ?? terrain?.samples ?? []).filter((x) => Math.abs(x.d - reached) <= 3000);
  const cands = samples
    .map((x) => ({ x, ev: evaluateCamp(x, x, dirName(s.sim.manual.dir), check.barriers, Object.values(s.places)) }))
    .filter(({ x, ev }) => ev.avalanche.level !== 'høy' && (ev.slope ?? 99) < 12 && !zones.some((z) => turf.booleanPointInPolygon([x.lon, x.lat], z.feature)))
    .sort((a, b) => b.ev.score - a.ev.score)
    .filter((c, i, arr) => arr.slice(0, i).every((o) => haversine(o.x, c.x) > 800))
    .slice(0, 4);
  const myCamps = s.camps.filter((c) => haversine(c, endP) < 4000);

  const analyse = async () => {
    setErr('');
    setBusy(0);
    try {
      const pts = densify(route.waypoints, 250).filter((x) => Math.abs(x.d - reached) <= 3000);
      const r = await analyseTerrain(pts, 400, 'daily', (f) => setBusy(f));
      setLocal(r.samples.map((x) => ({ ...x, d: x.d + (pts[0]?.d ?? 0) })));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const showOnMap = () => {
    s.set({ dailyView: { lat: endP.lat, lon: endP.lon, cands: cands.map((c) => ({ lat: c.x.lat, lon: c.x.lon, d: c.x.d, score: c.ev.score, text: `${c.ev.exposure}; skred: ${c.ev.avalanche.level}; ${c.ev.waterText}`, flags: c.ev.flags })) } });
    s.focusOn(endP.lat, endP.lon, 12);
  };
  const setBreak = () => {
    const n = Math.max(s.tripDays, d.day + 1);
    const cur = route.dayBreaks && route.dayBreaks.length === n - 1 ? [...route.dayBreaks] : Array.from({ length: n - 1 }, (_, i) => (total * (i + 1)) / n);
    cur[d.day - 1] = reached;
    s.set({ tripDays: n });
    s.setDayBreaks(route.id, cur);
    s.log('rute', `Dagsslutt dag ${d.day} satt ved ${(reached / 1000).toFixed(1)} km fra dagsdistanse-simulatoren`);
  };

  return (
    <Card title="SIMULER DAGSDISTANSE" className="wide" right={<Kind k="beregnet" />}>
      <div className="form">
        <label>Dag<select id="ds-day" value={d.day} onChange={(e) => setD({ day: +e.target.value })}>{Array.from({ length: Math.max(s.tripDays, 3) }, (_, i) => <option key={i} value={i + 1}>Dag {i + 1} ({addDays(s.tripDate, i)})</option>)}</select></label>
        <label>Start ved km {d.startKm}<input id="ds-start" type="range" min={0} max={Math.floor(total / 1000) - 1} value={d.startKm} onChange={(e) => setD({ startKm: +e.target.value })} /></label>
        <label>Dagsdistanse {d.targetKm} km<input id="ds-target" type="range" min={5} max={100} value={d.targetKm} onChange={(e) => setD({ targetKm: +e.target.value })} /></label>
        <label>Starttid<input id="ds-hour" type="number" step={0.25} value={d.startHour} onChange={(e) => setD({ startHour: +e.target.value })} /></label>
      </div>
      <div className="row small">
        Hurtigvalg: {[0, ...(route.dayBreaks ?? [])].map((b, i) => <button key={i} className="btn small ghost" onClick={() => setD({ startKm: Math.round(b / 1000), day: i + 1 })}>start dag {i + 1} ({(b / 1000).toFixed(0)} km)</button>)}
      </div>
      <p className="small muted">Bruker vinden og kitevalget fra simulatoren over ({s.sim.manual.avg} m/s fra {s.sim.manual.dir}°{s.sim.useForecast ? ', MET-prognose der den finnes' : ''}).</p>
      <div className="summary">
        <div><span>Planlagt</span><b>{(startD / 1000).toFixed(1)} → {(targetD / 1000).toFixed(1)} km</b></div>
        <div><span>Nådd før dagens slutt</span><b className={reached < targetD - 50 ? 'err' : ''}>{((reached - startD) / 1000).toFixed(1)} km</b></div>
        <div><span>Ankomst</span><b>{fmtClock(new Date(res.end))}</b></div>
        <div><span>Tid</span><b>{hm((res.end - res.start) / 3600000)}</b></div>
        <div><span>Dagslys igjen</span><b className={left < s.sunCfg.descentMarginH ? 'err' : ''}>{left.toFixed(1)} t (sol ned {fmtClock(sun.sunset)})</b></div>
        <div><span>Gjenstår til mål</span><b>{remainingKm.toFixed(1)} km</b></div>
        <div><span>Per gjenværende dag ({daysLeft})</span><b>{(remainingKm / daysLeft).toFixed(1)} km</b></div>
        <div><span>Sluttpunkt</span><b className="mono">{fmtCoord(endP)}</b></div>
      </div>
      {reached < targetD - 50 && <p className="err small">Dagen er for lang i denne vinden: du rekker {((reached - startD) / 1000).toFixed(1)} av {d.targetKm} km før dagens slutt ({res.dayEnds[0]?.reason}). Planen endres ikke automatisk.</p>}
      {res.warnings.map((w) => <div key={w} className="warn small">⚠️ {w}</div>)}
      <div className="btns">
        <button className="btn small" onClick={showOnMap}>Vis sluttpunkt og leirplasser i kartet</button>
        <button className="btn small" onClick={setBreak}>Sett som slutt på dag {d.day}</button>
        <button className="btn small ghost" onClick={analyse} disabled={busy != null}>{busy != null ? 'Analyserer…' : 'Analyser leirområdet (DTM ±3 km)'}</button>
      </div>
      {busy != null && <Progress f={busy} />}
      {err && <p className="err small">{err}</p>}
      <h4>Leirplasser nær sluttpunktet</h4>
      {!samples.length && <p className="small warn">Ingen terrengdata ved sluttpunktet – trykk «Analyser leirområdet» (henter DTM fra Kartverket).</p>}
      <div className="camps">
        {cands.map(({ x, ev }, i) => (
          <div key={i} className="campcard">
            <b>Kandidat {i + 1}</b> <Badge s="GUL">beregnet – ikke befart</Badge>
            <div className="mono">{fmtCoord(x)} · {(x.d / 1000).toFixed(1)} km · {ev.z != null ? `${Math.round(ev.z)} moh` : ''} · {Math.round(haversine(x, endP))} m fra sluttpunkt</div>
            <div>Helning {ev.slope?.toFixed(1) ?? '–'}° · {ev.exposure} · skred: {ev.avalanche.level} · {ev.waterText}</div>
            {ev.flags.map((f) => <div key={f} className="warn">{f}</div>)}
            <div className="btns">
              <button className="btn small" onClick={() => s.focusOn(x.lat, x.lon, 14)}>Vis</button>
              <button className="btn small" onClick={() => s.set({ camps: [...s.camps, { id: uid('camp'), lat: x.lat, lon: x.lon, name: `Leir dag ${d.day} (sim ${i + 1})`, night: d.day, source: 'beregnet kandidat', createdAt: new Date().toISOString() }] })}>Velg som leir</button>
            </div>
          </div>
        ))}
        {samples.length > 0 && cands.length === 0 && <p className="small warn">Ingen trygge kandidater innen ±3 km (bratt, skredutsatt, på vann eller i no-go-sone). Flytt sluttpunktet.</p>}
      </div>
      {myCamps.length > 0 && <p className="small">Dine teltplasser innen 4 km: {myCamps.map((c) => c.name).join(', ')}</p>}
      {rest && rest.legs.length > 0 && (
        <>
          <h4>Resten av turen fra {(reached / 1000).toFixed(1)} km (samme vind)</h4>
          <ul className="small">
            {rest.dayEnds.map((e) => <li key={e.day}>Dag {d.day + e.day}: til {(e.d / 1000).toFixed(1)} km kl. {fmtClock(new Date(e.t))} ({e.reason})</li>)}
          </ul>
          <p className="small muted">Foreslåtte sjekkpunkter: {Array.from({ length: daysLeft - 1 }, (_, i) => `${((reached + ((total - reached) * (i + 1)) / daysLeft) / 1000).toFixed(0)} km`).join(', ') || '—'} (lik fordeling).</p>
        </>
      )}
    </Card>
  );
}
