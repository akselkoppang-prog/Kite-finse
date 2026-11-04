import { useEffect, useState } from 'react';
import { useStore, type Tab } from './state/store';
import { loadInitialGpx } from './lib/actions';
import MapView from './components/MapView';
import LayerPanel from './components/LayerPanel';
import ElevationProfile from './components/ElevationProfile';
import SubgoalTable from './components/SubgoalTable';
import CompareTable from './components/CompareTable';
import WindPage from './pages/WindPage';
import KitePage from './pages/KitePage';
import SafetyPage from './pages/SafetyPage';
import DayPlanPage from './pages/DayPlanPage';
import TimelinePage from './pages/TimelinePage';
import SourcesPage from './pages/SourcesPage';
import OverridesPage from './pages/OverridesPage';
import GearPage from './pages/GearPage';
import LakePanel from './components/LakePanel';
import WaypointPanel from './components/WaypointPanel';
import SimulatorPage from './pages/SimulatorPage';
import ModelPage from './pages/ModelPage';
import CampPanel from './components/CampPanel';
import { SimPlayer } from './components/sim/SimPlayer';
import StoragePage from './pages/StoragePage';
import PlannerPage from './pages/PlannerPage';
import WeatherKitePage from './pages/WeatherKitePage';
import OverviewPanel from './components/OverviewPanel';
import { ExpeditionProvider, useExpedition } from './state/expedition';
import { useWarnings } from './lib/warnings';
import { hhmm } from './lib/sim/expedition';
import { SaveIndicator, SaveBanners } from './components/SaveStatus';

type Main = 'oversikt' | 'plan' | 'vaerkite' | 'utstyr' | 'innstillinger';
const SECTIONS: { id: Main; label: string; short?: string; icon: string; subs: [Tab, string][] }[] = [
  { id: 'oversikt', label: 'Oversikt', icon: '🗺️', subs: [['oversikt', 'Kart og rute']] },
  { id: 'plan', label: 'Dagplan', icon: '📅', subs: [['plan', 'Dagene'], ['tidslinje', 'Kalender og sol'], ['dagplan', 'Avansert dagsfordeling']] },
  { id: 'vaerkite', label: 'Vær & kite', icon: '🪁', subs: [['vaerkite', 'Kite og vind'], ['vind', 'Værmelding'], ['simulator', 'Simulator'], ['kite', 'Kitedatabase']] },
  { id: 'utstyr', label: 'Utstyr & planlegging', short: 'Utstyr', icon: '🎒', subs: [['utstyr', 'Utstyr og mat'], ['sikkerhet', 'Sikkerhet'], ['overstyring', 'Vann-godkjenninger']] },
  { id: 'innstillinger', label: 'Innstillinger', short: 'Oppsett', icon: '⚙️', subs: [['lagring', 'Lagring og backup'], ['kilder', 'Datakilder'], ['modell', 'Modell og kalibrering']] },
];
const mainOf = (t: Tab): Main => (t === 'kart' ? 'oversikt' : SECTIONS.find((s) => s.subs.some(([x]) => x === t))?.id ?? 'oversikt');

function HeaderSummary() {
  const { plan, days } = useExpedition();
  const warnings = useWarnings();
  const tripDate = useStore((s) => s.tripDate);
  const setTab = useStore((s) => s.setTab);
  const done = days.find((d) => d.remainingKm <= 0.05);
  const imp = warnings.filter((w) => w.level === 'viktig' && !w.ack).length;
  const adv = warnings.filter((w) => w.level === 'advarsel' && !w.ack).length;
  return (
    <div className="hsum">
      <button className="hs" onClick={() => setTab('plan')}>📅 {new Date(`${tripDate}T12:00:00`).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })} · {plan.days.length} dager</button>
      <button className="hs" onClick={() => setTab('plan')}>{done ? `🏁 Rjukan dag ${done.day} kl. ${hhmm(done.arrival)}` : `⏳ ${days[days.length - 1]?.remainingKm.toFixed(0) ?? '–'} km igjen`}</button>
      {(imp > 0 || adv > 0) && <button className="hs warnhs" onClick={() => setTab('oversikt')}>⚠️ {imp ? `${imp} viktige · ` : ''}{adv} advarsler</button>}
    </div>
  );
}

export default function App() {
  const tab = useStore((s) => s.tab);
  const selWp = useStore((s) => s.selectedWp);
  const selMk = useStore((s) => s.selectedMarker);
  const selBar = useStore((s) => s.selectedBarrier);
  const selCamp = useStore((s) => s.selectedCamp);
  const setTab = useStore((s) => s.setTab);
  const [side, setSide] = useState(true);
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
          <span className="logo">🪁</span>
          <div>
            <div className="title">Finse → Rjukan</div>
            <div className="sub">Snowkite-ekspedisjon · mars/april 2027 · planleggingsverktøy</div>
          </div>
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
          <details className="below techdetails">
            <summary>Tekniske detaljer: delmål og sammenligning av ruter</summary>
            <SubgoalTable />
            <CompareTable />
          </details>
        )}
        {tab === 'plan' && <PlannerPage />}
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
      </main>
      <footer className="foot small muted">
        Kart © Kartverket (CC BY 4.0) · Hydrologi © NVE · Vær © MET Norge · Skredvarsel © NVE/Varsom. Data hentes direkte fra kildene i nettleseren.
      </footer>
    </div>
    </ExpeditionProvider>
  );
}
