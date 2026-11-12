import { useStore } from '../state/store';
import { useProfile, useActiveRoute } from '../state/derived';
import { useExpedition } from '../state/expedition';
import { DAY_COLORS, hhmm } from '../lib/sim/expedition';
import { dirName } from '../lib/geo';
import { kiteShort } from './plan/KiteChips';
import { TripStrip } from './plan/TripStrip';
import Warnings from './Warnings';
import RoutePanel from './RoutePanel';
import { useState } from 'react';
import { Empty } from './ux';
import { editRoute, startNewRoute } from '../lib/route/builder';

/** Prosjektnavnet – trykk ✎ for å endre det direkte her. */
function EditableTitle() {
  const name = useStore((s) => s.project.name);
  const set = useStore((s) => s.set);
  const [edit, setEdit] = useState(false);
  if (edit)
    return (
      <input
        id="ov-title-input"
        className="ov-title-input"
        autoFocus
        defaultValue={name}
        aria-label="Prosjektnavn"
        onBlur={(e) => { const v = e.target.value.trim(); if (v) set({ project: { ...useStore.getState().project, name: v } }); setEdit(false); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEdit(false); }}
      />
    );
  return (
    <div className="ov-title">
      {name}
      <button className="iconbtn" onClick={() => setEdit(true)} aria-label="Endre prosjektnavn" title="Endre prosjektnavn">✎</button>
    </div>
  );
}

/** Sidepanel på hovedskjermen: turen på ett blikk, dagene, varsler – og alt det tekniske bak «Rute og data». */
export default function OverviewPanel() {
  const s = useStore();
  const route = useActiveRoute();
  const { stats } = useProfile(route);
  const { plan, days, ctx } = useExpedition();
  const done = days.find((d) => d.remainingKm <= 0.05);
  const last = days[days.length - 1];
  const camps = s.camps.length;
  return (
    <div className="ovpanel">
      <section className="ov-hero">
        <EditableTitle />
        {s.project.description && <div className="ov-desc small">{s.project.description}</div>}
        <div className="ov-date">{new Date(`${s.tripDate}T12:00:00`).toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {plan.days.length} dager</div>
        <div className="ov-grid">
          <div><span>Distanse</span><b>{(stats.total / 1000).toFixed(0)} km</b></div>
          <div><span>Stigning / fall</span><b>{Math.round(stats.up)} / {Math.round(stats.down)} m</b></div>
          <div><span>Ankomst</span><b className={done ? 'ok' : 'warn'}>{done ? `dag ${done.day} ${hhmm(done.arrival)}` : `${last?.remainingKm.toFixed(0) ?? '–'} km igjen`}</b></div>
          <div><span>Teltplasser</span><b>{camps}</b></div>
        </div>
        <TripStrip days={days} total={ctx?.total ?? 1} />
        <div className="small muted">Scenario: <button className="link" onClick={() => s.setTab('scenarier')}><b>{plan.name}</b>{plan.id === s.mainPlanId ? ' ★' : ''}</button> · kites med: {s.quivers.find((q) => q.id === s.activeQuiverId)?.kiteIds.map(kiteShort).join(', ')}</div>
      </section>

      <section className="ov-route" id="ov-route">
        {route && route.waypoints.length > 1 ? (
          <>
            <div className="ovr-line"><span className="dpin dp-start mini">S</span><b>{route.waypoints[0].name ?? 'Start'}</b><span className="muted">→</span><span className="dpin dp-finish mini">M</span><b>{route.waypoints[route.waypoints.length - 1].name ?? 'Mål'}</b></div>
            <div className="small muted">Rute «{route.name}» · {(stats.total / 1000).toFixed(0)} km · {route.waypoints.length} punkter</div>
          </>
        ) : (
          <Empty icon="🧭" title={route ? `Ruten «${route.name}» mangler ${route.waypoints.length ? 'mål' : 'start og mål'}` : 'Ingen rute ennå'}>Lag en rute ved å velge start og mål i kartet, eller importer en GPX-fil under «Rute og data».</Empty>
        )}
        <div className="btns">
          <button className="btn small primary" onClick={startNewRoute}>＋ Ny rute</button>
          {route && <button className="btn small" onClick={() => editRoute(route)}>✎ Rediger start, mål og punkter</button>}
        </div>
      </section>

      <section className="ov-days">
        {days.map((d, i) => (
          <button key={i} className="ov-day" onClick={() => s.setTab('plan')} style={{ borderLeftColor: DAY_COLORS[i % DAY_COLORS.length] }}>
            <span className="ovd-n">D{d.day}</span>
            <span className="ovd-main">
              {d.reason.startsWith('allerede') ? <b>Reservedag</b> : <span><b>{((d.endD - d.startD) / 1000).toFixed(0)} km</b> · {hhmm(d.departure)}–{hhmm(d.arrival)}</span>}
              <small>{d.date} · 🪁 {kiteShort(d.kiteId)} · <span className="arr" style={{ display: 'inline-block', transform: `rotate(${(plan.days[i].wind.dir + 180) % 360}deg)` }}>➜</span> {dirName(plan.days[i].wind.dir)} {plan.days[i].wind.avg} m/s</small>
            </span>
            <span className="ovd-end small">{d.remainingKm > 0.05 ? `${d.remainingKm.toFixed(0)} km igjen` : `🏁 ${s.project.destination || 'Mål'}`}</span>
          </button>
        ))}
        <button className="btn" onClick={() => s.setTab('plan')}>Planlegg dagene →</button>
      </section>

      <section className="ov-warn">
        <h4>Varsler og råd</h4>
        <Warnings compact />
      </section>

      <details className="ov-adv">
        <summary>Rute og data (ruter, GPX, NVE, terreng, redigering)</summary>
        <RoutePanel />
      </details>
      <p className="small muted ov-note">Alle ruter er forslag – ikke kontrollert i terrenget. Det du merker som vurdert, er din egen vurdering.</p>
    </div>
  );
}
