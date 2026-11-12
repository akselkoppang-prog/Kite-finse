import { Suspense, useEffect, useRef, useState } from 'react';
import { useStore, type Tab } from './state/store';
import { loadInitialGpx } from './lib/actions';
import MapView from './components/MapView';
import LayerPanel from './components/LayerPanel';
import ElevationProfile from './components/ElevationProfile';
import LakePanel from './components/LakePanel';
import WaypointPanel from './components/WaypointPanel';
import CampPanel from './components/CampPanel';
import { SimPlayer } from './components/sim/SimPlayer';
import OverviewPanel from './components/OverviewPanel';
import { ExpeditionProvider, useExpedition } from './state/expedition';
import { useWarnings } from './lib/warnings';
import { hhmm } from './lib/sim/expedition';
import { SaveIndicator, SaveBanners } from './components/SaveStatus';
import { useBlobUrl } from './storage/blobs';
import ErrorBoundary, { lazyPage } from './components/ErrorBoundary';
import { UpdateBanner } from './components/UpdateBanner';
import { versionLine, APP_VERSION } from './lib/version';
import { SECTIONS, mainOf, tabLabel } from './lib/ux/nav';
import { PageIntro } from './components/ux';

// sider som ikke trengs ved oppstart lastes først når de åpnes (raskere start, særlig på iPad)
const PlannerPage = lazyPage(() => import('./pages/PlannerPage'));
const WeatherKitePage = lazyPage(() => import('./pages/WeatherKitePage'));
const WindPage = lazyPage(() => import('./pages/WindPage'));
const KitePage = lazyPage(() => import('./pages/KitePage'));
const SafetyPage = lazyPage(() => import('./pages/SafetyPage'));
const DayPlanPage = lazyPage(() => import('./pages/DayPlanPage'));
const TimelinePage = lazyPage(() => import('./pages/TimelinePage'));
const SourcesPage = lazyPage(() => import('./pages/SourcesPage'));
const OverridesPage = lazyPage(() => import('./pages/OverridesPage'));
const GearPage = lazyPage(() => import('./pages/GearPage'));
const SimulatorPage = lazyPage(() => import('./pages/SimulatorPage'));
const ModelPage = lazyPage(() => import('./pages/ModelPage'));
const StoragePage = lazyPage(() => import('./pages/StoragePage'));
const ScenariosPage = lazyPage(() => import('./pages/ScenariosPage'));
const ProjectsPage = lazyPage(() => import('./pages/ProjectsPage'));
const ExportPage = lazyPage(() => import('./pages/ExportPage'));
const VaerPage = lazyPage(() => import('./pages/VaerPage'));
const NightsPage = lazyPage(() => import('./pages/NightsPage'));
const FoodPage = lazyPage(() => import('./pages/FoodPage'));
const StatusPage = lazyPage(() => import('./pages/StatusPage'));
const TasksPage = lazyPage(() => import('./pages/TasksPage'));
const TechDetails = lazyPage(() => import('./components/TechDetails'));

/** Kontekstlinjen: hvilket scenario du jobber i, avreise, resultat og varsler – synlig på alle sider. */
function ContextBar() {
  const { plan, days } = useExpedition();
  const warnings = useWarnings();
  const tripDate = useStore((s) => s.tripDate);
  const dest = useStore((s) => s.project.destination);
  const plans = useStore((s) => s.plans);
  const mainPlanId = useStore((s) => s.mainPlanId);
  const set = useStore((s) => s.set);
  const setTab = useStore((s) => s.setTab);
  const done = days.find((d) => d.remainingKm <= 0.05);
  const imp = warnings.filter((w) => w.level === 'viktig' && !w.ack).length;
  const adv = warnings.filter((w) => w.level === 'advarsel' && !w.ack).length;
  return (
    <div className="hsum">
      <label className="hs scensel" title="Scenarioet du ser på og redigerer. Bytt her – alle sider følger valget.">
        <span className="hs-l">Scenario</span>
        <select id="ctx-scenario" value={plan.id} onChange={(e) => (e.target.value === '__all' ? setTab('scenarier') : set({ activePlanId: e.target.value }))} aria-label="Valgt scenario">
          {plans.map((p) => <option key={p.id} value={p.id}>{p.id === mainPlanId ? '★ ' : ''}{p.name}</option>)}
          <option value="__all">Alle scenarioer og sammenligning …</option>
        </select>
      </label>
      <button className="hs" onClick={() => setTab('plan')} title="Avreise og antall dager – trykk for å endre">📅 {new Date(`${tripDate}T12:00:00`).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })} · {plan.days.length} dager</button>
      <button className="hs hs-arr" onClick={() => setTab('plan')} title="Beregnet ankomst">{done ? `🏁 ${dest || 'Mål'} dag ${done.day} kl. ${hhmm(done.arrival)}` : `⏳ ${days[days.length - 1]?.remainingKm.toFixed(0) ?? '–'} km igjen`}</button>
      {(imp > 0 || adv > 0) && <button className="hs warnhs" onClick={() => setTab('oversikt')} title="Varsler langs ruten – vises i panelet ved kartet">⚠️ {imp ? `${imp} viktige · ` : ''}{adv} advarsler</button>}
    </div>
  );
}

