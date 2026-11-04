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
import OverridesPage from './pages/OverridesPage';
import GearPage from './pages/GearPage';
import LakePanel from './components/LakePanel';
import WaypointPanel from './components/WaypointPanel';
import { TripSummary } from './components/Trip';
import { KITES } from './data/kites';
import { Badge } from './components/ui';
import { fmtKm } from './lib/geo';

const TABS: [Tab, string][] = [
  ['kart', 'Kart & rute'],
  ['vind', 'Vær & vind'],
  ['kite', 'Kite-quiver'],
  ['sikkerhet', 'Sikkerhet'],
  ['dagplan', 'Dagplan'],
  ['overstyring', 'Overstyringer'],
  ['utstyr', 'Utstyr & offline'],
  ['tidslinje', 'Kalender'],
  ['kilder', 'Datakilder'],
];

function Overview() {
  const route = useActiveRoute();
  const { stats } = useProfile(route);
  const check = useBarrierCheck(route);
  const { summary } = useWind(route);
  const windFrom = useStore((s) => s.windFrom);
  const { accepted } = useAcceptance();
  const tripDate = useStore((s) => s.tripDate);
  const tripDays = useStore((s) => s.tripDays);
  const quiver = useStore((s) => s.quivers.find((q) => q.id === s.activeQuiverId));
  const setTab = useStore((s) => s.setTab);
  return (
    <div className="overview">
      <span className="ov"><span className="muted">Tur</span> <b>{tripDate}</b> <span className="muted">· {tripDays} d</span></span>
      <button className="ov link" onClick={() => setTab('kite')} title="Endre quiver">
        <span className="muted">Kites</span> <b>{KITES.filter((k) => quiver?.kiteIds.includes(k.id)).map((k) => `${k.size}${quiver?.primary === k.id ? '★' : ''}`).join(' · ') || '–'}</b>
      </button>
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
  const selWp = useStore((s) => s.selectedWp);
  const selMk = useStore((s) => s.selectedMarker);
  const selBar = useStore((s) => s.selectedBarrier);
  const setTab = useStore((s) => s.setTab);
  const [side, setSide] = useState(window.innerWidth > 900);
  useEffect(() => {
    loadInitialGpx().catch((e) => console.error('GPX', e));
  }, []);
  return (
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
        Alle ruter er <b>FORSLAG – ikke verifisert i terrenget</b>. «Brukergodkjent» er din egen vurdering, ikke uavhengig verifisering. Verktøyet erstatter ikke skredvarsel, isvurdering eller lokalkunnskap.
      </div>
      <main className={`main tab-${tab}`}>
        <div className={`mapwrap ${tab === 'kart' ? '' : 'hidden'}`}>
          <div className={`side ${side ? 'open' : ''}`}>
            <button className="btn small side-toggle" onClick={() => setSide(!side)}>{side ? '◂ Skjul panel' : '▸ Ruteplanlegger'}</button>
            {side && (
              <>
                <TripSummary compact />
                <RoutePanel />
              </>
            )}
          </div>
          <div className="mapcol">
            <div className="mapbox">
              <MapView />
              <LayerPanel />
              {selBar && <LakePanel key={selBar} id={selBar} />}
              {!selBar && selWp && <WaypointPanel key={selWp} kind="wp" id={selWp} />}
              {!selBar && !selWp && selMk && <WaypointPanel key={selMk} kind="marker" id={selMk} />}
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
        {tab === 'overstyring' && <OverridesPage />}
        {tab === 'utstyr' && <GearPage />}
        {tab === 'tidslinje' && <TimelinePage />}
        {tab === 'kilder' && <SourcesPage />}
      </main>
      <footer className="foot small muted">
        Kart © Kartverket (CC BY 4.0) · Hydrologi © NVE · Vær © MET Norge · Skredvarsel © NVE/Varsom. Data hentes direkte fra kildene i nettleseren.
      </footer>
    </div>
  );
}
