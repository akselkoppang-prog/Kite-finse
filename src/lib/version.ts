/**
 * Appens versjon – ENESTE sted resten av appen leser den fra.
 * Format: YYYY.MM.DD.BUILD (UTC-dato + løpenummer per dag). Genereres ved hvert bygg av scripts/version.mjs
 * og legges inn av Vite. Uavhengig av bruker- og prosjektdata.
 */
export interface BuildInfo {
  version: string;
  date: string;
  build: number;
  /** publisert = nummer reservert i byggeløypa · lokal = bygget på egen maskin · dev = utviklingsserver */
  channel: 'publisert' | 'lokal' | 'ureservert' | 'dev' | 'test';
  builtAt: string;
  commit: string;
  dirty: boolean;
}

export const BUILD: BuildInfo =
  typeof __BUILD_INFO__ !== 'undefined' && __BUILD_INFO__
    ? __BUILD_INFO__
    : { version: '0000.00.00.000-test', date: '0000.00.00', build: 0, channel: 'test', builtAt: new Date(0).toISOString(), commit: 'test', dirty: false };

export const APP_VERSION = BUILD.version;

/** «2026.11.10.003 · bygget 10.11.2026 14:05 UTC · a1b2c3d» */
export function versionLine(): string {
  const t = BUILD.builtAt.replace('T', ' ').slice(0, 16);
  return `${BUILD.version} · bygget ${t} UTC · ${BUILD.commit}`;
}

/** Felter som legges ved eksporter og diagnose. */
export const versionStamp = () => ({ appVersion: BUILD.version, appBuiltAt: BUILD.builtAt, appCommit: BUILD.commit });
