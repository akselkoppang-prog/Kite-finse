import { useEffect, useState } from 'react';
import { useStore, type Tab } from './state/store';
import { useActiveRoute, useBarrierCheck, useProfile, useWind } from './state/derived';
import { loadInitialGpx } from './lib/actions';
import MapView from './components/MapView';
import LayerPanel from './components/LayerPanel';
import RoutePanel from './components/RoutePanel';
import ElevationProfile from './components/ElevationProfile';
import SubgoalTable from './components/SubgoalTable';
import CompareTable from './components/CompareTable';
import WindPage from './pages/WindPage';
import KitePage from './pages/KitePage';
import SafetyPage, { useAcceptance } from './pages/SafetyPage';
import DayPlanPage from './pages/DayPlanPage';
import TimelinePage from './pages/TimelinePage';
import SourcesPage from './pages/SourcesPage';
import { Badge } from './components/ui';
import { fmtKm } from './lib/geo';

const TABS: [Tab, string][] = [
  ['kart', 'Kart & rute'],
  ['vind', 'Vær & vind'],
  ['kite', 'Kite-quiver'],
  ['sikkerhet', 'Sikkerhet'],
  ['dagplan', 'Dagplan'],
  ['tidslinje', 'Tidslinje'],
  ['kilder', 'Datakilder'],
];

function Overview() {
  const route = useActiveRoute();
  const { stats } = useProfile(route);
  const check = useBarrierCheck(route);
  const { summary } = useWind(route);
  const windFrom = useStore((s) => s.windFrom);
  const { accepted } = useAcceptance();
  return (
    <div className="overview">
      <span className="ov"><span className="muted">Rute</span> <b>{route?.name ?? '–'}</b></span>
      <span className="ov"><span className="muted">Distanse</span> <b>{fmtKm(stats.total)}</b></span>
      <span className="ov"><span className="muted">↑</span> <b>{Math.round(stats.up)} m</b> <span className="muted">↓</span> <b>{Math.round(stats.down)} m</b></span>
      <span className="ov"><span className="muted">Vann</span> <Badge s={check.status} /></span>
      <span className="ov"><span className="muted">Vind {windFrom}</span> <b>{Math.round(summary.good * 100)} %</b> <span className="muted">gunstig</span></span>
      <span className="ov"><span className="muted">Ruteaksept</span> <Badge s={accepted ? 'GUL' : 'RØD'}>{accepted ? 'OK for planlegging' : 'Blokkert'}</Badge></span>
    </div>
  );
}

export default function App() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const [side, setSide] = useState(window.innerWidth > 900);
  useEffect(() => {
    loadInitialGpx().catch((e) => console.error('GPX', e));
  }, []);
  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo">🪁</span>
          <div>
            <div className="title">Finse → Rjukan</div>
            <div className="sub">Snowkite-ekspedisjon · mars/april 2027 · planleggingsverktøy</div>
          </div>
        </div>
        <nav className="tabs">
          {TABS.map(([t, l]) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {l}
            </button>
          ))}
        </nav>
      </header>
      <Overview />
      <div className="banner">
        Alle ruter er <b>FORSLAG – ikke verifisert i terrenget</b>. Regulerte og ikke-verifiserte vann skal ikke krysses. Verktøyet erstatter ikke egen vurdering, skredvarsel eller lokalkunnskap.
      </div>
      <main className={`main tab-${tab}`}>
        <div className={`mapwrap ${tab === 'kart' ? '' : 'hidden'}`}>
          <div className={`side ${side ? 'open' : ''}`}>
            <button className="btn small side-toggle" onClick={() => setSide(!side)}>{side ? '◂ Skjul panel' : '▸ Ruteplanlegger'}</button>
            {side && <RoutePanel />}
          </div>
          <div className="mapcol">
            <div className="mapbox">
              <MapView />
              <LayerPanel />
            </div>
            <ElevationProfile />
          </div>
        </div>
        {tab === 'kart' && (
          <div className="below">
            <SubgoalTable />
            <CompareTable />
          </div>
        )}
        {tab === 'vind' && <WindPage />}
        {tab === 'kite' && <KitePage />}
        {tab === 'sikkerhet' && <SafetyPage />}
        {tab === 'dagplan' && <DayPlanPage />}
        {tab === 'tidslinje' && <TimelinePage />}
        {tab === 'kilder' && <SourcesPage />}
      </main>
      <footer className="foot small muted">
        Kart © Kartverket (CC BY 4.0) · Hydrologi © NVE · Vær © MET Norge · Skredvarsel © NVE/Varsom. Data hentes direkte fra kildene i nettleseren.
      </footer>
    </div>
  );
}
