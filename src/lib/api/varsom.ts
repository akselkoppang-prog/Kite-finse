import { fetchJson, validLatLon } from './http';
import type { LatLon } from '../geo';

export interface AvalancheWarning {
  RegionName?: string;
  RegionId?: number;
  DangerLevel?: string | number;
  DangerLevelName?: string;
  ValidFrom?: string;
  ValidTo?: string;
  MainText?: string;
  PublishTime?: string;
}

// Versjoner prøves i rekkefølge; første som svarer brukes og huskes. (Kunne ikke verifiseres fra utviklingsmiljøet.)
const VERSIONS = ['v6.3.0', 'v6.2.1', 'v6.2.0', 'v6.1.0', 'v6.0.0', 'v5.0.1'];
const BASES = VERSIONS.map((v) => `https://api01.nve.no/hydrology/forecast/avalanche/${v}/api/AvalancheWarningByCoordinates/Simple`);
let workingBase: string | null = null;

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function avalancheWarnings(p: LatLon, days = 3): Promise<{ warnings: AvalancheWarning[]; url: string; fetchedAt: string }> {
  const start = new Date();
  const end = new Date(Date.now() + (days - 1) * 86400000);
  if (!validLatLon(p.lat, p.lon)) throw new Error('Ugyldig koordinat');
  let lastErr: unknown;
  for (const b of workingBase ? [workingBase, ...BASES.filter((x) => x !== workingBase)] : BASES) {
    const url = `${b}/${p.lat.toFixed(4)}/${p.lon.toFixed(4)}/1/${ymd(start)}/${ymd(end)}`;
    try {
      const json = await fetchJson<AvalancheWarning[]>('varsom', url, { headers: { Accept: 'application/json' } }, { cacheMs: 15 * 60000, nature: 'prognose', retries: 0 });
      if (!Array.isArray(json)) throw new Error('Uventet svarformat fra Varsom');
      workingBase = b;
      return { warnings: Array.isArray(json) ? json : [], url, fetchedAt: new Date().toISOString() };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Varsom utilgjengelig');
}
