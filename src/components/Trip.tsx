import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { useActiveRoute, useBarrierCheck, useDayPlan, useProfile } from '../state/derived';
import { KITES } from '../data/kites';
import { addDays, daysBetween, fmtClock, hourOf, tzLabel, type SunDay } from '../lib/sun';
import { overrideState, reviewPending } from '../lib/analysis/overrides';
import { useAcceptance } from '../pages/SafetyPage';
import { Badge, Card } from './ui';
import { fmtKm } from '../lib/geo';

const MONTHS = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
const WD = ['ma', 'ti', 'on', 'to', 'fr', 'lø', 'sø'];

/** Kalender for mars/april 2027 (kan blas). Klikk = avreise; shift/«alternativ» = alternativ dato. */
export function TripCalendar() {
  const s = useStore();
  const [ym, setYm] = useState(() => s.tripDate.slice(0, 7));
  const [altMode, setAltMode] = useState(false);
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const ret = addDays(s.tripDate, s.tripDays - 1);
  const shiftMonth = (k: number) => {
    const d = new Date(Date.UTC(y, m - 1 + k, 1));
    setYm(d.toISOString().slice(0, 7));
  };
  const setDate = (d: string) => {
    if (altMode) {
      s.set({ altDates: s.altDates.includes(d) ? s.altDates.filter((x) => x !== d) : [...s.altDates, d].sort() });
      return;
    }
    s.set({ tripDate: d });
    s.log('dato', `Avreise satt til ${d}`);
  };
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="cal">
      <div className="cal-head">
        <button className="btn small" onClick={() => shiftMonth(-1)} aria-label="Forrige måned">◂</button>
        <b>{MONTHS[m - 1]} {y}</b>
        <button className="btn small" onClick={() => shiftMonth(1)} aria-label="Neste måned">▸</button>
      </div>
      <div className="cal-grid">
        {WD.map((w) => <div key={w} className="cal-wd">{w}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: nDays }, (_, i) => {
          const d = `${ym}-${String(i + 1).padStart(2, '0')}`;
          const inTrip = d >= s.tripDate && d <= ret;
          const cls = [d === s.tripDate ? 'dep' : '', inTrip ? 'trip' : '', s.altDates.includes(d) ? 'alt' : '', d === today ? 'today' : ''].join(' ');
          return (
            <button key={d} className={`cal-d ${cls}`} onClick={() => setDate(d)} aria-label={d}>
              {i + 1}
            </button>
          );
        })}
      </div>
      <div className="row small">
        <label className="chk"><input id="cal-alt" type="checkbox" checked={altMode} onChange={(e) => setAltMode(e.target.checked)} /> Klikk legger til alternativ dato</label>
      </div>
      <div className="row">
        <button className="btn small" onClick={() => setDate(addDays(s.tripDate, -1))}>−1 dag</button>
        <button className="btn small" onClick={() => setDate(addDays(s.tripDate, 1))}>+1 dag</button>
        <button className="btn small" onClick={() => setDate(addDays(s.tripDate, 7))}>+1 uke</button>
        <label className="small">Dager
          <select id="trip-days" value={s.tripDays} onChange={(e) => { s.set({ tripDays: +e.target.value }); s.log('dato', `Antall dager satt til ${e.target.value}`); }}>
            {[2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="small">Avreise<input id="trip-date" type="date" value={s.tripDate} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
      </div>
      <div className="small">
        Avreise <b>{s.tripDate}</b> · retur <b>{ret}</b> · {s.tripDays} dager · {daysBetween(today, s.tripDate)} dager til avreise
        {s.altDates.length > 0 && <> · alternativer: {s.altDates.map((d) => <button key={d} className="link" onClick={() => s.set({ tripDate: d, altDates: s.altDates.filter((x) => x !== d).concat(s.tripDate).sort() })}>{d}</button>).reduce((a: React.ReactNode[], b, i) => (i ? [...a, ', ', b] : [b]), [])}</>}
      </div>
    </div>
  );
}

