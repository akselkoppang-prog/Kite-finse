import { useStore, type Tab } from '../state/store';
import { useExpedition, useInsights } from '../state/expedition';
import { forecastFor } from '../lib/plan/context';
import { addDays } from '../lib/sun';
import { useUiPrefs } from '../state/uiprefs';
import { GLOSSARY } from '../lib/ux/glossary';
import { Card } from './ui';
import { Advanced } from './ux';

export interface Step { id: string; title: string; detail: string; done: boolean; waiting?: boolean; tab: Tab; action: string }

const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long' });

/** Stegene i en typisk planlegging – status regnes ut fra prosjektet, så listen viser alltid hva som faktisk gjenstår. */
export function usePlanningSteps(): Step[] {
  const st = useStore();
  const { plan, route } = useExpedition();
  const ins = useInsights();
  const today = new Date().toISOString().slice(0, 10);
  const tripDate = plan.tripDate ?? st.tripDate;
  const daysToGo = Math.round((Date.parse(`${tripDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  const fc = route ? forecastFor(st, route, plan) : null;
  const q = st.quivers.find((x) => x.id === st.activeQuiverId);
  const missing = ins.advice.filter((a) => a.level === 'mangler' || a.level === 'uegnet').length;
  const chosenNights = ins.nights.filter((n) => n.camp).length;
  const open = st.tasks.filter((t) => !t.done).length;
  const exported = st.history.some((h) => h.text.startsWith('Eksport:'));
  const p = st.project;
  return [
    { id: 'prosjekt', title: 'Navn, start og mål', detail: p.origin && p.destination ? `${p.name}: ${p.origin} → ${p.destination}` : 'Gi turen et navn og skriv hvor dere starter og slutter.', done: !!(p.name && p.origin && p.destination), tab: 'prosjekter', action: 'Prosjektet' },
    { id: 'rute', title: 'Ruten', detail: route && route.waypoints.length > 1 ? `«${route.name}» med ${route.waypoints.length} punkter. Se den på kartet.` : 'Last inn en GPX-fil eller tegn ruten på kartet.', done: !!route && route.waypoints.length > 1, tab: 'oversikt', action: 'Kartet' },
    { id: 'dato', title: 'Avreise og antall dager', detail: daysToGo >= 0 ? `${fmt(tripDate)} · ${plan.days.length} dager${daysToGo > 0 ? ` · om ${daysToGo} dager` : ' · i dag'}` : `Avreisedatoen (${fmt(tripDate)}) har passert – velg en ny.`, done: daysToGo >= 0, tab: 'plan', action: 'Dagplanen' },
    { id: 'netter', title: 'Overnatting', detail: ins.nights.length ? `${chosenNights} av ${ins.nights.length} netter har sted.` : 'Endagstur – ingen overnatting.', done: chosenNights === ins.nights.length, tab: 'netter', action: 'Overnatting' },
    { id: 'kites', title: 'Kites', detail: q?.kiteIds.length ? `${q.kiteIds.length} kites i «${q.name}».` : 'Velg hvilke kites dere tar med.', done: !!q?.kiteIds.length, tab: 'vaerkite', action: 'Kitevalg' },
    { id: 'utstyr', title: 'Pakkeliste', detail: `${Math.round(ins.gear.packedPct * 100)} % pakket${missing ? ` · ${missing} mangler eller er uegnet` : ''}.`, done: ins.gear.packedPct >= 0.95 && !missing, tab: 'utstyr', action: 'Pakkelisten' },
    { id: 'mat', title: 'Mat og vann', detail: ins.food.shortDays.length ? `For lite energi dag ${ins.food.shortDays.join(', ')}.` : `${ins.food.totalDays} døgn · ${ins.food.totalKg.toFixed(1)} kg mat.`, done: !ins.food.shortDays.length, tab: 'mat', action: 'Matplanen' },
    { id: 'team', title: 'Team og oppgaver', detail: `${st.team.length} i teamet · ${open} åpne oppgaver.`, done: st.team.length > 0 && open === 0, tab: 'oppgaver', action: 'Oppgaver' },
    { id: 'vaer', title: 'Værmelding', detail: daysToGo > 9 ? `Prognosen kommer ca. ${fmt(addDays(tripDate, -9))}. Til da brukes vinden du har valgt.` : fc?.points ? 'Hentet – se været dag for dag.' : 'Prognose er tilgjengelig – hent den.', done: !!fc?.points, waiting: daysToGo > 9, tab: 'vaer', action: 'Været' },
    { id: 'eksport', title: 'Ta planen med', detail: exported ? 'Eksportert. Lag ny eksport når planen endres.' : 'Lag PDF og GPX, eller en komplett kopi til mobilen.', done: exported, tab: 'eksport', action: 'Eksport' },
  ];
}

export default function GettingStarted() {
  const steps = usePlanningSteps();
  const setTab = useStore((s) => s.setTab);
  const hidden = useUiPrefs((p) => p.guideHidden);
  const setPref = useUiPrefs((p) => p.setPref);
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done && !s.waiting);
  const go = (t: Tab) => { setTab(t); window.scrollTo({ top: 0 }); };
  if (hidden)
    return (
      <div className="wide row small" id="guide-collapsed">
        <span className="muted">Planlegging: {done} av {steps.length} steg ferdig.</span>
        {next && <button className="btn small primary" onClick={() => go(next.tab)}>Neste: {next.title} →</button>}
        <button className="link" onClick={() => setPref({ guideHidden: false })}>Vis stegene</button>
      </div>
    );
  return (
    <Card className="wide" title="Kom i gang – planleggingen steg for steg" right={<button className="link small" onClick={() => setPref({ guideHidden: true })}>Skjul</button>}>
      <div className="guide" id="guide">
        <div className="guide-top">
          <span className="small"><b>{done} av {steps.length}</b> steg ferdig</span>
          <span className="guide-bar" aria-hidden="true"><i style={{ width: `${(done / steps.length) * 100}%` }} /></span>
          {next ? <button className="btn primary" id="guide-next" onClick={() => go(next.tab)}>Neste steg: {next.title} →</button> : <span className="ok small">Alt er på plass 🎉</span>}
        </div>
        <ol className="steps">
          {steps.map((s, i) => (
            <li key={s.id}>
              <button className={`step ${s.done ? 'done' : ''} ${s === next ? 'next' : ''}`} onClick={() => go(s.tab)} aria-label={`${s.title}: ${s.done ? 'ferdig' : s.waiting ? 'venter' : 'gjenstår'}. Åpne ${s.action}`}>
                <span className="sn" aria-hidden="true">{s.done ? '✓' : s.waiting ? '⏳' : i + 1}</span>
                <span><b>{s.title}</b><small>{s.detail}</small></span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

export function Glossary() {
  return (
    <Advanced title="Ordliste" hint="forklaring på fagord i appen" className="wide">
      <dl className="gloss">
        {Object.entries(GLOSSARY).map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
    </Advanced>
  );
}
