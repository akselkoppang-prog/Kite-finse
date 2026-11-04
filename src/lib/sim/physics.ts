/**
 * SNOWKITE-FYSIKKMODELL (forenklet, stasjonær kraftbalanse). Ikke CFD.
 *
 * Koordinater: TWA = vinkel mellom kurs og retningen vinden kommer FRA (0° = rett mot vinden).
 *
 * 1) Luft:     ρ = p / (R·T),  p = 101325·(1 − 2,25577e-5·h)^5,25588           [barometrisk formel]
 * 2) Vind i kitehøyde: W_k = W_10 · ln(z_k/z0) / ln(10/z0)                       [logaritmisk profil, z0 snø]
 * 3) Tilsynelatende vind ved fart V:  a_x = W·cosθ + V,  a_y = W·sinθ,  W_a = √(a_x²+a_y²),  AWA = atan2(a_y, a_x)
 * 4) Kitekraft: F = min(½·ρ·A·c_F·W_a², F_hold)   (F_hold = det rytteren tåler i selen; mer kraft depowres bort)
 * 5) Fremdriftsandel: resultanten kan peke innenfor (90° − ε) fra tilsynelatende vind, ε = atan(1/G) (glidetall).
 *    I tillegg kommer bakkens «dragvinkel» λ (skrens på kanten + pulken som drar sidelengs), som avdrift for en båt:
 *       AWA ≥ 90°+ε+λ → hele kraften kan rettes forover
 *       ellers        → F·sin(AWA − ε − λ)   (≤ 0: kan ikke gå høyere mot vinden)
 * 6) Motstand: R(V) = m·g·(μ + stigning) + ½·ρ·CdA·V²
 * 7) Fart: største V ≤ V_komfort der fremdrift ≥ motstand.  V_komfort = maks fart du vil holde med pulk i terrenget.
 * 8) Oppstart: kiten må kunne gi m·g·μ·k_start med aktiv sinusflyging (c_F·dynBoost) – ellers «for lite vind».
 * 9) Overpower: depowret kraft ½·ρ·A·c_F·(1−depower)·W² > F_hold·kasttoleranse.
 *    Bare kastene over grensen → «defensiv kjøring» (fremdrift × defensiveFactor). Middelvinden over grensen → kiten pakkes.
 * 10) Rutefremdrift (VMG): velg kurs θ som maksimerer V(θ)·cos(avvik fra ruten); kryss/jibbe gir ekstra distanse
 *     L/cos(avvik) og stagvendinger ≈ L·tan(avvik)/korridorbredde, hver med tidstap.
 * Alle konstanter er ANTAKELSER som kan endres i appen og kalibreres mot egne GPS-spor.
 */
import type { Snow } from '../analysis/kite';

export const G0 = 9.81;

export interface SimParams {
  riderKg: number;
  pulkKg: number;
  extraKg: number; // utstyr på kroppen / sekk
  snow: Snow;
  muStartFactor: number;
  cdaRider: number;
  holdFactor: number; // F_hold = holdFactor · kroppsvekt · g
  gustTol: number;
  kiteHeightM: number;
  z0: number;
  comfortKmh: number;
  terrainFactor: number; // 1 = slett vidde, 0,85 kupert, 0,65 ru
  groundDragDeg: number; // λ – skrens/pulk sidedrag
  tackSec: number;
  corridorM: number;
  kiteChangeMin: number;
  skiKmh: number;
  walkSteepKmh: number;
  stormWalkFactor: number; // fart (andel av ski) når all vind er for sterk
  defensiveFactor: number; // fremdrift når kastene er over grensen, men middelvinden er innenfor
  variability: number; // variasjonskoeffisient for vind innen timen
  tempC: number;
  usePersonalCalibration: boolean;
}

export const DEFAULT_SIM: SimParams = {
  riderKg: 70,
  pulkKg: 40,
  extraKg: 5,
  snow: 'pakket',
  muStartFactor: 2.5,
  cdaRider: 0.6,
  holdFactor: 0.65,
  gustTol: 1.2,
  kiteHeightM: 20,
  z0: 0.002,
  comfortKmh: 32,
  terrainFactor: 0.9,
  groundDragDeg: 10,
  tackSec: 25,
  corridorM: 800,
  kiteChangeMin: 10,
  skiKmh: 3.5,
  walkSteepKmh: 2.5,
  stormWalkFactor: 0.6,
  defensiveFactor: 0.65,
  variability: 0.2,
  tempC: -8,
  usePersonalCalibration: false,
};

