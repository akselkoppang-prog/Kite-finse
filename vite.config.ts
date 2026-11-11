import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
// @ts-expect-error – ren JS-modul uten typer
import { nextVersion, utcDate } from './scripts/version.mjs';

/**
 * Versjon (YYYY.MM.DD.BUILD) lages HER, i selve byggingen – ikke bare i forhåndsvisning:
 *  - `vite build`: scripts/version.mjs tildeler neste nummer (reservert som git-tagg når VERSION_RESERVE=1).
 *  - utviklingsserver: «<dato>.000-dev» (ingen teller brukes).
 * Versjonen legges inn i appen (__BUILD_INFO__), i dist/version.json og i service workeren.
 */
function buildInfo(command: string) {
  if (command === 'build') return nextVersion();
  const date = utcDate();
  return { version: `${date}.000-dev`, date, build: 0, channel: 'dev', builtAt: new Date().toISOString(), commit: 'dev', dirty: true };
}

function listFiles(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? listFiles(p, base) : [relative(base, p).split('\\').join('/')];
  });
}

/** Skriver dist/version.json og fyller service workeren med versjon + liste over alle app-filer (full offline-støtte). */
function versionPlugin(info: ReturnType<typeof buildInfo>): Plugin {
  let outDir = 'dist';
  return {
    name: 'app-version',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      writeFileSync(join(outDir, 'version.json'), JSON.stringify(info, null, 2) + '\n');
      const files = listFiles(outDir).filter((f) => f !== 'sw.js' && f !== 'version.json' && !f.endsWith('.map'));
      const swPath = join(outDir, 'sw.js');
      const sw = readFileSync(swPath, 'utf8');
      if (!sw.includes('__APP_VERSION__') || !sw.includes('"__PRECACHE__"')) throw new Error('public/sw.js mangler plassholderne __APP_VERSION__ / "__PRECACHE__"');
      writeFileSync(swPath, sw.replace(/__APP_VERSION__/g, info.version).replace('"__PRECACHE__"', JSON.stringify(['./', ...files.map((f) => `./${f}`)])));
      console.log(`\n[version] ${info.version} · ${files.length} filer i offline-pakken`);
    },
  };
}

// base './' så bygget fungerer både lokalt, på GitHub Pages og fra en vilkårlig undermappe.
export default defineConfig(({ command }) => {
  const info = buildInfo(command);
  return {
    plugins: [react(), versionPlugin(info)],
    base: './',
    define: { __BUILD_INFO__: JSON.stringify(info) },
    build: { chunkSizeWarningLimit: 2500 },
  };
});
