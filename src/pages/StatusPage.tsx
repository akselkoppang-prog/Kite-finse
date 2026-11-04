import { useStore } from '../state/store';
import { useExpedition, useInsights, usePlanRuns } from '../state/expedition';
import { useWarnings } from '../lib/warnings';
import { useBarrierCheck } from '../state/derived';
import { readiness } from '../lib/project/readiness';
import { forecastFor, summarize } from '../lib/plan/context';
import { hhmm } from '../lib/sim/expedition';
import { addDays } from '../lib/sun';
import { useLinkText } from './TasksPage';
import { Card } from '../components/ui';

const fmtD = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' });

/** Prosjektets dashbord: hva er gjort, hva gjenstår og hva trenger oppmerksomhet – for scenarioet som er åpent. */
export default function StatusPage() {
  const st = useStore();
  const { plan, route, days } = useExpedition();
  const ins = useInsights();
  const warnings = useWarnings();
  const check = useBarrierCheck(route);
  const linkText = useLinkText();
  const today = new Date().toISOString().slice(0, 10);
  const tripDate = plan.tripDate ?? st.tripDate;
  const fc = route ? forecastFor(st, route, plan) : null;
  const daysToGo = Math.round((Date.parse(`${tripDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  const r = readiness({
    today,
    tripDate,
    tasks: st.tasks.filter((t) => !t.scenarioId || t.scenarioId === plan.id),
    ins,
    importantWarnings: warnings.filter((w) => w.level === 'viktig' && !w.ack).length,
    waterChecked: check.waterChecked,
    forecastFetched: !!fc?.points,
    forecastPossible: daysToGo <= 9,
    budget: st.budget,
    expenses: st.expenses,
    campCount: st.camps.length,
  });
  const runs = usePlanRuns(st.plans.map((p) => p.id));
  const milestones = st.tasks.filter((t) => t.milestone || t.priority === 'høy').sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9'));
  const sm = summarize({ plan, route, ctx: null, days });
  const pct = Math.round(r.overall * 100);
  return (
    <div className="page statuspage">
      <Card title={st.project.name} className="wide status-hero">
        <div className="sh-grid">
          <div className="ring" style={{ background: `conic-gradient(${pct >= 80 ? 'var(--green)' : pct >= 55 ? 'var(--yellow)' : 'var(--red)'} ${pct * 3.6}deg, #1d2a44 0)` }}><div><b id="ready-pct">{pct} %</b><small>klar</small></div></div>
          <div className="sh-facts">
            <div><span>Scenario</span><b>{plan.name}{plan.id === st.mainPlanId ? ' ★' : ''}</b></div>
            <div><span>Avreise</span><b>{fmtD(tripDate)}</b><small>{daysToGo > 0 ? `om ${daysToGo} dager` : daysToGo === 0 ? 'i dag' : `${-daysToGo} dager siden`}</small></div>
            <div><span>Ankomst</span><b className={sm.doneDay ? 'ok' : 'warn'}>{sm.doneDay ? `dag ${sm.doneDay.day} kl. ${hhmm(sm.doneDay.arrival)}` : `${sm.remainingKm.toFixed(0)} km igjen`}</b><small>{sm.doneDay ? fmtD(sm.doneDay.date) : ''}</small></div>
            <div><span>Team</span><b>{ins.people} pers.</b><small>{ins.nights.length} netter</small></div>
          </div>
        </div>
      </Card>

      <div className="areas wide">
        {r.areas.map((a) => (
          <button key={a.id} className={`area st-${a.status}`} onClick={() => st.setTab(a.todo[0]?.tab ?? (a.id === 'utstyr' ? 'utstyr' : a.id === 'mat' ? 'mat' : a.id === 'netter' ? 'netter' : a.id === 'vaer' ? 'vaer' : 'oppgaver'))}>
            <span className="area-l">{a.label}</span>
            <span className="area-bar"><i style={{ width: `${Math.round(a.score * 100)}%` }} /></span>
            <small>{a.detail}</small>
          </button>
        ))}
      </div>

      <Card title="Trenger oppmerksomhet" className="wide">
        {r.areas.flatMap((a) => a.todo).length ? (
          <ul className="todo">{r.areas.flatMap((a) => a.todo.map((t, k) => <li key={`${a.id}${k}`}><button className="link" onClick={() => st.setTab(t.tab)}>{t.text}</button></li>))}</ul>
        ) : <p className="ok small">Ingenting som haster akkurat nå.</p>}
      </Card>

      <Card title="Milepæler og frister">
        <ol className="timeline">
          {milestones.map((t) => <li key={t.id} className={t.done ? 'done' : t.due && t.due < today ? 'overdue' : ''}><b>{t.due ? fmtD(t.due) : 'uten frist'}</b> {t.title}{linkText(t) && <small className="muted"> · {linkText(t)}</small>}</li>)}
          <li className="dep"><b>{fmtD(tripDate)}</b> Avreise – {plan.name}</li>
          {sm.doneDay && <li className="dep"><b>{fmtD(addDays(tripDate, sm.doneDay.day - 1))}</b> Ankomst {st.project.destination || 'mål'}</li>}
        </ol>
      </Card>

      <Card title="Scenarioene">
        <table className="cmptable small">
          <thead><tr><th>Scenario</th><th>Avreise</th><th>Ankomst</th><th>Farlig</th></tr></thead>
          <tbody>{runs.map((rn) => { const s = summarize(rn); return <tr key={rn.plan.id} className={rn.plan.id === plan.id ? 'best' : ''}><td><button className="link" onClick={() => st.set({ activePlanId: rn.plan.id })}>{rn.plan.name}{rn.plan.id === st.mainPlanId ? ' ★' : ''}</button></td><td>{fmtD(rn.plan.tripDate ?? st.tripDate)}</td><td>{s.doneDay ? `dag ${s.doneDay.day} ${hhmm(s.doneDay.arrival)}` : `${s.remainingKm.toFixed(0)} km igjen`}</td><td>{rn.plan.id === plan.id ? ins.hazards.filter((h) => h.level === 'viktig').length : '–'}</td></tr>; })}</tbody>
        </table>
        <button className="link small" onClick={() => st.setTab('scenarier')}>Sammenlign i detalj →</button>
      </Card>
    </div>
  );
}
