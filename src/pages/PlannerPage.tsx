import { useState } from 'react';
import { useStore } from '../state/store';
import { useExpedition, setDayCount, savePlanAs } from '../state/expedition';
import { hhmm, type DayOutcome } from '../lib/sim/expedition';
import { addDays, daysBetween } from '../lib/sun';
import { forecast } from '../lib/api/met';
import { cumulative, pointAt } from '../lib/geo';
import DayCard from '../components/plan/DayCard';
import { kiteShort } from '../components/plan/KiteChips';
import { uid } from '../lib/geo';

function summary(days: DayOutcome[]) {
  const last = days[days.length - 1];
  const doneDay = days.find((d) => d.remainingKm <= 0.05);
  return { last, doneDay, remaining: last?.remainingKm ?? 0 };
}

export { TripStrip } from '../components/plan/TripStrip';
import { TripStrip } from '../components/plan/TripStrip';

export default function PlannerPage() {
  const s = useStore();
  const { plan, ctx, days } = useExpedition();
  const [fcBusy, setFcBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const lastDate = addDays(s.tripDate, plan.days.length - 1);
  const inHorizon = daysBetween(today, lastDate) <= 9 && daysBetween(today, s.tripDate) >= -1;
  const forecastAvailable = inHorizon && !!s.routeForecast?.points.length;
  const sm = summary(days);
  const total = ctx?.total ?? 0;

  const fetchForecast = async () => {
    if (!ctx) return;
    setFcBusy(true);
    const cum = cumulative(ctx.route);
    const n = Math.max(2, Math.round(ctx.total / 15000) + 1);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const d = (ctx.total * i) / (n - 1);
      const p = pointAt(ctx.route, cum, d);
      try {
        pts.push({ ...p, d, label: `${(d / 1000).toFixed(0)} km`, fc: await forecast({ ...p, label: `${(d / 1000).toFixed(0)} km` }) });
      } catch (e) {
        setMsg(`Værmelding feilet: ${(e as Error).message}`);
      }
    }
    if (pts.length) s.set({ routeForecast: { points: pts, fetchedAt: new Date().toISOString() } });
    setFcBusy(false);
  };

  const makeVariants = () => {
    const base = structuredClone(plan);
    const now = new Date().toISOString();
    const vs = [35, 50, 60].map((km) => ({ ...structuredClone(base), id: uid('plan'), routeId: base.routeId ?? s.activeRouteId ?? undefined, name: `Dag 1 = ${km} km`, createdAt: now, updatedAt: now, days: base.days.map((d, i) => (i === 0 ? { ...d, target: { mode: 'km' as const, km } } : { ...d, target: d.target.mode === 'stopp' ? d.target : { mode: 'auto' as const } })) }));
    s.set({ plans: [...s.plans, ...vs], compareIds: [...new Set([...s.compareIds, plan.id, ...vs.map((v) => v.id)])] });
    setMsg('Tre nye scenarioer laget og lagt i sammenligningen (Scenarioer). Scenarioet du redigerer er uendret.');
  };

  return (
    <div className="planner">
      <section className="plan-top">
        <div className="pt-row">
          <label className="pt-field">Avreisedato
            <input id="plan-date" type="date" value={s.tripDate} onChange={(e) => e.target.value && s.set({ tripDate: e.target.value })} />
          </label>
          <div className="pt-field">Antall dager
            <div className="seg">
              {[2, 3, 4, 5].map((n) => <button key={n} className={`btn ${plan.days.length === n ? 'on' : ''}`} onClick={() => setDayCount(n)}>{n}</button>)}
              <button className="btn ghost" onClick={() => setDayCount(plan.days.length + 1)} aria-label="Legg til dag">+</button>
              {plan.days.length > 1 && <button className="btn ghost" onClick={() => setDayCount(plan.days.length - 1)} aria-label="Fjern siste dag">−</button>}
            </div>
          </div>
          <label className="pt-field">Scenario
            <select id="plan-sel" value={plan.id} onChange={(e) => s.set({ activePlanId: e.target.value })}>
              {s.plans.map((p) => <option key={p.id} value={p.id}>{p.id === s.mainPlanId ? '★ ' : ''}{p.name}</option>)}
            </select>
          </label>
          <div className="pt-field">&nbsp;
            <div className="btns">
              <button className="btn small" onClick={() => { const n = prompt('Navn på det nye scenarioet', `${plan.name} – variant`); if (n) { const id = savePlanAs(n); s.set({ compareIds: [...new Set([...s.compareIds, plan.id, id])] }); setMsg(`Lagret «${n}» som eget scenario. Du redigerer fortsatt «${plan.name}».`); } }}>Lagre som nytt scenario</button>
              <button className="btn small ghost" onClick={makeVariants}>Prøv dag 1 = 35 / 50 / 60 km</button>
              <button className="btn small ghost" onClick={() => s.setTab('scenarier')}>Sammenlign …</button>
            </div>
          </div>
        </div>
        <div className="pt-result">
          {sm.doneDay ? <b className="ok">I {s.project.destination || 'mål'} dag {sm.doneDay.day} ({sm.doneDay.date}) kl. {hhmm(sm.doneDay.arrival)}</b> : <b className="warn">Mangler {sm.remaining.toFixed(0)} km etter dag {plan.days.length} – legg til en dag eller endre planen</b>}
          <span className="muted"> · {(total / 1000).toFixed(0)} km rute · {plan.days.length} dager · kites: {days.map((d) => kiteShort(d.kiteId)).join(' → ')}</span>
        </div>
        <TripStrip days={days} total={total} />
        <div className="small muted">
          {inHorizon ? (
            <>Datoen er innenfor værmeldingen. <button className="btn small" onClick={fetchForecast} disabled={fcBusy}>{fcBusy ? 'Henter …' : s.routeForecast ? 'Oppdater værmelding' : 'Hent værmelding langs ruten'}</button></>
          ) : (
            <>Ingen værmelding for {s.tripDate} ennå (MET gir ~9 døgn frem, fra ca. {addDays(s.tripDate, -9)}). Vinden under er ditt eget scenario.</>
          )}
          {msg && <span className="msg"> {msg}</span>}
        </div>
      </section>

      <div className="daycards">
        {plan.days.map((d, i) => <DayCard key={d.id} i={i} day={d} out={days[i]} forecastAvailable={forecastAvailable} />)}
      </div>

      <p className="small muted center">Vil du sammenligne scenarioer, gi dem nytt navn eller velge hovedplan? <button className="link" onClick={() => s.setTab('scenarier')}>Scenarioer og sammenligning →</button></p>
    </div>
  );
}
