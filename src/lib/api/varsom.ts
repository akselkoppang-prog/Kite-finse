import { fetchJson } from './http';
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

const BASES = [
  'https://api01.nve.no/hydrology/forecast/avalanche/v6.3.0/api/AvalancheWarningByCoordinates/Simple',
  'https://api01.nve.no/hydrology/forecast/avalanche/v5.0.1/api/AvalancheWarningByCoordinates/Simple',
];

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function avalancheWarnings(p: LatLon, days = 3): Promise<{ warnings: AvalancheWarning[]; url: string; fetchedAt: string }> {
  const start = new Date();
  const end = new Date(Date.now() + (days - 1) * 86400000);
  let lastErr: unknown;
  for (const b of BASES) {
    const url = `${b}/${p.lat.toFixed(4)}/${p.lon.toFixed(4)}/1/${ymd(start)}/${ymd(end)}`;
    try {
      const json = await fetchJson<AvalancheWarning[]>('varsom', url, { headers: { Accept: 'application/json' } });
      return { warnings: Array.isArray(json) ? json : [], url, fetchedAt: new Date().toISOString() };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Varsom utilgjengelig');
}
