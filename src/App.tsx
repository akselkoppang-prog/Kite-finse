import { lazy, Suspense, useEffect, useState } from 'react';
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

// sider som ikke trengs ved oppstart lastes først når de åpnes (raskere start, særlig på iPad)
const PlannerPage = lazy(() => import('./pages/PlannerPage'));
const WeatherKitePage = lazy(() => import('./pages/WeatherKitePage'));
const WindPage = lazy(() => import('./pages/WindPage'));
const KitePage = lazy(() => import('./pages/KitePage'));
const SafetyPage = lazy(() => import('./pages/SafetyPage'));
const DayPlanPage = lazy(() => import('./pages/DayPlanPage'));
const TimelinePage = lazy(() => import('./pages/TimelinePage'));
const SourcesPage = lazy(() => import('./pages/SourcesPage'));
const OverridesPage = lazy(() => import('./pages/OverridesPage'));
const GearPage = lazy(() => import('./pages/GearPage'));
const SimulatorPage = lazy(() => import('./pages/SimulatorPage'));
const ModelPage = lazy(() => import('./pages/ModelPage'));
const StoragePage = lazy(() => import('./pages/StoragePage'));
const ScenariosPage = lazy(() => import('./pages/ScenariosPage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const ExportPage = lazy(() => import('./pages/ExportPage'));
const VaerPage = lazy(() => import('./pages/VaerPage'));
const NightsPage = lazy(() => import('./pages/NightsPage'));
const FoodPage = lazy(() => import('./pages/FoodPage'));
const StatusPage = lazy(() => import('./pages/StatusPage'));
const TasksPage = lazy(() => import('./pages/TasksPage'));
const TechDetails = lazy(() => import('./components/TechDetails'));

type Main = 'oversikt' | 'plan' | 'vaerkite' | 'utstyr' | 'eksport' | 'innstillinger';
const SECTIONS: { id: Main; label: string; short?: string; icon: string; subs: [Tab, string][] }[] = [
  { id: 'oversikt', label: 'Oversikt', icon: '🗺️', subs: [['oversikt', 'Kart og rute'], ['status', 'Status'], ['oppgaver', 'Oppgaver og team'], ['prosjekter', 'Prosjekt']] },
  { id: 'plan', label: 'Dagplan', icon: '📅', subs: [['plan', 'Dagene'], ['netter', 'Overnatting'], ['scenarier', 'Scenarioer'], ['tidslinje', 'Kalender og sol'], ['dagplan', 'Avansert dagsfordeling']] },
  { id: 'vaerkite', label: 'Vær & kite', icon: '🪁', subs: [['vaer', 'Vær langs ruten'], ['vaerkite', 'Kite og vind'], ['vind', 'Værmelding'], ['simulator', 'Simulator'], ['kite', 'Kitedatabase']] },
  { id: 'utstyr', label: 'Utstyr & planlegging', short: 'Utstyr', icon: '🎒', subs: [['utstyr', 'Utstyr'], ['mat', 'Mat og vann'], ['sikkerhet', 'Sikkerhet'], ['overstyring', 'Vann-godkjenninger']] },
  { id: 'eksport', label: 'Eksport & deling', short: 'Eksport', icon: '📤', subs: [['eksport', 'Eksport & deling']] },
  { id: 'innstillinger', label: 'Innstillinger', short: 'Oppsett', icon: '⚙️', subs: [['lagring', 'Lagring og backup'], ['kilder', 'Datakilder'], ['modell', 'Modell og kalibrering']] },
];
const mainOf = (t: Tab): Main => (t === 'kart' ? 'oversikt' : SECTIONS.find((s) => s.subs.some(([x]) => x === t))?.id ?? 'oversikt');

function HeaderSummary() {
  const { plan, days } = useExpedition();
  const warnings = useWarnings();
  const tripDate = useStore((s) => s.tripDate);
  const dest = useStore((s) => s.project.destination);
  const setTab = useStore((s) => s.setTab);
  const done = days.find((d) => d.remainingKm <= 0.05);
  const imp = warnings.filter((w) => w.level === 'viktig' && !w.ack).length;
  const adv = warnings.filter((w) => w.level === 'advarsel' && !w.ack).length;
  return (
    <div className="hsum">
      <button className="hs" onClick={() => setTab('plan')}>📅 {new Date(`${tripDate}T12:00:00`).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })} · {plan.days.length} dager</button>
      <button className="hs" onClick={() => setTab('plan')}>{done ? `🏁 ${dest || 'Mål'} dag ${done.day} kl. ${hhmm(done.arrival)}` : `⏳ ${days[days.length - 1]?.remainingKm.toFixed(0) ?? '–'} km igjen`}</button>
      {(imp > 0 || adv > 0) && <button className="hs warnhs" onClick={() => setTab('oversikt')}>⚠️ {imp ? `${imp} viktige · ` : ''}{adv} advarsler</button>}
    </div>
  );
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
            <button key={x.id} className={main === x.id ? 'on' : ''} onClick={() => setTab(x.subs[0][0])}>
              <span className="mn-ic">{x.icon}</span><span className="mn-l">{x.label}</span><span className="mn-s">{x.short ?? x.label}</span>
            </button>
          ))}
        </nav>
      </header>
      <div className="subbar">
        {section.subs.length > 1 && (
          <nav className="subnav" aria-label="Undermeny">
            {section.subs.map(([t, l]) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{l}</button>)}
          </nav>
        )}
        <HeaderSummary />
      </div>
      <SaveBanners />
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
        <Suspense fallback={<div className="page"><p className="muted">Laster …</p></div>}>
          {tab === 'plan' && <PlannerPage />}
          {tab === 'scenarier' && <ScenariosPage />}
          {tab === 'prosjekter' && <ProjectsPage />}
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
      </main>
      <footer className="foot small muted">
        Kart © Kartverket (CC BY 4.0) · Hydrologi © NVE · Vær © MET Norge · Skredvarsel © NVE/Varsom. Data hentes direkte fra kildene i nettleseren.
      </footer>
    </div>
    </ExpeditionProvider>
  );
}
