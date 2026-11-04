import type { SourceId } from '../../data/sources';

/** Hva slags data en kilde leverer – vises alltid ved siden av statusen. */
export type DataNature = 'observert' | 'prognose' | 'kartdata' | 'beregnet' | 'simulert' | 'manuell';

export interface SourceStatus {
  /** Siste kall: true = OK, false = feil, null = aldri kalt */
  ok: boolean | null;
  /** Tidspunkt for siste kall (OK eller feil) */
  at?: string;
  lastOkAt?: string;
  lastErrorAt?: string;
  message?: string;
  url?: string;
  /** Tidsstempel i selve dataene (f.eks. MET «updated_at») */
  dataTime?: string;
  nature?: DataNature;
  httpStatus?: number;
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
  return () => {
    listeners.delete(fn);
  };
}

/** Oppdaterer status uten å slette forrige vellykkede tidspunkt. */
export function report(id: SourceId, s: Partial<SourceStatus> & { ok: boolean }) {
  const prev = sourceStatus[id] ?? { ok: null };
  const now = new Date().toISOString();
  const next: SourceStatus = {
    ...prev,
    ...s,
    at: now,
    lastOkAt: s.ok ? now : prev.lastOkAt,
    lastErrorAt: s.ok ? prev.lastErrorAt : now,
    message: s.ok ? undefined : s.message,
  };
  sourceStatus[id] = next;
  try {
    localStorage.setItem('kite.sourceStatus', JSON.stringify(sourceStatus));
  } catch {
    /* lagring full – status beholdes i minnet */
  }
  listeners.forEach((l) => l(id, next));
}

export class HttpError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

interface CacheEntry { until: number; value: unknown }
const memCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

/** Utløpstid fra Expires / Cache-Control (MET krever at dette respekteres). */
function cacheUntil(res: Response, fallbackMs: number): number {
  const cc = res.headers.get('cache-control');
  const m = cc?.match(/max-age=(\d+)/);
  if (m) return Date.now() + Number(m[1]) * 1000;
  const exp = res.headers.get('expires');
  if (exp) {
    const t = Date.parse(exp);
    if (Number.isFinite(t)) return t;
  }
  return Date.now() + fallbackMs;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchOpts {
  /** Hvor lenge svaret kan gjenbrukes hvis serveren ikke oppgir utløp (ms). 0 = ingen cache. */
  cacheMs?: number;
  nature?: DataNature;
  /** Henter tidsstempel ut av dataene for statusvisning */
  dataTime?: (json: unknown) => string | undefined;
  retries?: number;
  timeoutMs?: number;
}

/**
 * fetch + JSON med: tidsavbrudd, gjentak med eksponentiell backoff ved nettverksfeil/429/5xx
 * (respekterer Retry-After), felles svar for like samtidige kall og minnecache etter Expires.
 * Feil rapporteres alltid – de skjules aldri.
 */
export async function fetchJson<T = unknown>(id: SourceId, url: string, init?: RequestInit, timeoutOrOpts: number | FetchOpts = {}): Promise<T> {
  const opts: FetchOpts = typeof timeoutOrOpts === 'number' ? { timeoutMs: timeoutOrOpts } : timeoutOrOpts;
  const key = `${init?.method ?? 'GET'} ${url} ${typeof init?.body === 'string' ? init.body : ''}`;
  const cached = memCache.get(key);
  if (cached && cached.until > Date.now()) return cached.value as T;
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = (async () => {
    const retries = opts.retries ?? 2;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 20000);
      try {
        const res = await fetch(url, { ...init, signal: ctl.signal });
        if (res.status === 429 || res.status >= 500) {
          const ra = Number(res.headers.get('retry-after'));
          lastErr = new HttpError(`HTTP ${res.status}${res.status === 429 ? ' (for mange forespørsler)' : ''}`, res.status);
          if (attempt < retries) {
            await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 30) * 1000 : 800 * 2 ** attempt);
            continue;
          }
          throw lastErr;
        }
        if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status);
        const text = await res.text();
        let json: T & { error?: { message?: string } };
        try {
          json = JSON.parse(text);
        } catch {
          throw new HttpError(`Ugyldig JSON i svaret (${text.slice(0, 60)}…)`, res.status);
        }
        if (json && typeof json === 'object' && 'error' in json && json.error) throw new HttpError(`Tjenestefeil: ${json.error.message ?? 'ukjent'}`, res.status);
        if ((opts.cacheMs ?? 0) > 0 || res.headers.get('expires')) memCache.set(key, { until: cacheUntil(res, opts.cacheMs ?? 0), value: json });
        report(id, { ok: true, url, httpStatus: res.status, nature: opts.nature, dataTime: opts.dataTime?.(json) });
        return json as T;
      } catch (e) {
        lastErr = e;
        const abort = e instanceof Error && e.name === 'AbortError';
        const http = e instanceof HttpError && e.status && e.status < 500 && e.status !== 429;
        if (http || attempt >= retries) break;
        if (!abort) await sleep(600 * 2 ** attempt);
      } finally {
        clearTimeout(t);
      }
    }
    const e = lastErr;
    const msg = e instanceof Error ? (e.name === 'AbortError' ? 'Tidsavbrudd' : e.message) : String(e);
    const hint = e instanceof TypeError ? ' – nettverk, CORS eller endret adresse' : '';
    report(id, { ok: false, url, message: `${msg}${hint}`, httpStatus: e instanceof HttpError ? e.status : undefined });
    throw new HttpError(msg + hint, e instanceof HttpError ? e.status : undefined);
  })();
  inflight.set(key, p);
  try {
    return (await p) as T;
  } finally {
    inflight.delete(key);
  }
}

export async function fetchText(id: SourceId, url: string, timeoutMs = 20000): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status);
    const txt = await res.text();
    report(id, { ok: true, url, httpStatus: res.status, nature: 'kartdata' });
    return txt;
  } catch (e) {
    const msg = e instanceof Error ? (e.name === 'AbortError' ? 'Tidsavbrudd' : e.message) : String(e);
    report(id, { ok: false, url, message: msg });
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

/** Gyldige koordinater i (eller nær) Norge? Hindrer kall med NaN/byttet lat/lon. */
export function validLatLon(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat > 57 && lat < 72 && lon > 3 && lon < 32;
}