/** Glidefriksjon ski + pulk (antakelser). */
export const SIM_MU: Record<Snow, number> = { skare: 0.03, pakket: 0.045, løs: 0.08, dyp: 0.13 };

export interface KiteInput {
  id: string;
  area: number; // m² (nominell/flat)
  cF: number;
  glide: number;
  depower: number;
  dynBoost: number;
  calib: number; // personlig kalibreringsfaktor på fart (1 = ingen)
  personal?: { low: number; high: number }; // dine egne vindgrenser (m/s, 10 m høyde) – overstyrer fysikkgrensene
}

export function airDensity(tempC: number, elevM: number): number {
  const p = 101325 * Math.pow(1 - 2.25577e-5 * Math.max(0, elevM), 5.25588);
  return p / (287.05 * (tempC + 273.15));
}

export function heightFactor(p: Pick<SimParams, 'kiteHeightM' | 'z0'>): number {
  return Math.log(p.kiteHeightM / p.z0) / Math.log(10 / p.z0);
}

export const mass = (p: SimParams) => p.riderKg + p.pulkKg + p.extraKg;
export const fHold = (p: SimParams) => p.holdFactor * (p.riderKg + p.extraKg) * G0;

const rad = Math.PI / 180;

/** Fremdriftskraft ved fart V (m/s), vind W (m/s i kitehøyde), TWA θ (grader). */
export function drive(k: KiteInput, p: SimParams, rho: number, W: number, twaDeg: number, V: number): number {
  const th = twaDeg * rad;
  const ax = W * Math.cos(th) + V;
  const ay = W * Math.sin(th);
  const Wa2 = ax * ax + ay * ay;
  const awa = Math.atan2(ay, ax); // rad 0..π
  const eps = Math.atan(1 / k.glide) + p.groundDragDeg * rad;
  const F = Math.min(0.5 * rho * k.area * k.cF * Wa2, fHold(p));
  if (awa >= Math.PI / 2 + eps) return F;
  const f = Math.sin(awa - eps);
  return f > 0 ? F * f : 0;
}

export function resistance(p: SimParams, rho: number, V: number, grade = 0): number {
  return mass(p) * G0 * (SIM_MU[p.snow] + grade) + 0.5 * rho * p.cdaRider * V * V;
}

export function vCap(p: SimParams): number {
  return (p.comfortKmh / 3.6) * p.terrainFactor;
}

/** Kan kiten i det hele tatt få deg i gang (aktiv sinusflyging, beste kurs)? */
export function canStart(k: KiteInput, p: SimParams, rho: number, W: number): boolean {
  const F = Math.min(0.5 * rho * k.area * k.cF * k.dynBoost * W * W, fHold(p));
  return F >= mass(p) * G0 * SIM_MU[p.snow] * p.muStartFactor;
}

/** Overpower: depowret kraft i kast over det du tåler. */
export function overpowered(k: KiteInput, p: SimParams, rho: number, gust: number): boolean {
  return 0.5 * rho * k.area * k.cF * (1 - k.depower) * gust * gust > fHold(p) * p.gustTol;
}

/** Fysikkbaserte vindgrenser (m/s i 10 m høyde) for kiten med din last. */
export function physWindow(k: KiteInput, p: SimParams, rho: number): { low: number; high: number } {
  const hf = heightFactor(p);
  const low = Math.sqrt((mass(p) * G0 * SIM_MU[p.snow] * p.muStartFactor) / (0.5 * rho * k.area * k.cF * k.dynBoost)) / hf;
  const high = Math.sqrt((fHold(p) * p.gustTol) / (0.5 * rho * k.area * k.cF * (1 - k.depower))) / hf;
  return { low, high };
}

/** Fart over bakken (m/s) ved TWA θ og vind W (kitehøyde). */
export function solveSpeed(k: KiteInput, p: SimParams, rho: number, W: number, twaDeg: number, grade = 0): { V: number; capped: boolean } {
  const cap = vCap(p);
  for (let V = cap; V >= 0.5; V -= 0.25) {
    if (drive(k, p, rho, W, twaDeg, V) >= resistance(p, rho, V, grade)) return { V: V * k.calib, capped: V >= cap - 1e-9 };
  }
  return { V: 0, capped: false };
}

