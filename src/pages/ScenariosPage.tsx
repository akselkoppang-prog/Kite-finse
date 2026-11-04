import { useState } from 'react';
import { useStore } from '../state/store';
import { usePlanRuns, duplicatePlan, renamePlan, setPlanNote, setMainPlan, deletePlan, scenarioFile, importScenario } from '../state/expedition';
import { compareRows, SCENARIO_COLORS } from '../lib/plan/compare';
import { summarize } from '../lib/plan/context';
import { hhmm } from '../lib/sim/expedition';
import { download } from '../lib/gpx';
import { slug } from '../lib/project/meta';
import { TripStrip } from '../components/plan/TripStrip';
import ScenarioMap from '../components/ScenarioMap';
import { Card } from '../components/ui';

/** Scenarioer: lagre, gi navn, kopiere, sammenligne, velge hovedplan, dele og slette. */
export default function ScenariosPage() {
  const plans = useStore((s) => s.plans);
  const activeId = useStore((s) => s.activePlanId);
  const mainId = useStore((s) => s.mainPlanId);
  const compareIds = useStore((s) => s.compareIds);
  const routes = useStore((s) => s.routes);
  const camps = useStore((s) => s.camps);
  const dest = useStore((s) => s.project.destination);
  const projectName = useStore((s) => s.project.name);
  const set = useStore((s) => s.set);
  const [msg, setMsg] = useState('');
  const allRuns = usePlanRuns(plans.map((p) => p.id));
  const cmpIds = plans.filter((p) => p.id === activeId || compareIds.includes(p.id)).map((p) => p.id);
  const cmpRuns = allRuns.filter((r) => cmpIds.includes(r.plan.id));
  const rows = compareRows(cmpRuns, camps, dest, useStore.getState());
  const toggle = (id: string, on: boolean) => set({ compareIds: on ? [...new Set([...compareIds, id])] : compareIds.filter((x) => x !== id) });

  return (
    <div className="page">
      <Card title={`Scenarioer (${plans.length})`} className="wide" right={<span className="small muted">★ = hovedplan · ✎ = det du redigerer nå</span>}>
        <p className="small muted">Hvert scenario har egen rute, vind, avreise, kite per dag, fart, kitetimer, pauser, teltplasser og notater. Å endre ett scenario endrer aldri et annet.</p>
        <div className="scenlist">
          {allRuns.map((r) => {
            const p = r.plan;
            const sm = summarize(r);
            const idx = cmpIds.indexOf(p.id);
            return (
              <article key={p.id} className={`scen ${p.id === activeId ? 'cur' : ''}`} aria-label={`Scenario ${p.name}`} style={idx >= 0 ? { borderLeftColor: SCENARIO_COLORS[idx % SCENARIO_COLORS.length] } : undefined}>
                <header className="scen-head">
                  <span className="scen-badges">{p.id === mainId && <span className="pill main">★ Hovedplan</span>}{p.id === activeId && <span className="pill edit">✎ Redigeres</span>}</span>
                  <input className="scen-name" defaultValue={p.name} key={p.name} aria-label="Navn på scenario" onBlur={(e) => e.target.value.trim() && e.target.value !== p.name && renamePlan(p.id, e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                </header>
                <label className="small row">Avreise <input type="date" className="scen-date" value={p.tripDate ?? ''} aria-label={`Avreise ${p.name}`} onChange={(e) => {
                  if (!e.target.value) return;
                  if (p.id === activeId) set({ tripDate: e.target.value });
                  else set({ plans: useStore.getState().plans.map((x) => (x.id === p.id ? { ...x, tripDate: e.target.value, updatedAt: new Date().toISOString() } : x)) });
                }} /></label>
                <div className="scen-sum small">
                  <b>{sm.doneDay ? `${dest || 'Mål'} dag ${sm.doneDay.day} kl. ${hhmm(sm.doneDay.arrival)}` : `${sm.remainingKm.toFixed(0)} km igjen etter dag ${sm.days}`}</b>
                  <span className="muted"> · {sm.days} dager · {sm.totalKm.toFixed(0)} km · rute: {r.route?.name ?? '–'}</span>
                </div>
                {r.ctx && <TripStrip days={r.days} total={r.ctx.total} />}
                <textarea className="scen-note" rows={2} placeholder="Notater for scenarioet (f.eks. «sterk vind dag 1, svakere dag 2»)" defaultValue={p.note ?? ''} onBlur={(e) => e.target.value !== (p.note ?? '') && setPlanNote(p.id, e.target.value)} aria-label="Notat for scenario" />
                <div className="btns">
                  <button className="btn small" onClick={() => set({ activePlanId: p.id, tab: 'plan' })}>{p.id === activeId ? 'Rediger dagene' : 'Åpne og rediger'}</button>
                  <button className="btn small ghost" onClick={() => { const id = duplicatePlan(p.id, undefined, false); toggle(id, true); setMsg(`Kopi av «${p.name}» laget.`); }}>Dupliser</button>
                  {p.id !== mainId && <button className="btn small ghost" onClick={() => { setMainPlan(p.id); setMsg(`«${p.name}» er nå hovedplanen.`); }}>★ Sett som hovedplan</button>}
                  <button className="btn small ghost" onClick={() => download(`${slug(projectName)}_scenario_${slug(p.name)}.json`, JSON.stringify(scenarioFile(p.id), null, 2), 'application/json')}>Del (fil)</button>
                  <label className="chk small cmpchk"><input type="checkbox" checked={idx >= 0} disabled={p.id === activeId} onChange={(e) => toggle(p.id, e.target.checked)} /> Sammenlign</label>
                  {p.id !== mainId && plans.length > 1 && <button className="btn small danger" onClick={() => { if (confirm(`Slette scenarioet «${p.name}»? Dette kan ikke angres (en sikkerhetskopi av prosjektet tas automatisk hvert 10. minutt).`)) { deletePlan(p.id); setMsg(`Slettet «${p.name}».`); } }}>Slett</button>}
                </div>
              </article>
            );
          })}
        </div>
        <div className="row small">
          <button className="btn" onClick={() => { const id = duplicatePlan(mainId, 'Nytt scenario', true); setMsg('Nytt scenario laget som kopi av hovedplanen – du redigerer det nå.'); set({ compareIds: [...new Set([...compareIds, id])] }); }}>+ Nytt scenario (kopi av hovedplanen)</button>
          <label className="btn ghost filebtn">Importer delt scenario …<input type="file" accept=".json,application/json" onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try { const id = importScenario(await f.text()); toggle(id, true); setMsg('Scenarioet er importert som et nytt scenario. Ingenting eksisterende er endret.'); } catch (err) { setMsg(`❌ ${(err as Error).message}`); }
          }} /></label>
          {msg && <span className="msg">{msg}</span>}
        </div>
      </Card>

      <Card title={`Sammenligning (${cmpRuns.length})`} className="wide">
        {cmpRuns.length < 2 ? <p className="small muted">Kryss av «Sammenlign» på minst ett scenario til.</p> : (
          <>
            <div className="tablewrap">
              <table className="cmptable">
                <thead><tr><th />{cmpRuns.map((r, i) => <th key={r.plan.id}><span className="dot" style={{ background: SCENARIO_COLORS[i % SCENARIO_COLORS.length] }} />{r.plan.name}{r.plan.id === mainId ? ' ★' : ''}</th>)}</tr></thead>
                <tbody>{rows.map((row) => <tr key={row.label}><th>{row.label}</th>{row.values.map((v, i) => <td key={i}>{v.split(' · ').map((x, k) => <div key={k}>{x}</div>)}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <ScenarioMap runs={cmpRuns} />
          </>
        )}
        {routes.length > 1 && <p className="small muted">Scenarioer kan bruke ulike ruter: åpne scenarioet og velg rute under Oversikt → «Rute og data». Valget lagres i scenarioet.</p>}
      </Card>
    </div>
  );
}
