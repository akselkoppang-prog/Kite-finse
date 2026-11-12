import { Advanced } from '../ux';
import { useUiPrefs } from '../../state/uiprefs';
import { useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { useTerrain, useBarrierCheck, useActiveRoute } from '../../state/derived';
import { updateDay } from '../../state/expedition';
import { DAY_COLORS, hhmm, type DayOutcome, type DayPlan } from '../../lib/sim/expedition';
import { analyseTerrain, type TerrainSample } from '../../lib/analysis/terrain';
import { campCandidates } from '../../lib/analysis/camps';
import { cumulative, densify, dirName, haversine, nearestOnRoute, pointAt, uid } from '../../lib/geo';
import { sunDay } from '../../lib/sun';
import { DaylightBar } from '../Trip';
import WindEditor from './WindEditor';
import DayExplain from './DayExplain';
import { availableCamps } from '../../lib/plan/insights';
import KiteChips, { kiteShort } from './KiteChips';

const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' });

function Slider({ label, value, min, max, step, unit, fmt, onChange, id }: { label: string; value: number; min: number; max: number; step: number; unit?: string; fmt?: (v: number) => string; onChange: (v: number) => void; id: string }) {
  return (
    <label className="bigslider">
      <span>{label}</span>
      <b>{fmt ? fmt(value) : `${value} ${unit ?? ''}`}</b>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}

export default function DayCard({ i, day, out, forecastAvailable }: { i: number; day: DayPlan; out?: DayOutcome; forecastAvailable: boolean }) {
  const s = useStore();
  const route = useActiveRoute();
  const terrain = useTerrain(route);
  const check = useBarrierCheck(route);
  const detailed = useUiPrefs((x) => x.detailed);
  const [windOpen, setWindOpen] = useState(i === 0 && detailed);
  const [local, setLocal] = useState<TerrainSample[] | null>(null);
  const [busy, setBusy] = useState(false);
  const color = DAY_COLORS[i % DAY_COLORS.length];
  const set = (p: Partial<DayPlan>) => updateDay(i, p);
  const cum = useMemo(() => (route ? cumulative(route.waypoints) : []), [route]);
  if (!out || !route) return <div className="daycard2">Beregner …</div>;
  const endP = pointAt(route.waypoints, cum, out.endD);
  const startP = pointAt(route.waypoints, cum, out.startD);
  const near = (p: { lat: number; lon: number }) => Object.values(s.places).map((pl) => ({ pl, km: haversine(p, pl) / 1000 })).sort((a, b) => a.km - b.km)[0];
  const nm = (p: { lat: number; lon: number }) => { const n = near(p); return n && n.km < 6 ? `${n.pl.name}${n.km > 1 ? ` (${n.km.toFixed(0)} km unna)` : ''}` : `${(nearestOnRoute(route.waypoints, p).d / 1000).toFixed(0)} km`; };
  const camps = availableCamps(s, s.activePlanId).map((c) => ({ c, dist: haversine(c, endP), d: nearestOnRoute(route.waypoints, c).d })).filter((x) => x.dist < 8000).sort((a, b) => a.dist - b.dist);
  const chosen = s.camps.find((c) => c.id === day.campId);
  const samples = (local ?? terrain?.samples ?? []).filter((t) => Math.abs(t.d - out.endD) < 4000);
  const sugg = samples.length ? campCandidates(samples, out.endD, 4000, dirName(day.wind.dir), check.barriers, Object.values(s.places), 3) : [];
  const sun = sunDay(out.date, endP);
  const done = out.reason.startsWith('allerede');
  const maxKm = Math.max(5, Math.ceil((out.remainingKm + out.progressKm)));

  const pickCamp = (id: string, d: number) => {
    s.set({ camps: s.camps.map((c) => (c.id === id ? { ...c, night: i + 1, role: 'foretrukket' } : c.night === i + 1 && c.role === 'foretrukket' ? { ...c, role: 'reserve' } : c)) });
    set({ campId: id, target: { mode: 'stopp', stopD: d } });
  };
  const addCampAt = (lat: number, lon: number, d: number, name: string) => {
    const id = uid('camp');
    s.set({ camps: [...s.camps, { id, lat, lon, name, night: i + 1, source: 'manuell', role: 'foretrukket', kind: 'telt', createdAt: new Date().toISOString() }] });
    set({ campId: id, target: { mode: 'stopp', stopD: d } });
  };
  const findCamps = async () => {
    setBusy(true);
    try {
      const pts = densify(route.waypoints, 250).filter((x) => Math.abs(x.d - out.endD) <= 3500);
      const r = await analyseTerrain(pts, 400, 'dag', () => undefined);
      setLocal(r.samples.map((x) => ({ ...x, d: x.d + (pts[0]?.d ?? 0) })));
    } catch {
      setLocal([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="daycard2" style={{ borderTopColor: color }}>
      <header className="dc-head">
        <span className="dc-dot" style={{ background: color }} />
        <div>
          <div className="dc-title">DAG {i + 1} · {fmtDate(out.date)}</div>
          <div className="small muted">{nm(startP)} → <b>{chosen ? chosen.name : nm(endP)}</b></div>
        </div>
        <div className="dc-kite">🪁 {kiteShort(out.kiteId)}{out.kiteAuto ? ' (auto)' : ''}</div>
      </header>

      {done ? (
        <p className="ok">Du er allerede i {s.project.destination || 'mål'} etter forrige dag – dette er en reservedag.</p>
      ) : (
        <>
          <div className="dc-tiles">
            <div className="tile big"><span>Fremdrift langs ruten</span><b>{(out.endD / 1000 - out.startD / 1000).toFixed(0)} km</b><small>usikkerhet {out.rangeKm[0].toFixed(0)}–{out.rangeKm[1].toFixed(0)} km</small></div>
            <div className="tile"><span>Ankomst</span><b>{hhmm(out.arrival)}</b><small>{hhmm(out.rangeArrival[0])}–{hhmm(out.rangeArrival[1])}</small></div>
            <div className="tile"><span>Dagslys igjen</span><b className={out.daylightLeftH != null && out.daylightLeftH < 1 ? 'err' : ''}>{out.daylightLeftH != null ? `${out.daylightLeftH.toFixed(1)} t` : '–'}</b><small>sol ned {hhmm(out.sunset)}</small></div>
            <div className="tile"><span>Igjen til {s.project.destination || 'mål'}</span><b>{out.remainingKm.toFixed(0)} km</b><small>{out.reason}</small></div>
          </div>
          <Advanced title="Slik er dagen regnet ut" hint="fart, kryssing, pauser og usikkerhet">
          <div className="dc-bars" title="Teoretisk bevegelse = fart × timer. Fremdrift = det du faktisk kommer nærmere målet langs ruten.">
            <div className="bar"><span>Teoretisk bevegelse ({day.speedKmh} km/t × {day.activeH} t)</span><i style={{ width: '100%' }} /><b>{out.theoreticalKm.toFixed(0)} km</b></div>
            <div className="bar"><span>Faktisk seilt (med kryss/omveier)</span><i style={{ width: `${Math.min(100, (100 * out.sailedKm) / Math.max(1, out.theoreticalKm))}%` }} /><b>{out.sailedKm.toFixed(0)} km</b></div>
            <div className="bar prog"><span>Fremdrift langs ruten</span><i style={{ width: `${Math.min(100, (100 * out.progressKm) / Math.max(1, out.theoreticalKm))}%`, background: color }} /><b>{out.progressKm.toFixed(0)} km</b></div>
          </div>
          <p className="small muted">{out.upwindShare > 0.2 ? `${Math.round(out.upwindShare * 100)} % av strekket er mot vinden (kryssing). ` : ''}{out.underShare > 0.2 ? `${Math.round(out.underShare * 100)} % med for lite vind for kiten. ` : ''}{out.overShare > 0.2 ? `${Math.round(out.overShare * 100)} % med for mye vind. ` : ''}Vind: {out.windSource}.</p>
            <DayExplain out={out} day={day} />
          </Advanced>
        </>
      )}


      <DaylightBar sun={sun} startH={day.departure} endH={done ? day.departure : out.arrival} label={`Sol opp ${hhmm(out.sunrise)} · ned ${hhmm(out.sunset)} · ${sun.daylightH.toFixed(1)} t dagslys · reise ${hhmm(day.departure)}–${hhmm(out.arrival)}`} />

      <div className="dc-controls">
        <Slider id={`d${i}-dep`} label="Avreise" value={day.departure} min={5} max={14} step={0.25} fmt={hhmm} onChange={(v) => set({ departure: v })} />
        <Slider id={`d${i}-act`} label="Aktiv kiting" value={day.activeH} min={1} max={11} step={0.5} unit="t" onChange={(v) => set({ activeH: v })} />
        <Slider id={`d${i}-brk`} label="Pauser" value={day.breakH} min={0} max={4} step={0.25} unit="t" onChange={(v) => set({ breakH: v })} />
        <Slider id={`d${i}-spd`} label="Fart når du kiter" value={day.speedKmh} min={8} max={40} step={1} unit="km/t" onChange={(v) => set({ speedKmh: v })} />
      </div>

      <div className="dc-section">
        <div className="dc-label">Dagens mål</div>
        <div className="seg">
          <button className={`btn small ${day.target.mode === 'auto' ? 'on' : ''}`} onClick={() => set({ target: { mode: 'auto' }, campId: undefined })}>Så langt planen rekker</button>
          <button className={`btn small ${day.target.mode === 'km' ? 'on' : ''}`} onClick={() => set({ target: { mode: 'km', km: day.target.km ?? (Math.round(out.progressKm) || 40) }, campId: undefined })}>Bestemt distanse</button>
          <button className={`btn small ${day.target.mode === 'stopp' ? 'on' : ''}`} onClick={() => set({ target: { mode: 'stopp', stopD: day.target.stopD ?? out.endD } })}>Mitt stopp</button>
        </div>
        {day.target.mode === 'km' && <Slider id={`d${i}-km`} label="Distanse denne dagen" value={day.target.km ?? 40} min={5} max={Math.min(120, maxKm)} step={1} unit="km" onChange={(v) => set({ target: { mode: 'km', km: v } })} />}
        {day.target.mode === 'stopp' && <div className="small">Stopp ved {((day.target.stopD ?? 0) / 1000).toFixed(1)} km{chosen ? ` – ${chosen.name}` : ''}. Dra 🏁-flagget i kartet for å flytte det.</div>}
        {out.forcedStop && <div className="small warn">Du har valgt et stopp lenger enn modellen rekker – planen bruker stoppet ditt.</div>}
      </div>

      <div className="dc-section">
        <div className="dc-label">Kite (én om gangen)</div>
        <KiteChips value={day.kiteId} wind={day.wind} autoPick={out.kiteId} onPick={(id) => set({ kiteId: id })} />
      </div>

      <div className="dc-section">
        <button className="dc-windsum" onClick={() => setWindOpen(!windOpen)} aria-expanded={windOpen}>
          <span className="arrow" style={{ transform: `rotate(${(day.wind.dir + 180) % 360}deg)` }}>➜</span>
          <span>Vind {day.windMode === 'manuell' ? 'fra' : '(værmelding)'} <b>{dirName(day.wind.dir)}</b> · {day.wind.avg} m/s ({day.wind.min}–{day.wind.max}, kast {day.wind.gust})</span>
          <span className="muted">{windOpen ? '▾' : 'Endre ▸'}</span>
        </button>
        {windOpen && <WindEditor day={day} onChange={set} forecastAvailable={forecastAvailable} />}
      </div>

      {i < s.plans.find((p) => p.id === s.activePlanId)!.days.length - 1 && !done && (
        <div className="dc-section">
          <div className="dc-label">Overnatting</div>
          {chosen && <div className="small">⛺ <b>{chosen.name}</b> {chosen.description && `– ${chosen.description}`} <button className="link" onClick={() => s.set({ selectedCamp: chosen.id, tab: 'oversikt' })}>rediger</button></div>}
          <div className="campchoices">
            {camps.filter((x) => x.c.id !== day.campId).slice(0, 4).map(({ c, dist, d }) => (
              <button key={c.id} className="btn small ghost" onClick={() => pickCamp(c.id, d)}>⛺ {c.name} <span className="muted">{(dist / 1000).toFixed(1)} km fra sluttpunkt</span></button>
            ))}
            <button className="btn small" onClick={() => addCampAt(endP.lat, endP.lon, out.endD, `Leir dag ${i + 1}`)}>+ Teltplass ved sluttpunktet</button>
          </div>
          {sugg.length > 0 ? (
            <div className="small">
              Forslag fra terrenget (ikke befart):{' '}
              {sugg.map(({ s: t, ev }, k) => (
                <button key={k} className="btn small ghost" onClick={() => addCampAt(t.lat, t.lon, t.d, `Forslag dag ${i + 1}${'ABC'[k]}`)} title={`${ev.exposure}; skred: ${ev.avalanche.level}; ${ev.waterText}`}>
                  {'ABC'[k]}: {(t.d / 1000).toFixed(1)} km · {ev.slope?.toFixed(0)}° · {ev.avalanche.level === 'lav' ? 'lite skredterreng' : `skred: ${ev.avalanche.level}`}
                </button>
              ))}
            </div>
          ) : (
            <button className="link small" onClick={findCamps} disabled={busy}>{busy ? 'Ser på terrenget …' : 'Finn mulige leirplasser rundt sluttpunktet'}</button>
          )}
        </div>
      )}

      {out.issues.length > 0 && <ul className="dc-issues small">{out.issues.map((t) => <li key={t}>⚠️ {t}</li>)}</ul>}
      <textarea rows={2} placeholder="Notater for dagen" value={day.note ?? ''} onChange={(e) => set({ note: e.target.value })} aria-label={`Notater dag ${i + 1}`} />
    </article>
  );
}
