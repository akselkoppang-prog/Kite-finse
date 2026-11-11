import { useEffect, useState } from 'react';
import { BUILD } from '../lib/version';
import { flush } from '../storage/persistence';

/** Henter versjonen som ligger på serveren nå (null uten nett). */
async function latestVersion(): Promise<string | null> {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json();
    return typeof j?.version === 'string' ? j.version : null;
  } catch {
    return null;
  }
}

/**
 * Sier fra når en nyere versjon er lagt ut (fanen kan stå åpen i dagevis på et nettbrett).
 * Sjekker ved oppstart, når fanen blir synlig igjen og hver halvtime. Lagrer før omlasting.
 */
export function UpdateBanner() {
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (BUILD.channel === 'dev' || BUILD.channel === 'test') return;
    let last = 0;
    let stop = false;
    const check = async () => {
      if (stop || Date.now() - last < 5 * 60000) return;
      last = Date.now();
      const v = await latestVersion();
      if (!stop && v && v !== BUILD.version) setNext(v);
    };
    void check();
    const onVis = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onVis);
    const t = window.setInterval(check, 30 * 60000);
    return () => {
      stop = true;
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(t);
    };
  }, []);
  if (!next) return null;
  return (
    <div className="banner updateb" role="status">
      Ny versjon er tilgjengelig ({next}). Du bruker {BUILD.version}.
      <button
        className="btn small"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await flush(); // ingenting ulagret går tapt
            const reg = await navigator.serviceWorker?.getRegistration();
            await reg?.update().catch(() => undefined);
          } finally {
            location.reload();
          }
        }}
      >
        {busy ? 'Lagrer og laster …' : 'Lagre og last inn ny versjon'}
      </button>
      <button className="btn small ghost" onClick={() => setNext(null)}>Senere</button>
    </div>
  );
}
