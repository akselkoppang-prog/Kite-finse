import { APP_VERSION } from './version';

/**
 * Liten feillogg (siste 30 feil) til feilsøking. Lagres i localStorage (noen få kB) og inneholder
 * bare tidspunkt, versjon, hvor det skjedde og feilmeldingen – ingen prosjektdata.
 */
export interface ErrEntry { at: string; version: string; where: string; message: string; stack?: string }
const KEY = 'kite.errlog';
const MAX = 30;
const listeners = new Set<() => void>();

export function readErrors(): ErrEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function logError(where: string, err: unknown) {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err ?? 'ukjent feil'));
  const entry: ErrEntry = { at: new Date().toISOString(), version: APP_VERSION, where, message: String(e.message).slice(0, 500), stack: e.stack?.split('\n').slice(0, 6).join('\n').slice(0, 1200) };
  try {
    const all = readErrors();
    // samme feil rett etter hverandre logges én gang
    if (all[0]?.message === entry.message && all[0]?.where === entry.where && Date.now() - Date.parse(all[0].at) < 5000) return;
    localStorage.setItem(KEY, JSON.stringify([entry, ...all].slice(0, MAX)));
  } catch {
    /* logging må aldri selv gi feil */
  }
  listeners.forEach((f) => f());
}

export function clearErrors() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* */
  }
  listeners.forEach((f) => f());
}

export const onErrors = (f: () => void) => {
  listeners.add(f);
  return () => void listeners.delete(f);
};

/** Feil ved lasting av en sidefil (typisk etter at en ny versjon er lagt ut mens fanen sto åpen). */
export const isChunkError = (e: unknown) => /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch dynamically|ChunkLoadError|Unable to preload CSS/i.test(String((e as Error)?.message ?? e));

let installed = false;
export function installGlobalErrorLog() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (ev) => {
    // ressursfeil (bilder, kartfliser) har ikke ev.error – de logges ikke
    if (ev.error) logError('vindu', ev.error);
  });
  window.addEventListener('unhandledrejection', (ev) => logError('løfte uten feilhåndtering', ev.reason));
}
