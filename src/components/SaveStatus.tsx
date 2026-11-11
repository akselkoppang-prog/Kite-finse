import { useEffect, useState } from 'react';
import { useSave, applyRecovery, flush } from '../storage/persistence';
import { useStore } from '../state/store';
import { useBlobUrl } from '../storage/blobs';
import type { Attachment } from '../types';

const LABEL = {
  loading: { t: 'LASTER …', cls: 'sv-saving' },
  saved: { t: 'LAGRET', cls: 'sv-saved' },
  saving: { t: 'LAGRER …', cls: 'sv-saving' },
  unsaved: { t: 'ULAGREDE ENDRINGER', cls: 'sv-unsaved' },
  warning: { t: 'LAGRINGSVARSEL', cls: 'sv-warning' },
  failed: { t: 'LAGRING FEILET', cls: 'sv-failed' },
  unavailable: { t: 'LAGRES IKKE', cls: 'sv-failed' },
} as const;

/** Lagringsstatus i toppfeltet. «LAGRET» vises først når IndexedDB har bekreftet transaksjonen. */
export function SaveIndicator() {
  const { state, lastSavedAt } = useSave();
  const setTab = useStore((s) => s.setTab);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);
  const l = LABEL[state];
  const ago = lastSavedAt ? Math.round((Date.now() - Date.parse(lastSavedAt)) / 60000) : null;
  return (
    <button className={`saveind ${l.cls}`} onClick={() => setTab('lagring')} title="Innstillinger / Lagring" aria-live="polite">
      <span className="dotst" /> {l.t}
      {lastSavedAt && <span className="muted"> · {ago === 0 ? 'nå' : ago != null && ago < 60 ? `${ago} min siden` : new Date(lastSavedAt).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}</span>}
    </button>
  );
}

/** Varsler som krever handling: feil, plass, nødkopi, migrering. */
export function SaveBanners() {
  const s = useSave();
  const setTab = useStore((x) => x.setTab);
  return (
    <>
      {(s.state === 'failed' || s.state === 'unavailable') && s.error && (
        <div className="banner err">
          ⚠️ {s.error} <button className="btn small" onClick={() => setTab('lagring')}>Last ned / rydd</button>
          {s.state === 'failed' && <button className="btn small ghost" onClick={() => void flush()}>Prøv igjen nå</button>}
        </div>
      )}
      {s.state === 'warning' && s.warning && (
        <div className="banner warnb">⚠️ {s.warning} <button className="btn small" onClick={() => setTab('lagring')}>Åpne lagring</button></div>
      )}
      {s.recovery && (
        <div className="banner warnb">
          Fant ulagrede endringer fra {new Date(s.recovery.at).toLocaleString('nb-NO')} (nødkopi – siden ble lukket eller lagringen feilet før endringene var skrevet).
          <button className="btn small" onClick={() => applyRecovery(true)}>Gjenopprett endringene</button>
          <button className="btn small ghost" onClick={() => applyRecovery(false)}>Ikke nå (behold som sikkerhetskopi)</button>
        </div>
      )}
      {s.migration?.status === 'failed' && (
        <div className="banner err">Flytting fra gammel lagring feilet: {s.migration.error}. De gamle dataene er urørt. <button className="btn small" onClick={() => setTab('lagring')}>Detaljer</button></div>
      )}
    </>
  );
}

/** Viser et lagret bilde (miniatyr) fra IndexedDB, eller en gammel data-URL. */
export function AttachmentImg({ a, full = false }: { a: Attachment; full?: boolean }) {
  const url = useBlobUrl(full ? a.blobId : a.thumbId ?? a.blobId);
  const full_ = useBlobUrl(a.blobId);
  const src = url ?? (a.href?.startsWith('data:image/') ? a.href : null);
  if (!src) return <span className="muted small">bilde mangler</span>;
  return (
    <a href={full_ ?? src} target="_blank" rel="noreferrer" title={`${a.name}${a.size ? ` · ${(a.size / 1024).toFixed(0)} kB` : ''}`}>
      <img src={src} alt={a.name} loading="lazy" />
    </a>
  );
}
