// Grunnleggende geometri. Alle koordinater er WGS84 / EUREF89 (EPSG:4258 ≈ 4326) i desimalgrader.

export type LatLon = { lat: number; lon: number };

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function haversine(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Kurs fra a til b, grader 0–360 (0 = nord). */
export function bearing(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Punkt en gitt avstand (m) og kurs (grader) fra start. */
export function destination(p: LatLon, distM: number, brg: number): LatLon {
  const d = distM / R;
  const b = rad(brg);
  const lat1 = rad(p.lat);
  const lon1 = rad(p.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lon: deg(lon2) };
}

export function interpolate(a: LatLon, b: LatLon, t: number): LatLon {
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

export function cumulative(pts: LatLon[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + haversine(pts[i - 1], pts[i]));
  return out;
}

export function totalLength(pts: LatLon[]): number {
  const c = cumulative(pts);
  return c[c.length - 1] ?? 0;
}

/** Punkt ved gitt avstand langs linjen. */
export function pointAt(pts: LatLon[], cum: number[], distM: number): LatLon {
  if (pts.length === 0) return { lat: 0, lon: 0 };
  if (distM <= 0) return pts[0];
  for (let i = 1; i < pts.length; i++) {
    if (cum[i] >= distM) {
      const seg = cum[i] - cum[i - 1];
      return interpolate(pts[i - 1], pts[i], seg === 0 ? 0 : (distM - cum[i - 1]) / seg);
    }
  }
  return pts[pts.length - 1];
}

export type Sample = LatLon & { d: number; seg: number };

/** Jevn sampling langs linjen hver `step` meter. Beholder også alle originale knekkpunkter. */
export function densify(pts: LatLon[], step: number): Sample[] {
  const out: Sample[] = [];
  if (pts.length === 0) return out;
  let acc = 0;
  out.push({ ...pts[0], d: 0, seg: 0 });
  for (let i = 1; i < pts.length; i++) {
    const L = haversine(pts[i - 1], pts[i]);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push({ ...interpolate(pts[i - 1], pts[i], t), d: acc + L * t, seg: i - 1 });
    }
    acc += L;
  }
  return out;
}

export function nearestOnRoute(pts: LatLon[], p: LatLon): { d: number; dist: number; idx: number } {
  const cum = cumulative(pts);
  let best = { d: 0, dist: Infinity, idx: 0 };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    // lokal flat projeksjon
    const kx = Math.cos(rad((a.lat + b.lat) / 2)) * 111320, ky = 110540;
    const ax = a.lon * kx, ay = a.lat * ky, bx = b.lon * kx, by = b.lat * ky, px = p.lon * kx, py = p.lat * ky;
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
    const qx = ax + t * dx, qy = ay + t * dy;
    const dist = Math.hypot(px - qx, py - qy);
    if (dist < best.dist) best = { d: cum[i - 1] + Math.sqrt(L2) * t, dist, idx: i - 1 };
  }
  return best;
}

export function bbox(pts: LatLon[], padDeg = 0): [number, number, number, number] {
  let minLat = 90, minLon = 180, maxLat = -90, maxLon = -180;
  for (const p of pts) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
  }
  return [minLon - padDeg, minLat - padDeg, maxLon + padDeg, maxLat + padDeg];
}

export const DIRS8 = ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'] as const;
export type Dir8 = (typeof DIRS8)[number];
export const DIR_DEG: Record<Dir8, number> = { N: 0, NØ: 45, Ø: 90, SØ: 135, S: 180, SV: 225, V: 270, NV: 315 };

export function dirName(brg: number): Dir8 {
  return DIRS8[Math.round(((brg % 360) + 360) % 360 / 45) % 8];
}

export function angleDiff(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

export const fmtKm = (m: number) => `${(m / 1000).toFixed(1)} km`;
export const fmtCoord = (p: LatLon) => `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;

/** Grader/minutter-format (som på Garmin: N60°36.006' E007°29.976'). */
export function fmtDM(p: LatLon): string {
  const f = (v: number, pos: string, neg: string, w: number) => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const m = (a - d) * 60;
    return `${v >= 0 ? pos : neg}${String(d).padStart(w, '0')}°${m.toFixed(3).padStart(6, '0')}'`;
  };
  return `${f(p.lat, 'N', 'S', 2)} ${f(p.lon, 'E', 'W', 3)}`;
}

/** Soloppgang/-nedgang (NOAA-forenklet), returnerer timer dagslys. */
export function daylightHours(date: Date, lat: number): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const n = Math.floor((date.getTime() - start) / 86400000);
  const decl = 23.44 * Math.sin(rad((360 / 365) * (n - 81)));
  const h0 = -0.833; // refraksjon + soldiameter
  const cosH = (Math.sin(rad(h0)) - Math.sin(rad(lat)) * Math.sin(rad(decl))) / (Math.cos(rad(lat)) * Math.cos(rad(decl)));
  if (cosH <= -1) return 24;
  if (cosH >= 1) return 0;
  return (2 * deg(Math.acos(cosH))) / 15;
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}