/** 24-timers tidslinje: natt / astronomisk / nautisk / borgerlig tussmørke / dagslys (+ planlagt reise). */
export function DaylightBar({ sun, startH, endH, label }: { sun: SunDay; startH?: number; endH?: number; label?: string }) {
  const pct = (h: number | null) => (h == null ? 0 : Math.max(0, Math.min(100, (h / 24) * 100)));
  const H = (d: Date | null) => hourOf(d);
  const ad = H(sun.astroDawn), nd = H(sun.nauticalDawn), cd = H(sun.civilDawn), sr = H(sun.sunrise), ss = H(sun.sunset), cu = H(sun.civilDusk), nu = H(sun.nauticalDusk), au = H(sun.astroDusk);
  const seg = (a: number | null, b: number | null, cls: string, title: string) => (a != null && b != null && b > a ? <div className={`dl ${cls}`} style={{ left: `${pct(a)}%`, width: `${pct(b) - pct(a)}%` }} title={title} /> : null);
  return (
    <div className="dlwrap">
      {label && <div className="dl-label small">{label}</div>}
      <div className="dlbar" role="img" aria-label={`${label ?? ''} soloppgang ${fmtClock(sun.sunrise)}, solnedgang ${fmtClock(sun.sunset)}`}>
        {seg(ad ?? 0, nd, 'astro', 'Astronomisk tussmørke')}
        {seg(nd, cd, 'nautical', 'Nautisk tussmørke')}
        {seg(cd, sr, 'civil', 'Borgerlig tussmørke')}
        {seg(sr, ss, 'day', 'Dagslys')}
        {seg(ss, cu, 'civil', 'Borgerlig tussmørke')}
        {seg(cu, nu, 'nautical', 'Nautisk tussmørke')}
        {seg(nu, au ?? 24, 'astro', 'Astronomisk tussmørke')}
        {startH != null && endH != null && <div className="dl travel" style={{ left: `${pct(startH)}%`, width: `${Math.max(0.5, pct(endH) - pct(startH))}%` }} title="Planlagt reisetid" />}
        {sr != null && <span className="dl-sun" style={{ left: `${pct(sr)}%` }}>☀↑ {fmtClock(sun.sunrise)}</span>}
        {ss != null && <span className="dl-sun right" style={{ left: `${pct(ss)}%` }}>{fmtClock(sun.sunset)} ↓☀</span>}
        {[0, 6, 12, 18].map((h) => <span key={h} className="dl-tick" style={{ left: `${pct(h)}%` }}>{String(h).padStart(2, '0')}</span>)}
      </div>
    </div>
  );
}

export function DaylightLegend() {
  return (
    <div className="legendmini small">
      <span><i className="dl astro" />Astronomisk</span><span><i className="dl nautical" />Nautisk</span><span><i className="dl civil" />Borgerlig tussmørke</span><span><i className="dl day" />Dagslys</span><span><i className="dl travel" />Planlagt reise</span>
    </div>
  );
}

