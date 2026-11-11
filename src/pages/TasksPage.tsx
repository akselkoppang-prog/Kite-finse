import { useState } from 'react';
import { safeUrl } from '../lib/html';
import { useStore } from '../state/store';
import { gearListOf } from '../lib/plan/context';
import { uid } from '../lib/geo';
import type { Task, TaskLinkKind, TeamMember, Expense } from '../lib/project/model';
import { Card } from '../components/ui';

const today = () => new Date().toISOString().slice(0, 10);
const fmtD = (d?: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
const kr = (v: number) => `${Math.round(v).toLocaleString('nb-NO')} kr`;

/** Lesbar tekst for hva en oppgave er knyttet til. */
export function useLinkText() {
  const st = useStore();
  return (t: Task) => {
    const parts: string[] = [];
    if (t.scenarioId) parts.push(`scenario ${st.plans.find((p) => p.id === t.scenarioId)?.name ?? '?'}`);
    const l = t.link;
    if (l?.kind === 'dag' && l.day) parts.push(`dag ${l.day}`);
    if (l?.kind === 'teltplass') parts.push(`overnatting ${st.camps.find((c) => c.id === l.id)?.name ?? '?'}`);
    if (l?.kind === 'utstyr') parts.push(`utstyr ${st.gearLists.flatMap((g) => g.items).find((g) => g.id === l.id)?.name ?? '?'}`);
    if (l?.kind === 'km' && l.km != null) parts.push(`rute km ${l.km}`);
    if (l?.kind === 'krysning') parts.push(`krysning ${st.crossings.find((c) => c.id === l.id)?.name ?? '?'}`);
    return parts.join(' · ');
  };
}

export default function TasksPage() {
  const st = useStore();
  const linkText = useLinkText();
  const [filter, setFilter] = useState<'åpne' | 'alle' | 'mine' | 'scenario'>('åpne');
  const [me, setMe] = useState('');
  const [nt, setNt] = useState<{ title: string; due: string; assignee: string; milestone: boolean; priority: Task['priority']; kind: TaskLinkKind | ''; ref: string; scenario: boolean }>({ title: '', due: '', assignee: '', milestone: false, priority: 'normal', kind: '', ref: '', scenario: false });
  const [nm, setNm] = useState({ name: '', role: '', weightKg: '' });
  const [ne, setNe] = useState({ text: '', amount: '', cat: 'Transport', paidBy: '', planned: false });
  const activePlan = st.plans.find((p) => p.id === st.activePlanId)!;
  const gear = gearListOf(st, activePlan);
  const updT = (id: string, p: Partial<Task>) => st.set({ tasks: st.tasks.map((t) => (t.id === id ? { ...t, ...p } : t)) });
  const updM = (id: string, p: Partial<TeamMember>) => st.set({ team: st.team.map((m) => (m.id === id ? { ...m, ...p } : m)) });
  const tasks = st.tasks
    .filter((t) => (filter === 'åpne' ? !t.done : filter === 'mine' ? t.assignee === me && !t.done : filter === 'scenario' ? t.scenarioId === st.activePlanId : true))
    .sort((a, b) => Number(a.done) - Number(b.done) || (a.due ?? '9999').localeCompare(b.due ?? '9999'));
  const spent = st.expenses.filter((e) => !e.planned).reduce((a, e) => a + e.amount, 0);
  const planned = st.expenses.filter((e) => e.planned).reduce((a, e) => a + e.amount, 0);
  const byCat = [...new Set(st.expenses.map((e) => e.cat))].map((c) => ({ c, sum: st.expenses.filter((e) => e.cat === c).reduce((a, e) => a + e.amount, 0) }));
  const people = Math.max(1, st.team.length);
  const name = (id?: string) => st.team.find((m) => m.id === id)?.name ?? '–';

  const addTask = () => {
    const link = nt.kind ? (nt.kind === 'dag' ? { kind: nt.kind, day: +nt.ref } : nt.kind === 'km' ? { kind: nt.kind, km: +nt.ref } : nt.kind === 'scenario' ? undefined : { kind: nt.kind, id: nt.ref }) : undefined;
    st.set({ tasks: [...st.tasks, { id: uid('task'), title: nt.title, done: false, due: nt.due || undefined, assignee: nt.assignee || undefined, milestone: nt.milestone, priority: nt.priority, scenarioId: nt.scenario || nt.kind === 'scenario' || nt.kind === 'dag' ? st.activePlanId : undefined, link, createdAt: new Date().toISOString() }] });
    setNt({ ...nt, title: '', ref: '' });
  };

  return (
    <div className="page">
      <Card title={`Oppgaver og sjekklister (${st.tasks.filter((t) => !t.done).length} åpne av ${st.tasks.length})`} className="wide">
        <div className="seg">
          {(['åpne', 'alle', 'mine', 'scenario'] as const).map((f) => <button key={f} className={`btn small ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>{f === 'scenario' ? `Scenario «${activePlan.name}»` : f[0].toUpperCase() + f.slice(1)}</button>)}
          {filter === 'mine' && <select value={me} onChange={(e) => setMe(e.target.value)} aria-label="Hvem er du"><option value="">Velg deg selv …</option>{st.team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}
        </div>
        <div className="tasks">
          {tasks.map((t) => {
            const overdue = !t.done && t.due && t.due < today();
            return (
              <div key={t.id} className={`task ${t.done ? 'done' : ''} ${overdue ? 'overdue' : ''}`}>
                <input type="checkbox" checked={t.done} onChange={(e) => updT(t.id, { done: e.target.checked, doneAt: e.target.checked ? new Date().toISOString() : undefined })} aria-label="Ferdig" />
                <div className="task-main">
                  <input className="task-title" value={t.title} onChange={(e) => updT(t.id, { title: e.target.value })} aria-label="Oppgave" />
                  <small className="muted">{t.milestone && <span className="pill main">milepæl</span>} {t.priority === 'høy' && <span className="lv lv-viktig">høy</span>} {t.due && <span className={overdue ? 'err' : ''}>frist {fmtD(t.due)}</span>} {t.assignee && `· ${name(t.assignee)}`} {linkText(t) && `· ${linkText(t)}`}</small>
                </div>
                <select value={t.assignee ?? ''} onChange={(e) => updT(t.id, { assignee: e.target.value || undefined })} aria-label="Ansvarlig"><option value="">Ansvarlig …</option>{st.team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
                <input type="date" value={t.due ?? ''} onChange={(e) => updT(t.id, { due: e.target.value || undefined })} aria-label="Frist" />
                <button className="link danger" onClick={() => confirm(`Slette «${t.title}»?`) && st.set({ tasks: st.tasks.filter((x) => x.id !== t.id) })} aria-label="Slett">✕</button>
              </div>
            );
          })}
          {!tasks.length && <p className="small muted">Ingen oppgaver her.</p>}
        </div>
        <div className="newtask">
          <input id="task-title" placeholder="Ny oppgave, f.eks. «Bestill buss fra Rjukan»" value={nt.title} onChange={(e) => setNt({ ...nt, title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && nt.title && addTask()} />
          <div className="row small">
            <input type="date" value={nt.due} onChange={(e) => setNt({ ...nt, due: e.target.value })} aria-label="Frist" />
            <select value={nt.assignee} onChange={(e) => setNt({ ...nt, assignee: e.target.value })} aria-label="Ansvarlig"><option value="">Ansvarlig …</option>{st.team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
            <select value={nt.priority} onChange={(e) => setNt({ ...nt, priority: e.target.value as Task['priority'] })} aria-label="Prioritet"><option value="lav">lav</option><option value="normal">normal</option><option value="høy">høy</option></select>
            <select id="task-kind" value={nt.kind} onChange={(e) => setNt({ ...nt, kind: e.target.value as TaskLinkKind | '', ref: '' })} aria-label="Knytt til">
              <option value="">Knytt til …</option><option value="scenario">dette scenarioet</option><option value="dag">en dag</option><option value="teltplass">overnatting</option><option value="utstyr">utstyr</option><option value="km">rute (km)</option><option value="krysning">krysning</option>
            </select>
            {nt.kind === 'dag' && <select value={nt.ref} onChange={(e) => setNt({ ...nt, ref: e.target.value })} aria-label="Dag">{activePlan.days.map((_, i) => <option key={i} value={i + 1}>Dag {i + 1}</option>)}</select>}
            {nt.kind === 'teltplass' && <select value={nt.ref} onChange={(e) => setNt({ ...nt, ref: e.target.value })} aria-label="Overnatting"><option value="">velg …</option>{st.camps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
            {nt.kind === 'utstyr' && <select value={nt.ref} onChange={(e) => setNt({ ...nt, ref: e.target.value })} aria-label="Utstyr"><option value="">velg …</option>{gear?.items.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>}
            {nt.kind === 'krysning' && <select value={nt.ref} onChange={(e) => setNt({ ...nt, ref: e.target.value })} aria-label="Krysning"><option value="">velg …</option>{st.crossings.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
            {nt.kind === 'km' && <input type="number" placeholder="km" value={nt.ref} onChange={(e) => setNt({ ...nt, ref: e.target.value })} style={{ width: 70 }} />}
            <label className="chk"><input type="checkbox" checked={nt.milestone} onChange={(e) => setNt({ ...nt, milestone: e.target.checked })} /> milepæl</label>
            <button id="task-add" className="btn small" disabled={!nt.title} onClick={addTask}>Legg til</button>
          </div>
        </div>
      </Card>

      <Card title={`Team (${st.team.length})`}>
        <p className="small muted">Antall personer styrer mat, vann, brensel, teltplass og sengeplasser. Vekt brukes i energibehovet.</p>
        {st.team.map((m) => (
          <div key={m.id} className="row small member">
            <input value={m.name} onChange={(e) => updM(m.id, { name: e.target.value })} aria-label="Navn" />
            <input value={m.role} placeholder="rolle/ansvar" onChange={(e) => updM(m.id, { role: e.target.value })} aria-label="Rolle" />
            <input type="number" value={m.weightKg ?? ''} placeholder="kg" onChange={(e) => updM(m.id, { weightKg: e.target.value === '' ? undefined : +e.target.value })} style={{ width: 64 }} aria-label="Vekt" />
            <input value={m.phone ?? ''} placeholder="telefon" onChange={(e) => updM(m.id, { phone: e.target.value })} style={{ width: 110 }} aria-label="Telefon" />
            <span className="muted">{st.tasks.filter((t) => t.assignee === m.id && !t.done).length} oppg.</span>
            <button className="link danger" onClick={() => confirm(`Fjerne ${m.name} fra teamet?`) && st.set({ team: st.team.filter((x) => x.id !== m.id) })}>✕</button>
          </div>
        ))}
        <div className="row small">
          <input id="member-name" placeholder="Navn" value={nm.name} onChange={(e) => setNm({ ...nm, name: e.target.value })} />
          <input placeholder="Rolle" value={nm.role} onChange={(e) => setNm({ ...nm, role: e.target.value })} />
          <input type="number" placeholder="kg" value={nm.weightKg} onChange={(e) => setNm({ ...nm, weightKg: e.target.value })} style={{ width: 64 }} />
          <button id="member-add" className="btn small" disabled={!nm.name} onClick={() => { st.set({ team: [...st.team, { id: uid('pers'), name: nm.name, role: nm.role, weightKg: nm.weightKg ? +nm.weightKg : undefined }] }); setNm({ name: '', role: '', weightKg: '' }); }}>Legg til</button>
        </div>
      </Card>

      <Card title="Budsjett og utgifter">
        <div className="row small"><span>Budsjett</span><input id="budget" type="number" min={0} value={st.budget || ''} placeholder="kr" onChange={(e) => st.set({ budget: +e.target.value || 0 })} style={{ width: 110 }} /></div>
        <div className="kv small">
          <span>Betalt</span><b>{kr(spent)}</b>
          <span>Planlagt</span><b>{kr(planned)}</b>
          <span>Totalt</span><b className={st.budget && spent + planned > st.budget ? 'err' : ''}>{kr(spent + planned)}{st.budget ? ` av ${kr(st.budget)}` : ''}</b>
          <span>Per person</span><b>{kr((spent + planned) / people)}</b>
        </div>
        {byCat.length > 0 && <p className="small muted">{byCat.map((x) => `${x.c}: ${kr(x.sum)}`).join(' · ')}</p>}
        <table className="cmptable small">
          <tbody>{st.expenses.map((e) => <tr key={e.id}><td>{e.text}</td><td>{e.cat}</td><td>{kr(e.amount)}</td><td>{e.planned ? 'planlagt' : e.paidBy ? `betalt av ${name(e.paidBy)}` : 'betalt'}</td><td><button className="link danger" onClick={() => st.set({ expenses: st.expenses.filter((x) => x.id !== e.id) })}>✕</button></td></tr>)}</tbody>
        </table>
        <div className="row small">
          <input placeholder="Utgift" value={ne.text} onChange={(e) => setNe({ ...ne, text: e.target.value })} />
          <input type="number" placeholder="kr" value={ne.amount} onChange={(e) => setNe({ ...ne, amount: e.target.value })} style={{ width: 90 }} />
          <select value={ne.cat} onChange={(e) => setNe({ ...ne, cat: e.target.value })}>{['Transport', 'Overnatting', 'Mat', 'Utstyr', 'Forsikring', 'Annet'].map((c) => <option key={c}>{c}</option>)}</select>
          <select value={ne.paidBy} onChange={(e) => setNe({ ...ne, paidBy: e.target.value })}><option value="">Betalt av …</option>{st.team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
          <label className="chk"><input type="checkbox" checked={ne.planned} onChange={(e) => setNe({ ...ne, planned: e.target.checked })} /> planlagt</label>
          <button className="btn small" disabled={!ne.text || !ne.amount} onClick={() => { const x: Expense = { id: uid('exp'), text: ne.text, amount: +ne.amount, cat: ne.cat, paidBy: ne.paidBy || undefined, planned: ne.planned, date: today() }; st.set({ expenses: [...st.expenses, x] }); setNe({ ...ne, text: '', amount: '' }); }}>Legg til</button>
        </div>
      </Card>

      <Card title="Dokumenter og lenker">
        {st.documents.map((d) => <div key={d.id} className="row small">{safeUrl(d.url) ? <a href={safeUrl(d.url)} target="_blank" rel="noreferrer">{d.name}</a> : <span>{d.name}</span>} <span className="muted">{d.note}</span> <button className="link danger" onClick={() => st.set({ documents: st.documents.filter((x) => x.id !== d.id) })}>✕</button></div>)}
        <DocAdd />
        <p className="small muted">Personlige notater og kontakter ligger under Prosjekt.</p>
      </Card>
    </div>
  );
}

function DocAdd() {
  const st = useStore();
  const [d, setD] = useState({ name: '', url: '' });
  return (
    <div className="row small">
      <input placeholder="Navn (f.eks. Forsikringsbevis)" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
      <input placeholder="https://…" value={d.url} onChange={(e) => setD({ ...d, url: e.target.value })} />
      <button className="btn small" disabled={!d.name || !/^https?:\/\//.test(d.url)} onClick={() => { st.set({ documents: [...st.documents, { id: uid('doc'), name: d.name, url: d.url }] }); setD({ name: '', url: '' }); }}>Legg til</button>
    </div>
  );
}