// ---------- Polartabell (cache) ----------

export const W_STEP = 1;
export const W_MAX = 30;
export const TWA_STEP = 5;

export interface Polar {
  key: string;
  /** v[wi][ti] i m/s, wi = W/W_STEP (kitehøyde), ti = TWA/TWA_STEP */
  v: Float32Array[];
}

const polarCache = new Map<string, Polar>();

export function polarKey(k: KiteInput, p: SimParams, rho: number) {
  return [k.id, k.area, k.cF.toFixed(3), k.glide.toFixed(3), k.calib.toFixed(3), p.groundDragDeg, p.snow, mass(p), fHold(p).toFixed(0), p.cdaRider, vCap(p).toFixed(2), rho.toFixed(3)].join('|');
}

/** ρ avrundes til 0,02 kg/m³ slik at tabeller gjenbrukes (feil < 1 % i kraft). */
export const quantRho = (rho: number) => Math.round(rho / 0.02) * 0.02;

export function polar(k: KiteInput, p: SimParams, rhoIn: number): Polar {
  const rho = quantRho(rhoIn);
  const key = polarKey(k, p, rho);
  const hit = polarCache.get(key);
  if (hit) return hit;
  const v: Float32Array[] = [];
  for (let wi = 0; wi <= W_MAX / W_STEP; wi++) {
    const row = new Float32Array(180 / TWA_STEP + 1);
    for (let ti = 0; ti <= 180 / TWA_STEP; ti++) row[ti] = solveSpeed(k, p, rho, wi * W_STEP, ti * TWA_STEP).V;
    v.push(row);
  }
  const pol = { key, v };
  if (polarCache.size > 400) polarCache.clear();
  polarCache.set(key, pol);
  return pol;
}

/** Bilineær oppslag i polartabellen. */
export function polarV(pol: Polar, W: number, twa: number): number {
  const w = Math.max(0, Math.min(W_MAX - 1e-6, W)) / W_STEP;
  const t = Math.max(0, Math.min(180, twa)) / TWA_STEP;
  const w0 = Math.floor(w), t0 = Math.floor(t);
  const w1 = Math.min(w0 + 1, pol.v.length - 1), t1 = Math.min(t0 + 1, pol.v[0].length - 1);
  const fw = w - w0, ft = t - t0;
  const a = pol.v[w0][t0] * (1 - ft) + pol.v[w0][t1] * ft;
  const b = pol.v[w1][t0] * (1 - ft) + pol.v[w1][t1] * ft;
  return a * (1 - fw) + b * fw;
}

export type CourseMode = 'direkte' | 'kryss oppover' | 'jibbe nedover';

/** Beste fremdrift langs en rute med TWA θr. Returnerer VMG, valgt TWA, avvik og modus. */
export function bestVMG(pol: Polar, W: number, twaRoute: number): { vmg: number; V: number; twa: number; offset: number; mode: CourseMode } {
  const vDirect = polarV(pol, W, twaRoute);
  let best = { vmg: vDirect, V: vDirect, twa: twaRoute, offset: 0, mode: 'direkte' as CourseMode };
  for (let th = 0; th <= 180; th += TWA_STEP) {
    const V = polarV(pol, W, th);
    if (V <= 0) continue;
    // avvik fra ruten på samme side, eller ved å gå på andre siden av vindaksen
    const offs = [Math.abs(th - twaRoute), th + twaRoute, 360 - th - twaRoute].map((o) => Math.min(o, 360 - o));
    const off = Math.min(...offs);
    if (off >= 89) continue;
    const vmg = V * Math.cos(off * rad);
    if (vmg > best.vmg * 1.03) best = { vmg, V, twa: th, offset: off, mode: twaRoute < 90 ? 'kryss oppover' : 'jibbe nedover' };
  }
  return best;
}

/** Klassifisering av ruteetappe etter TWA. */
export function courseClass(twa: number): 'motvind' | 'kryss' | 'halvvind' | 'slør' | 'medvind' {
  if (twa < 40) return 'motvind';
  if (twa < 70) return 'kryss';
  if (twa < 110) return 'halvvind';
  if (twa < 155) return 'slør';
  return 'medvind';
}