export function SunTable() {
  const route = useActiveRoute();
  const plan = useDayPlan(route);
  if (!plan.days.length) return <p className="small muted">Ingen rute.</p>;
  return (
    <div className="tablewrap">
      <table className="tbl small">
        <thead>
          <tr><th>Dag</th><th>Dato</th><th>Sted (midt på etappen)</th><th>Borgerlig demring</th><th>Soloppgang</th><th>Solnedgang</th><th>Borgerlig skumring</th><th>Dagslys</th><th>Gylden time (kveld)</th><th>Tidssone</th></tr>
        </thead>
        <tbody>
          {plan.days.map((d) => (
            <tr key={d.day}>
              <td>{d.day}</td>
              <td>{d.date}</td>
              <td className="mono">{d.sun.at.lat.toFixed(3)}, {d.sun.at.lon.toFixed(3)}</td>
              <td>{fmtClock(d.sun.civilDawn)}</td>
              <td>{fmtClock(d.sun.sunrise)}</td>
              <td>{fmtClock(d.sun.sunset)}</td>
              <td>{fmtClock(d.sun.civilDusk)}</td>
              <td>{d.sun.daylightH.toFixed(1)} t</td>
              <td>{fmtClock(d.sun.goldenStart)}–{fmtClock(d.sun.sunset)}</td>
              <td>{tzLabel(d.sun.noon)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Oppsummering: dato, dager, distanse, quiver, sjekkpunkter, leirkandidater, advarsler, overstyringer, status. */
export function TripSummary({ compact = false }: { compact?: boolean }) {
  const s = useStore();
  const route = useActiveRoute();
  const { stats } = useProfile(route);
  const check = useBarrierCheck(route);
  const plan = useDayPlan(route);
  const { accepted, items } = useAcceptance();
  const quiver = s.quivers.find((q) => q.id === s.activeQuiverId);
  const kites = useMemo(() => KITES.filter((k) => quiver?.kiteIds.includes(k.id)), [quiver]);
  const checkpoints = (route?.waypoints.filter((w) => w.name || w.category).length ?? 0) + s.markers.length;
  const activeOv = s.lakeOverrides.filter((o) => overrideState(o, s.tripDate) === 'aktiv');
  const pendingReview = activeOv.filter(reviewPending).length;
  const unresolved = items.filter((i) => i.blocking).length + check.bandWarnings.length + pendingReview;
  const kname = (id?: string) => KITES.find((k) => k.id === id);
  return (
    <Card title="Turoversikt" right={<Badge s={accepted ? 'GUL' : 'RØD'}>{accepted ? 'Datakontroller OK' : 'Blokkert'}</Badge>} className={compact ? '' : 'wide'}>
      <div className="summary">
        <div><span>Avreise</span><b>{s.tripDate}</b></div>
        <div><span>Dager</span><b>{s.tripDays}</b></div>
        <div><span>Distanse</span><b>{fmtKm(stats.total)}</b></div>
        <div><span>Stigning / fall</span><b>{Math.round(stats.up)} / {Math.round(stats.down)} m</b></div>
        <div><span>Sjekkpunkter</span><b>{checkpoints}</b></div>
        <div><span>Teltplasser</span><b>{s.camps.length}</b></div>
        <div><span>Uløste advarsler</span><b className={unresolved ? 'err' : ''}>{unresolved}</b></div>
        <div><span>Aktive vann-overstyringer</span><b>{activeOv.length}{pendingReview ? ` (${pendingReview} til gjennomgang)` : ''}</b></div>
      </div>
      <div className="small quiverline">
        <span className="muted">Quiver «{quiver?.name ?? '–'}»:</span>{' '}
        {kites.length === 0 ? <i>ingen kites valgt</i> : kites.map((k) => (
          <span key={k.id} className={`kchip ${quiver?.primary === k.id ? 'p' : quiver?.secondary === k.id ? 's' : quiver?.storm === k.id ? 'x' : ''}`}>
            {k.size} m² {k.name.replace('Flysurfer ', '').replace('Ozone ', '').replace('Naish ', '')}
            {quiver?.primary === k.id ? ' ★' : quiver?.secondary === k.id ? ' ②' : quiver?.storm === k.id ? ' ⚡' : ''}
          </span>
        ))}
        {quiver?.primary && <span className="muted"> · primær {kname(quiver.primary)?.size} m²</span>}
      </div>
      {plan.days.length > 0 && (
        <div className="small muted">
          Scenario {s.scenarioId}: {plan.scenarioDays.find((x) => x.id === s.scenarioId)?.totalDays ?? '–'} dager etter modellen · rutestatus: vann <Badge s={check.status} />
        </div>
      )}
    </Card>
  );
}
