import type { SourceId } from '../../data/sources';

export interface SourceStatus {
  ok: boolean | null;
  at?: string;
  message?: string;
  url?: string;
}

type Listener = (id: SourceId, s: SourceStatus) => void;
const listeners = new Set<Listener>();
export const sourceStatus: Partial<Record<SourceId, SourceStatus>> = loadStatus();

function loadStatus() {
  try {
    return JSON.parse(localStorage.getItem('kite.sourceStatus') || '{}');
  } catch {
    return {};
  }
}

export function onSourceStatus(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function report(id: SourceId, s: SourceStatus) {
  sourceStatus[id] = s;
  try {
    localStorage.setItem('kite.sourceStatus', JSON.stringify(sourceStatus));
  } catch {
    /* ignorer */
  }
  listeners.forEach((l) => l(id, s));
}

export async function fetchJson<T = unknown>(id: SourceId, url: string, init?: RequestInit, timeoutMs = 20000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as T & { error?: { message?: string } };
    if (json && typeof json === 'object' && 'error' in json && json.error) throw new Error(`Tjenestefeil: ${json.error.message ?? 'ukjent'}`);
    report(id, { ok: true, at: new Date().toISOString(), url });
    return json;
  } catch (e) {
    const msg = e instanceof Error ? (e.name === 'AbortError' ? 'Tidsavbrudd' : e.message) : String(e);
    report(id, { ok: false, at: new Date().toISOString(), message: `${msg} (kan være nettverk/CORS/endret URL)`, url });
    throw new Error(msg);
  } finally {
    clearTimeout(t);
  }
}

export async function fetchText(id: SourceId, url: string, timeoutMs = 20000): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const txt = await res.text();
    report(id, { ok: true, at: new Date().toISOString(), url });
    return txt;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    report(id, { ok: false, at: new Date().toISOString(), message: msg, url });
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/** Kjører oppgaver med begrenset samtidighet. */
export async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>, onProgress?: (done: number) => void): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0, done = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
      onProgress?.(++done);
    }
  });
  await Promise.all(workers);
  return out;
}
