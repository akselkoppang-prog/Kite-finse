import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { registerSW } from './lib/offline';
import { initPersistence } from './storage/persistence';
import ErrorBoundary from './components/ErrorBoundary';
import { installGlobalErrorLog } from './lib/errlog';
import { useStore } from './state/store';
import { isTab } from './lib/ux/nav';

installGlobalErrorLog();
registerSW();

/** Laster prosjektet fra IndexedDB (og migrerer fra gammel lagring første gang) før appen vises. */
function Boot() {
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState('Åpner lagring …');
  useEffect(() => {
    initPersistence(setMsg)
      .then(() => {
        // lenke rett til en side (#mat, #vaer …) åpner den siden
        const h = decodeURIComponent(location.hash.slice(1));
        if (h && isTab(h)) useStore.getState().setTab(h);
      })
      .catch((e) => setMsg(`Lagring feilet ved oppstart: ${(e as Error).message}`))
      .finally(() => setReady(true));
  }, []);
  if (!ready)
    return (
      <div className="boot">
        <div className="logo">🪁</div>
        <div>{msg}</div>
        <div className="small muted">Prosjektet lagres lokalt i nettleseren (IndexedDB).</div>
      </div>
    );
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary where="app" full>
      <Boot />
    </ErrorBoundary>
  </React.StrictMode>,
);