const VALID_TABS = new Set<string>(['kart', ...SECTIONS.flatMap((x) => x.subs.map(([t]) => t))]);

/** Faneskifte følger nettleserens historikk: tilbake-knappen (også på mobil) går til forrige side, og lenker som #mat åpner riktig side. */
function useTabHistory(tab: Tab, setTab: (t: Tab) => void) {
  const first = useRef(true);
  const fromPop = useRef(false);
  useEffect(() => {
    const h = decodeURIComponent(location.hash.slice(1));
    if (h && VALID_TABS.has(h) && h !== tab) { fromPop.current = true; setTab(h as Tab); }
    const onPop = () => {
      const t = decodeURIComponent(location.hash.slice(1));
      if (VALID_TABS.has(t)) { fromPop.current = true; setTab(t as Tab); }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const want = `#${tab}`;
    try {
      if (first.current) { first.current = false; if (location.hash !== want) history.replaceState(history.state, '', want); return; }
      if (fromPop.current) { fromPop.current = false; return; }
      if (location.hash !== want) history.pushState(null, '', want);
    } catch { /* historikk utilgjengelig (f.eks. i innebygd visning) – navigasjonen virker likevel */ }
  }, [tab]);
}

/** Prosjektnavn i toppen – trykk for å bytte eller endre prosjekt. */
function ProjectBadge() {
  const p = useStore((s) => s.project);
  const setTab = useStore((s) => s.setTab);
  const cover = useBlobUrl(p.coverThumbId);
  return (
    <button className="projbadge" onClick={() => setTab('prosjekter')} title="Prosjekter – bytt, gi nytt navn, lag nytt">
      {cover ? <img className="logo img" src={cover} alt="" /> : <span className="logo">{p.icon || '🪁'}</span>}
      <span className="pb-txt">
        <span className="title" id="proj-name-header">{p.name}</span>
        <span className="sub">{[p.origin && p.destination ? `${p.origin} → ${p.destination}` : '', p.description].filter(Boolean).join(' · ') || 'Snowkite-ekspedisjon'} <span className="pb-switch">▾ prosjekter</span></span>
      </span>
    </button>
  );
}

export default function App() {
  const tab = useStore((s) => s.tab);
  const selWp = useStore((s) => s.selectedWp);
  const selMk = useStore((s) => s.selectedMarker);
  const selBar = useStore((s) => s.selectedBarrier);
  const selCamp = useStore((s) => s.selectedCamp);
  const setTab = useStore((s) => s.setTab);
  const [side, setSide] = useState(() => window.innerWidth > 700);
  const [tech, setTech] = useState(false);
  const main = mainOf(tab);
  const section = SECTIONS.find((x) => x.id === main)!;
  const isMap = tab === 'kart' || tab === 'oversikt';
  useTabHistory(tab, setTab);
  // forrige side i en annen seksjon → «Tilbake»-knapp (f.eks. Start → Pakkeliste → tilbake til Start)
  const [prev, setPrev] = useState<{ from: Tab; to: Tab } | null>(null);
  const lastTab = useRef(tab);
  useEffect(() => {
    if (lastTab.current !== tab) setPrev(mainOf(lastTab.current) !== mainOf(tab) ? { from: lastTab.current, to: tab } : null);
    lastTab.current = tab;
  }, [tab]);
  useEffect(() => {
    loadInitialGpx().catch((e) => console.error('GPX', e));
  }, []);
  return (
    <ExpeditionProvider>
    <div className="app">
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <pattern id="hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
            <rect width="8" height="8" fill="rgba(239,68,68,0.12)" />
            <line x1="0" y1="0" x2="0" y2="8" stroke="#ef4444" strokeWidth="3" />
          </pattern>
        </defs>
      </svg>
      <header className="top">
        <div className="brand">
          <ProjectBadge />
          <SaveIndicator />
        </div>
        <nav className="mainnav" aria-label="Hovedmeny">
          {SECTIONS.map((x) => (
            <button key={x.id} className={main === x.id ? 'on' : ''} aria-current={main === x.id ? 'page' : undefined} title={`${x.label}: ${x.hint}`} onClick={() => setTab(main === x.id ? tab : x.subs[0][0])}>
              <span className="mn-ic">{x.icon}</span><span className="mn-l">{x.label}</span><span className="mn-s">{x.short ?? x.label}</span>
            </button>
          ))}
        </nav>
      </header>
      <div className="subbar">
        {prev && prev.to === tab && <button className="btn small ghost backbtn" onClick={() => setTab(prev.from)} title="Tilbake til forrige side">← {tabLabel(prev.from)}</button>}
        {section.subs.length > 1 && (
          <nav className="subnav" aria-label="Undermeny">
            {section.subs.map(([t, l]) => <button key={t} className={tab === t ? 'on' : ''} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>{l}</button>)}
          </nav>
        )}
        <ContextBar />
      </div>
      <PageIntro tab={tab} />
      <SaveBanners />
      <UpdateBanner />
      <main className={`main tab-${tab}`}>
        <div className={`mapwrap ${isMap ? '' : 'hidden'}`}>
          <div className={`side ${side ? 'open' : ''}`}>
            <button className="btn small side-toggle" onClick={() => setSide(!side)}>{side ? '◂ Skjul panel' : '▸ Vis oversikt'}</button>
            {side && <OverviewPanel />}
          </div>
          <div className="mapcol">
            <div className="mapbox">
              <MapView />
              <LayerPanel />
              {selBar && <LakePanel key={selBar} id={selBar} />}
              {!selBar && selWp && <WaypointPanel key={selWp} kind="wp" id={selWp} />}
              {!selBar && !selWp && selMk && <WaypointPanel key={selMk} kind="marker" id={selMk} />}
              {!selBar && !selWp && !selMk && selCamp && <CampPanel key={selCamp} id={selCamp} />}
              <SimPlayer />
            </div>
            <ElevationProfile />
          </div>
        </div>
        {isMap && (
          <details className="below techdetails" onToggle={(e) => setTech((e.target as HTMLDetailsElement).open)}>
            <summary>Tekniske detaljer: delmål og sammenligning av ruter</summary>
            {tech && <Suspense fallback={<p className="small muted">Laster …</p>}><TechDetails /></Suspense>}
          </details>
        )}
        <ErrorBoundary key={tab} where={`side: ${tab}`} onHome={() => setTab('status')}>
        <Suspense fallback={<div className="page"><p className="muted">Laster …</p></div>}>
          {tab === 'plan' && <PlannerPage />}
          {tab === 'scenarier' && <ScenariosPage />}
          {(tab === 'prosjekter' || tab === 'prosjekt') && <ProjectsPage />}
          {tab === 'eksport' && <ExportPage />}
          {tab === 'vaer' && <VaerPage />}
          {tab === 'netter' && <NightsPage />}
          {tab === 'mat' && <FoodPage />}
          {tab === 'status' && <StatusPage />}
          {tab === 'oppgaver' && <TasksPage />}
          {tab === 'vaerkite' && <WeatherKitePage />}
          {tab === 'vind' && <WindPage />}
          {tab === 'kite' && <KitePage />}
          {tab === 'sikkerhet' && <SafetyPage />}
          {tab === 'dagplan' && <DayPlanPage />}
          {tab === 'simulator' && <SimulatorPage />}
          {tab === 'modell' && <ModelPage />}
          {tab === 'overstyring' && <OverridesPage />}
          {tab === 'utstyr' && <GearPage />}
          {tab === 'tidslinje' && <TimelinePage />}
          {tab === 'lagring' && <StoragePage />}
          {tab === 'kilder' && <SourcesPage />}
        </Suspense>
        </ErrorBoundary>
      </main>
      <footer className="foot small muted">
        Kart © Kartverket (CC BY 4.0) · Hydrologi © NVE · Vær © MET Norge · Skredvarsel © NVE/Varsom. Data hentes direkte fra kildene i nettleseren.{' '}
        <button className="link verbtn" id="app-version" title={versionLine()} onClick={() => setTab('kilder')}>Versjon {APP_VERSION}</button>
      </footer>
    </div>
    </ExpeditionProvider>
  );
}
