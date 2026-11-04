import type { LatLon } from '../geo';

/**
 * Kartbilde til PDF: ekte Kartverket-fliser (WMTS-cache, Web Mercator) satt sammen på et lerret.
 * Vektorer (rute, dagsfarger, punkter) tegnes etterpå direkte i PDF-en med samme projeksjon, så de blir skarpe.
 * Hvis flisene ikke kan hentes (offline / CORS), returneres dataUrl = null og PDF-en tegner et nøytralt
 * koordinatnett i stedet – aldri et oppdiktet terrengkart.
 */
export const KV_TOPO = 'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png';
export const KV_ATTR = 'Kartgrunnlag: © Kartverket (topo, CC BY 4.0)';

const TILE = 256;
const mx = (lon: number) => (lon + 180) / 360; // 0..1
const my = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
const lonOf = (x: number) => x * 360 - 180;
const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

export interface MapFrame {
  /** Mercator-utsnitt (0..1-koordinater) */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  zoom: number;
  dataUrl: string | null;
  source: 'kartverket' | 'ingen';
  tilesOk: number;
  tilesTotal: number;
  /** Projiser lat/lon → brøkdel (0..1) av bildet */
  proj: (p: LatLon) => [number, number];
  /** Omvendt: brøkdel → lat/lon (til koordinatnett) */
  unproj: (fx: number, fy: number) => LatLon;
  /** meter per brøkdel horisontalt (for målestokk) */
  metersPerFracX: number;
}

/** Utsnitt rundt punktene med gitt sideforhold (bredde/høyde) og margin. */
export function frameFor(points: LatLon[], aspect: number, pad = 0.08, minSpanM = 3000): Omit<MapFrame, 'zoom' | 'dataUrl' | 'source' | 'tilesOk' | 'tilesTotal'> {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of points) {
    const x = mx(p.lon), y = my(p.lat);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (!Number.isFinite(x0)) { x0 = mx(8); x1 = mx(8.5); y0 = my(60.3); y1 = my(60); }
  const latMid = latOf((y0 + y1) / 2);
  const mPerX = 40075016.686 * Math.cos((latMid * Math.PI) / 180); // meter per 1.0 i x
  const minSpan = minSpanM / mPerX;
  let w = Math.max(x1 - x0, minSpan), h = Math.max(y1 - y0, minSpan);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  w *= 1 + 2 * pad;
  h *= 1 + 2 * pad;
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  const f = { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 };
  return {
    ...f,
    proj: (p: LatLon) => [(mx(p.lon) - f.x0) / (f.x1 - f.x0), (my(p.lat) - f.y0) / (f.y1 - f.y0)],
    unproj: (fx: number, fy: number) => ({ lon: lonOf(f.x0 + fx * (f.x1 - f.x0)), lat: latOf(f.y0 + fy * (f.y1 - f.y0)) }),
    metersPerFracX: (f.x1 - f.x0) * mPerX,
  };
}

async function loadTile(url: string, signal: AbortSignal): Promise<ImageBitmap | HTMLImageElement | null> {
  try {
    const res = await fetch(url, { mode: 'cors', signal });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    if (typeof createImageBitmap === 'function') return await createImageBitmap(blob);
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    await img.decode();
    return img;
  } catch {
    // service worker / Cache API kan ha flisen (bare hvis den ble hentet med CORS)
    try {
      if (!('caches' in window)) return null;
      const hit = await caches.match(url);
      if (!hit || hit.type === 'opaque') return null;
      return await createImageBitmap(await hit.blob());
    } catch {
      return null;
    }
  }
}

/**
 * Lag et kartbilde. widthPx styrer oppløsningen (≈ 150–200 dpi i PDF-en). Maks antall fliser begrenses for å
 * være skånsom mot Kartverkets tjeneste.
 */
export async function renderMap(points: LatLon[], aspect: number, widthPx = 1800, opts: { pad?: number; maxTiles?: number; url?: string; timeoutMs?: number } = {}): Promise<MapFrame> {
  const fr = frameFor(points, aspect, opts.pad ?? 0.08);
  const spanX = fr.x1 - fr.x0;
  let zoom = Math.max(5, Math.min(15, Math.round(Math.log2(widthPx / (spanX * TILE)))));
  const count = (z: number) => {
    const n = 2 ** z;
    return (Math.floor(fr.x1 * n) - Math.floor(fr.x0 * n) + 1) * (Math.floor(fr.y1 * n) - Math.floor(fr.y0 * n) + 1);
  };
  while (zoom > 5 && count(zoom) > (opts.maxTiles ?? 90)) zoom--;
  const n = 2 ** zoom;
  const tx0 = Math.floor(fr.x0 * n), tx1 = Math.floor(fr.x1 * n), ty0 = Math.floor(fr.y0 * n), ty1 = Math.floor(fr.y1 * n);
  const pxW = Math.round(spanX * n * TILE), pxH = Math.round((fr.y1 - fr.y0) * n * TILE);
  const base = { ...fr, zoom, tilesTotal: (tx1 - tx0 + 1) * (ty1 - ty0 + 1) };
  if (typeof document === 'undefined') return { ...base, dataUrl: null, source: 'ingen', tilesOk: 0 };
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, pxW);
  canvas.height = Math.max(1, pxH);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#eef2f5';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
  const jobs: { x: number; y: number }[] = [];
  for (let x = tx0; x <= tx1; x++) for (let y = ty0; y <= ty1; y++) jobs.push({ x, y });
  let ok = 0, i = 0;
  const url = opts.url ?? KV_TOPO;
  const worker = async () => {
    while (i < jobs.length) {
      const j = jobs[i++];
      const img = await loadTile(url.replace('{z}', String(zoom)).replace('{x}', String(j.x)).replace('{y}', String(j.y)), ctrl.signal);
      if (img) {
        ctx.drawImage(img as CanvasImageSource, Math.round(j.x * TILE - fr.x0 * n * TILE), Math.round(j.y * TILE - fr.y0 * n * TILE), TILE, TILE);
        ok++;
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  clearTimeout(timer);
  if (ok < base.tilesTotal * 0.6) return { ...base, dataUrl: null, source: 'ingen', tilesOk: ok };
  let dataUrl: string | null = null;
  try {
    dataUrl = canvas.toDataURL('image/jpeg', 0.86);
  } catch {
    dataUrl = null; // «tainted» lerret – fliser uten CORS
  }
  return { ...base, dataUrl, source: dataUrl ? 'kartverket' : 'ingen', tilesOk: ok };
}
