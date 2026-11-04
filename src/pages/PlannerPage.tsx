import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { useExpedition, updatePlan, setDayCount, savePlanAs } from '../state/expedition';
import { runExpedition, DAY_COLORS, hhmm, type DayOutcome } from '../lib/sim/expedition';
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

/** Visuell stripe for hele turen: én farget bit per dag, grå = det som gjenstår. */
export function TripStrip({ days, total }: { days: DayOutcome[]; total: number }) {
  return (
    <div className="tripstrip" role="img" aria-label="Fordeling av distansen per dag">
      {days.map((d, i) => {
        const w = (100 * (d.endD - d.startD)) / Math.max(1, total);
        return w > 0 ? <div key={i} style={{ width: `${w}%`, background: DAY_COLORS[i % DAY_COLORS.length] }} title={`Dag ${d.day}: ${((d.endD - d.startD) / 1000).toFixed(0)} km`}>{w > 8 ? `D${d.day} ${((d.endD - d.startD) / 1000).toFixed(0)}` : ''}</div> : null;
      })}
      {days.length > 0 && days[days.length - 1].remainingKm > 0.05 && <div className="rest" style={{ width: `${(100 * days[days.length - 1].remainingKm * 1000) / total}%` }}>{days[days.length - 1].remainingKm.toFixed(0)} km igjen</div>}
    </div>
  );
}

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

  const compare = useMemo(() => {
    if (!ctx) return [];
    return s.plans.filter((p) => s.compareIds.includes(p.id) || p.id === plan.id).map((p) => ({ p, days: p.id === plan.id ? days : runExpedition(p, ctx) }));
  }, [s.plans, s.compareIds, ctx, plan.id, days]);

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
    const vs = [35, 50, 60].map((km) => ({ ...structuredClone(base), id: uid('plan'), name: `Dag 1 = ${km} km`, createdAt: now, updatedAt: now, days: base.days.map((d, i) => (i === 0 ? { ...d, target: { mode: 'km' as const, km } } : { ...d, target: d.target.mode === 'stopp' ? d.target : { mode: 'auto' as const } })) }));
    s.set({ plans: [...s.plans, ...vs], compareIds: [...new Set([...s.compareIds, ...vs.map((v) => v.id)])] });
    setMsg('Tre varianter laget og lagt til sammenligningen nederst. Hovedplanen er uendret.');
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
          <label className="pt-field">Plan
            <select id="plan-sel" value={plan.id} onChange={(e) => s.set({ activePlanId: e.target.value })}>
              {s.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <div className="pt-field">&nbsp;
            <div className="btns">
              <button className="btn small" onClick={() => { const n = prompt('Navn på varianten', `${plan.name} – variant`); if (n) { const id = savePlanAs(n); s.set({ compareIds: [...s.compareIds, id] }); setMsg(`Lagret «${n}». Du redigerer fortsatt «${plan.name}».`); } }}>Lagre som variant</button>
              <button className="btn small ghost" onClick={makeVariants}>Prøv dag 1 = 35 / 50 / 60 km</button>
              {s.plans.length > 1 && plan.id !== 'plan-main' && <button className="btn small danger" onClick={() => { if (confirm(`Slette varianten «${plan.name}»?`)) s.set({ plans: s.plans.filter((p) => p.id !== plan.id), activePlanId: s.plans.find((p) => p.id !== plan.id)!.id }); }}>Slett variant</button>}
            </div>
          </div>
        </div>
        <div className="pt-result">
          {sm.doneDay ? <b className="ok">I Rjukan dag {sm.doneDay.day} ({sm.doneDay.date}) kl. {hhmm(sm.doneDay.arrival)}</b> : <b className="warn">Mangler {sm.remaining.toFixed(0)} km etter dag {plan.days.length} – legg til en dag eller endre planen</b>}
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

      <section className="compare card">
        <h3>Sammenlign planer</h3>
        <div className="seg small">
          {s.plans.map((p) => (
            <label key={p.id} className="chk"><input type="checkbox" checked={p.id === plan.id || s.compareIds.includes(p.id)} disabled={p.id === plan.id} onChange={(e) => s.set({ compareIds: e.target.checked ? [...s.compareIds, p.id] : s.compareIds.filter((x) => x !== p.id) })} />{p.name}</label>
          ))}
        </div>
        {compare.map(({ p, days: ds }) => {
          const m = summary(ds);
          return (
            <div key={p.id} className={`cmprow ${p.id === plan.id ? 'cur' : ''}`}>
              <div className="cmphead">
                <button className="link" onClick={() => s.set({ activePlanId: p.id })}><b>{p.name}</b></button>
                <span className="small">{m.doneDay ? `Rjukan dag ${m.doneDay.day} kl. ${hhmm(m.doneDay.arrival)}` : <span className="warn">mangler {m.remaining.toFixed(0)} km</span>}</span>
              </div>
              <TripStrip days={ds} total={total} />
              <div className="small muted">{ds.map((d) => (d.reason.startsWith('allerede') ? `D${d.day}: reservedag` : `D${d.day}: ${((d.endD - d.startD) / 1000).toFixed(0)} km, ${hhmm(d.departure)}–${hhmm(d.arrival)}, ${kiteShort(d.kiteId)}`)).join(' · ')}</div>
            </div>
          );
        })}
        {s.plans.length < 2 && <p className="small muted">Lag en variant for å sammenligne (f.eks. «Prøv dag 1 = 35 / 50 / 60 km»).</p>}
        <div className="row small">
          <span className="muted">Navn på aktiv plan:</span>
          <input value={plan.name} onChange={(e) => updatePlan((x) => ({ ...x, name: e.target.value }))} aria-label="Navn på plan" />
        </div>
      </section>
    </div>
  );
}
