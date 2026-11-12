import { useState, type ReactNode } from 'react';
import { useStore, type Tab } from '../state/store';
import { useUiPrefs } from '../state/uiprefs';
import { PAGE_INFO } from '../lib/ux/nav';
import { GLOSSARY } from '../lib/ux/glossary';

/**
 * Felles UX-byggeklosser: samme mønster på alle sider.
 * - PageIntro: hva siden er til, og om den gjelder scenarioet eller hele prosjektet
 * - Advanced: detaljer som er lukket i enkel visning og åpne i detaljert visning
 * - Empty: tom tilstand som forklarer hva du kan gjøre
 * - Term: fagord med forklaring (trykk eller hold over)
 */

export function ScopeChip({ scope }: { scope: 'scenario' | 'prosjekt' | 'app' }) {
  const plan = useStore((s) => s.plans.find((p) => p.id === s.activePlanId) ?? s.plans[0]);
  const project = useStore((s) => s.project.name);
  const setTab = useStore((s) => s.setTab);
  if (scope === 'scenario')
    return (
      <button className="scope sc-scen" onClick={() => setTab('scenarier')} title="Endringer her gjelder bare dette scenarioet. Trykk for å se alle scenarioer.">
        Gjelder scenario <b>{plan?.name}</b>
      </button>
    );
  if (scope === 'prosjekt') return <span className="scope sc-proj" title="Gjelder alle scenarioer i prosjektet">Gjelder hele prosjektet <b>{project}</b></span>;
  return <span className="scope sc-app" title="Gjelder alle prosjekter på denne enheten">Gjelder hele appen</span>;
}

export function DetailToggle() {
  const detailed = useUiPrefs((p) => p.detailed);
  const setPref = useUiPrefs((p) => p.setPref);
  return (
    <div className="viewseg" role="group" aria-label="Visning">
      <button className={!detailed ? 'on' : ''} aria-pressed={!detailed} onClick={() => setPref({ detailed: false })} title="Vis det viktigste – detaljer kan åpnes ved behov">Enkel</button>
      <button className={detailed ? 'on' : ''} aria-pressed={detailed} onClick={() => setPref({ detailed: true })} title="Vis alle detaljer, beregninger og avanserte valg åpne">Detaljert</button>
    </div>
  );
}

export function PageIntro({ tab }: { tab: Tab }) {
  const info = PAGE_INFO[tab];
  const hints = useUiPrefs((p) => p.hints);
  const setPref = useUiPrefs((p) => p.setPref);
  if (!info) return null;
  return (
    <div className={`pageintro pi-${tab} ${hints ? "" : "compact"}`} id="pageintro">
      {hints && <p className="pi-text"><span aria-hidden="true">💡</span> {info.text}</p>}
      <div className="pi-right">
        <ScopeChip scope={info.scope} />
        {info.adv && <DetailToggle />}
        <button className="iconbtn pi-help" onClick={() => setPref({ hints: !hints })} aria-pressed={hints} title={hints ? 'Skjul hjelpetekstene' : 'Vis hjelpetekstene'}>{hints ? 'Skjul hjelp' : '? Hjelp'}</button>
      </div>
    </div>
  );
}

/** Detaljer og avanserte valg: lukket i enkel visning, åpen i detaljert visning – brukeren kan alltid åpne selv. */
export function Advanced({ title, children, hint, className = '', open }: { title: ReactNode; children: ReactNode; hint?: string; className?: string; open?: boolean }) {
  const detailed = useUiPrefs((p) => p.detailed);
  return (
    <details key={String(detailed)} className={`more ${className}`} open={open || detailed}>
      <summary><span className="adv-t">{title}</span>{hint && <span className="adv-h">{hint}</span>}</summary>
      <div className="adv-body">{children}</div>
    </details>
  );
}

export function Empty({ icon = '🧭', title, children, actions }: { icon?: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty" role="status">
      <div className="empty-ic" aria-hidden="true">{icon}</div>
      <div>
        <b>{title}</b>
        {children && <div className="small muted">{children}</div>}
        {actions && <div className="btns">{actions}</div>}
      </div>
    </div>
  );
}

/** Fagord med forklaring. Hold over (PC) eller trykk (mobil). */
export function Term({ k, children }: { k: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const text = GLOSSARY[k.toLowerCase()];
  if (!text) return <>{children ?? k}</>;
  return (
    <span className="term-wrap">
      <button type="button" className="term" title={text} aria-expanded={open} onClick={() => setOpen(!open)} onBlur={() => setOpen(false)}>{children ?? k}</button>
      {open && <span className="term-pop" role="tooltip">{text}</span>}
    </span>
  );
}

/** Neste steg-lenke nederst på en side: hvor det er naturlig å fortsette. */
export function NextStep({ to, children }: { to: Tab; children: ReactNode }) {
  const setTab = useStore((s) => s.setTab);
  return (
    <div className="nextstep">
      <span className="muted small">Neste steg:</span> <button className="btn small primary" onClick={() => { setTab(to); window.scrollTo({ top: 0 }); }}>{children} →</button>
    </div>
  );
}
