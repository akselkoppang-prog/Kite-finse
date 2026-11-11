/**
 * Trygg innsetting av tekst i HTML-strenger (Leaflet-etiketter, utskriftsvindu) og trygge lenker.
 * Prosjektdata kan komme fra importerte filer (ZIP/JSON/GPX/scenario) – alt som settes inn i HTML
 * skal gjennom escHtml, og alle lenker fra data gjennom safeUrl.
 */
const MAP: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' };
export const escHtml = (v: unknown): string => String(v ?? '').replace(/[<>&"']/g, (c) => MAP[c]);

/** Tall til visning: alt som ikke er et endelig tall blir «–» (aldri rå tekst fra data). */
export const numHtml = (v: unknown, digits?: number): string => {
  const n = typeof v === 'number' ? v : Number(v);
  if (v == null || v === '' || !Number.isFinite(n)) return '–';
  return digits == null ? String(n) : n.toFixed(digits);
};

/** Bare http(s)-lenker (og mailto/tel) slippes gjennom; alt annet (javascript:, data: …) blir undefined. */
export function safeUrl(u: unknown): string | undefined {
  if (typeof u !== 'string') return undefined;
  const t = u.trim();
  return /^(https?:\/\/|mailto:|tel:)/i.test(t) ? t : undefined;
}

/** Fargeverdi til style-attributt: bare #hex eller enkle fargenavn. */
export const safeColor = (c: unknown, fallback = '#a855f7'): string => (typeof c === 'string' && /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(c.trim()) ? c.trim() : fallback);
