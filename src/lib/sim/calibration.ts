import { angleDiff, bearing, haversine } from '../geo';
import { airDensity, heightFactor, solveSpeed, type KiteInput, type SimParams } from './physics';
import type { Snow } from '../analysis/kite';

/**
 * Kalibrering mot egne GPS-spor.
 * Viktig: GPS gir fart over bakken – ikke kitefart eller aerodynamisk effektivitet. Vi sammenligner derfor
 * målt bakkefart med modellens bakkefart for samme vind, TWA og last, og bruker medianforholdet som personlig
 * kalibreringsfaktor. Produsentdata endres aldri av dette.
 */
export interface TrackPoint { lat: number; lon: number; t: number }

export interface TrackMeta {
  name: string;
  date: string;
  kiteId: string;
  kiteSize: number;
  windSpeed?: number; // m/s, 10 m (ditt anslag eller målt)
  windDir?: number; // fra, grader
  riderKg: number;
  pulkKg: number;
  snow: Snow;
  comment?: string;
}

export interface TrackStats {
  distanceKm: number;
  durationH: number;
  movingH: number;
  stationaryH: number;
  avgMovingKmh: number;
  p90Kmh: number;
  maxKmh: number;
  netProgressKmh: number; // rett linje start→slutt / bevegelsestid
  kmPerHour: number; // total distanse / total tid
  bins?: { label: string; n: number; kmh: number; vmgKmh: number }[];
  modelRatio?: number; // median målt/modell
  modelN?: number;
}

export interface CalibTrack { id: string; meta: TrackMeta; stats: TrackStats; points: [number, number, number][]; addedAt: string }

/** Leser trkpt med <time> (regex – fungerer også utenfor nettleser). */
export function parseTimedGpx(xml: string): TrackPoint[] {
  const out: TrackPoint[] = [];
  const re = /<trkpt[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const tm = m[3].match(/<time>([^<]+)<\/time>/);
    if (!tm) continue;
    const t = Date.parse(tm[1]);
    if (Number.isFinite(t)) out.push({ lat: +m[1], lon: +m[2], t });
  }
  // også lon før lat
  if (!out.length) {
    const re2 = /<trkpt[^>]*lon="([-\d.]+)"[^>]*lat="([-\d.]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;
    while ((m = re2.exec(xml))) {
      const tm = m[3].match(/<time>([^<]+)<\/time>/);
      if (tm && Number.isFinite(Date.parse(tm[1]))) out.push({ lat: +m[2], lon: +m[1], t: Date.parse(tm[1]) });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** 30-sekunders vinduer: fart og kurs. */
function windows(pts: TrackPoint[], sec = 30) {
  const w: { kmh: number; brg: number; dt: number; d: number }[] = [];
  let i0 = 0;
  for (let i = 1; i < pts.length; i++) {
    const dt = (pts[i].t - pts[i0].t) / 1000;
    if (dt >= sec) {
      let d = 0;
      for (let k = i0 + 1; k <= i; k++) d += haversine(pts[k - 1], pts[k]);
      w.push({ kmh: (d / dt) * 3.6, brg: bearing(pts[i0], pts[i]), dt, d });
      i0 = i;
    }
  }
  return w;
}

export function analyseTrack(pts: TrackPoint[], meta: TrackMeta, kite?: KiteInput, params?: SimParams): TrackStats {
  if (pts.length < 2) throw new Error('Sporet har for få punkter med tidsstempel');
  const ws = windows(pts);
  const moving = ws.filter((w) => w.kmh > 4 && w.kmh < 90); // >90 km/t = GPS-feil
  const dist = ws.reduce((a, w) => a + w.d, 0) / 1000;
  const dur = (pts[pts.length - 1].t - pts[0].t) / 3600000;
  const movingH = moving.reduce((a, w) => a + w.dt, 0) / 3600;
  const speeds = moving.map((w) => w.kmh).sort((a, b) => a - b);
  const stats: TrackStats = {
    distanceKm: dist,
    durationH: dur,
    movingH,
    stationaryH: Math.max(0, dur - movingH),
    avgMovingKmh: movingH ? moving.reduce((a, w) => a + w.d, 0) / 1000 / movingH : 0,
    p90Kmh: speeds[Math.floor(speeds.length * 0.9)] ?? 0,
    maxKmh: speeds[speeds.length - 1] ?? 0,
    netProgressKmh: movingH ? haversine(pts[0], pts[pts.length - 1]) / 1000 / movingH : 0,
    kmPerHour: dur ? dist / dur : 0,
  };
  if (meta.windDir != null) {
    const bins = [
      { label: 'Motvind/kryss (<70°)', lo: 0, hi: 70 },
      { label: 'Halvvind (70–110°)', lo: 70, hi: 110 },
      { label: 'Slør (110–155°)', lo: 110, hi: 155 },
      { label: 'Medvind (>155°)', lo: 155, hi: 181 },
    ];
    stats.bins = bins.map((b) => {
      const sel = moving.filter((w) => {
        const twa = angleDiff(w.brg, meta.windDir!);
        return twa >= b.lo && twa < b.hi;
      });
      const h = sel.reduce((a, w) => a + w.dt, 0) / 3600;
      const kmh = h ? sel.reduce((a, w) => a + w.d, 0) / 1000 / h : 0;
      const vmg = h ? sel.reduce((a, w) => a + (w.d / 1000) * Math.abs(Math.cos((angleDiff(w.brg, meta.windDir!) * Math.PI) / 180)), 0) / h : 0;
      return { label: b.label, n: sel.length, kmh, vmgKmh: vmg };
    });
    if (kite && params && meta.windSpeed != null) {
      // Samme komfortgrense som simulatoren: faktoren uttrykker din fart relativt til modellen slik den brukes
      const p = { ...params, riderKg: meta.riderKg, pulkKg: meta.pulkKg, snow: meta.snow };
      const rho = airDensity(params.tempC, 1100);
      const W = meta.windSpeed * heightFactor(p);
      const ratios = moving
        .map((w) => {
          const m = solveSpeed({ ...kite, calib: 1 }, p, rho, W, angleDiff(w.brg, meta.windDir!)).V * 3.6;
          return m > 3 ? w.kmh / m : NaN;
        })
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      if (ratios.length >= 5) {
        stats.modelRatio = ratios[Math.floor(ratios.length / 2)];
        stats.modelN = ratios.length;
      }
    }
  }
  return stats;
}

/** Nedsampler spor for lagring (maks n punkter). */
export function downsample(pts: TrackPoint[], n = 1500): [number, number, number][] {
  const step = Math.max(1, Math.ceil(pts.length / n));
  return pts.filter((_, i) => i % step === 0).map((p) => [+p.lat.toFixed(6), +p.lon.toFixed(6), p.t]);
}

/** Personlig faktor per kite: tidsvektet median av spor med modellsammenligning, avgrenset 0,5–1,5. */
export function calibrationFor(kiteId: string, tracks: CalibTrack[]): { factor: number; n: number } | null {
  const rel = tracks.filter((t) => t.meta.kiteId === kiteId && t.stats.modelRatio != null);
  if (!rel.length) return null;
  const tot = rel.reduce((a, t) => a + t.stats.movingH, 0);
  const sorted = [...rel].sort((a, b) => a.stats.modelRatio! - b.stats.modelRatio!);
  let acc = 0;
  for (const t of sorted) {
    acc += t.stats.movingH;
    if (acc >= tot / 2) return { factor: Math.max(0.5, Math.min(1.5, t.stats.modelRatio!)), n: rel.length };
  }
  return { factor: 1, n: rel.length };
}
