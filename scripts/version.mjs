/**
 * Byggversjon: YYYY.MM.DD.BUILD (UTC-dato + løpenummer som starter på 001 hver dag).
 *
 * ÉN autoritativ kilde:
 *   - Publiserte bygg (CI, VERSION_RESERVE=1): løpenummeret RESERVERES som git-tagg «vYYYY.MM.DD.NNN»
 *     på origin. Å opprette en tagg som finnes fra før blir avvist av git-serveren, så to samtidige
 *     bygg kan aldri få samme versjon – taperen prøver neste nummer.
 *   - Lokale bygg: løpenummer i .version-state.json (ikke i git), beskyttet av en låsefil. Versjonen
 *     får endelsen «-lokal» så den aldri kan forveksles med en publisert versjon.
 *
 * Resultatet skrives til version.json (ikke i git). Vite leser den og legger versjonen inn i appen,
 * i dist/version.json og i service workeren. Versjonen er helt uavhengig av bruker- og prosjektdata.
 *
 * Bruk:  node scripts/version.mjs            (lokalt bygg)
 *        VERSION_RESERVE=1 node scripts/version.mjs   (publisert bygg – reserverer tagg på origin)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.VERSION_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'version.json');
const STATE = join(ROOT, '.version-state.json');
const LOCK = join(ROOT, '.version.lock');
const REMOTE = process.env.VERSION_REMOTE || 'origin';
const RESERVE = process.env.VERSION_RESERVE === '1';

const pad = (n) => String(n).padStart(3, '0');
/** UTC-dato – lik på alle maskiner uansett tidssone. */
export const utcDate = (d = new Date()) => d.toISOString().slice(0, 10).replace(/-/g, '.');
export const format = (date, build) => `${date}.${pad(build)}`;
/** Høyeste løpenummer for en dato blant taggnavn (vYYYY.MM.DD.NNN). */
export function maxBuild(tags, date) {
  let max = 0;
  for (const t of tags) {
    const m = /^v?(\d{4}\.\d{2}\.\d{2})\.(\d{3,})$/.exec(t.trim());
    if (m && m[1] === date) max = Math.max(max, parseInt(m[2], 10));
  }
  return max;
}

const git = (args, opts = {}) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, ...opts }).trim();
const tryGit = (args) => {
  try {
    return git(args);
  } catch {
    return null;
  }
};
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function withLock(fn) {
  const start = Date.now();
  for (;;) {
    try {
      mkdirSync(LOCK); // atomisk: bare én prosess lykkes
      break;
    } catch {
      // foreldet lås (krasjet bygg) fjernes etter 2 minutter
      try {
        if (Date.now() - statSync(LOCK).mtimeMs > 120000) rmSync(LOCK, { recursive: true, force: true });
      } catch {
        /* låsen forsvant – prøv igjen */
      }
      if (Date.now() - start > 60000) throw new Error('Fikk ikke versjonslåsen (.version.lock) på 60 s');
      sleep(50 + Math.floor(Math.random() * 100));
    }
  }
  try {
    return fn();
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}

function localTags(date) {
  return (tryGit(['tag', '-l', `v${date}.*`]) ?? '').split('\n').filter(Boolean);
}
function remoteTags(date) {
  const out = tryGit(['ls-remote', '--tags', REMOTE, `refs/tags/v${date}.*`]);
  if (out == null) return null; // ingen kontakt med origin
  return out.split('\n').filter(Boolean).map((l) => l.split('refs/tags/')[1]).filter(Boolean);
}

/**
 * Reserver neste ledige nummer som tagg på origin. Returnerer null hvis origin ikke kan nås / mangler rettigheter.
 * Taggen er annotert med en unik tekst, så to bygg av SAMME commit lager ulike tagg-objekter – da avviser
 * serveren den som kommer sist (ellers ville git sagt «allerede oppdatert» og begge fått samme nummer).
 */
function reserve(date, from) {
  const nonce = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  let n = from;
  for (let attempt = 0; attempt < 50; attempt++, n++) {
    const tag = `v${format(date, n)}`;
    tryGit(['tag', '-d', tag]); // en eventuell lokal kopi kan være et annet byggs tagg
    if (tryGit(['-c', 'user.name=build', '-c', 'user.email=build@localhost', 'tag', '-a', tag, '-m', `Bygg ${format(date, n)} (${nonce})`]) == null) return null;
    const mine = tryGit(['rev-parse', `refs/tags/${tag}`]);
    let pushed = true;
    let err = '';
    try {
      git(['push', REMOTE, `refs/tags/${tag}`]);
    } catch (e) {
      pushed = false;
      err = String(e.stderr ?? e.message ?? '').split('\n').find((l) => l.trim()) ?? '';
    }
    // fasit er serveren: peker taggen der på VÅRT objekt?
    const remote = tryGit(['ls-remote', '--tags', REMOTE, `refs/tags/${tag}`]);
    const theirs = remote?.split('\n').find((l) => l.endsWith(`refs/tags/${tag}`))?.split(/\s+/)[0];
    if (theirs && theirs === mine) return n;
    tryGit(['tag', '-d', tag]);
    if (theirs) continue; // et annet bygg tok nummeret – prøv neste
    if (!pushed) {
      console.warn(`[version] Kunne ikke reservere ${tag} på ${REMOTE}: ${err}`);
      return null;
    }
  }
  return null;
}

export function nextVersion(now = new Date()) {
  const date = utcDate(now);
  return withLock(() => {
    let state = {};
    try {
      state = JSON.parse(readFileSync(STATE, 'utf8'));
    } catch {
      /* første bygg */
    }
    const localMax = state.date === date ? state.build || 0 : 0;
    const remote = remoteTags(date);
    const known = Math.max(localMax, maxBuild(localTags(date), date), maxBuild(remote ?? [], date));
    let build = known + 1;
    let channel = 'lokal';
    if (RESERVE) {
      const got = remote == null ? null : reserve(date, build);
      if (got != null) {
        build = got;
        channel = 'publisert';
      } else {
        channel = 'ureservert';
        console.warn('[version] Bygger uten reservert nummer (ingen skrivetilgang til tagger). Versjonen merkes «-ureservert».');
      }
    }
    writeFileSync(STATE, JSON.stringify({ date, build }));
    const version = format(date, build) + (channel === 'publisert' ? '' : `-${channel}`);
    const info = {
      version,
      date,
      build,
      channel,
      builtAt: now.toISOString(),
      commit: tryGit(['rev-parse', '--short=9', 'HEAD']) ?? 'ukjent',
      dirty: channel === 'publisert' ? false : !!tryGit(['status', '--porcelain']),
    };
    writeFileSync(OUT, JSON.stringify(info, null, 2) + '\n');
    return info;
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const info = nextVersion();
  console.log(`[version] ${info.version} (${info.channel}, commit ${info.commit}, ${info.builtAt})`);
  if (!existsSync(OUT)) process.exit(1);
}
