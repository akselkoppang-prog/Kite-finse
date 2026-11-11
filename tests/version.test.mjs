// Tester for byggversjon (YYYY.MM.DD.BUILD): format, UTC, daglig nullstilling, låsing og atomisk reservering.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, cpSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { utcDate, format, maxBuild } from '../scripts/version.mjs';

let fail = 0;
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fail++; };
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'version.mjs');
const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const run = (cwd, env = {}) => new Promise((res) => {
  const p = spawn(process.execPath, [SCRIPT], { cwd, env: { ...process.env, VERSION_ROOT: cwd, ...env } });
  let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  p.on('close', () => res({ out, info: JSON.parse(readFileSync(join(cwd, 'version.json'), 'utf8')) }));
});

// --- rene funksjoner ---
ok(utcDate(new Date('2026-11-10T23:59:59Z')) === '2026.11.10' && utcDate(new Date('2026-11-11T00:00:00Z')) === '2026.11.11', 'dato er UTC og skifter ved midnatt UTC');
ok(utcDate(new Date('2026-11-10T23:30:00-05:00')) === '2026.11.11', 'lokal tidssone påvirker ikke datoen');
ok(format('2026.11.10', 1) === '2026.11.10.001' && format('2026.11.10', 42) === '2026.11.10.042' && format('2026.11.10', 1234) === '2026.11.10.1234', 'format YYYY.MM.DD.NNN');
ok(maxBuild(['v2026.11.10.001', 'v2026.11.10.007', 'v2026.11.09.050', 'tull', 'v2026.11.10.x'], '2026.11.10') === 7 && maxBuild([], '2026.11.10') === 0, 'høyeste løpenummer for dagen (andre datoer og ugyldige tagger ignoreres)');

// --- ekte git: bar «origin» + kloner ---
const tmp = mkdtempSync(join(tmpdir(), 'ver-'));
const origin = join(tmp, 'origin.git');
sh('git', ['init', '--bare', '-q', origin]);
const mkClone = (name) => {
  const d = join(tmp, name);
  sh('git', ['clone', '-q', origin, d]);
  sh('git', ['config', 'user.email', 't@example.com'], d); sh('git', ['config', 'user.name', 't'], d);
  return d;
};
const seed = mkClone('seed');
writeFileSync(join(seed, 'a.txt'), 'x'); sh('git', ['add', '.'], seed); sh('git', ['commit', '-qm', 'init'], seed); sh('git', ['push', '-q', 'origin', 'HEAD'], seed);
const today = utcDate();

// lokale bygg: 001, 002 … og merket «-lokal»
const local = mkClone('local');
const l1 = await run(local), l2 = await run(local);
ok(l1.info.version === `${today}.001-lokal` && l2.info.version === `${today}.002-lokal` && l1.info.channel === 'lokal', `lokale bygg teller 001, 002 og merkes: ${l1.info.version}, ${l2.info.version}`);
ok(/^\d{4}-\d\d-\d\dT.*Z$/.test(l1.info.builtAt) && l1.info.commit.length >= 7, 'version.json har byggetid (UTC) og commit');
// ny dato → 001
writeFileSync(join(local, '.version-state.json'), JSON.stringify({ date: '2020.01.01', build: 57 }));
ok((await run(local)).info.build === 1, 'løpenummeret nullstilles til 001 når datoen skifter');
// 6 samtidige lokale bygg i samme mappe → unike (låsefil)
writeFileSync(join(local, '.version-state.json'), JSON.stringify({ date: today, build: 10 }));
const par = await Promise.all(Array.from({ length: 6 }, () => run(local)));
// (alle skriver samme version.json – les tallene fra utskriften)
const nums = par.map((r) => /\.(\d{3,})-lokal/.exec(r.out)?.[1]).sort();
ok(new Set(nums).size === 6 && nums[0] === '011' && nums[5] === '016', `6 samtidige lokale bygg får unike nummer: ${nums.join(', ')}`);

// publiserte bygg: 8 samtidige CI-bygg i hver sin klone → 8 unike, reservert som tagger på origin
const clones = Array.from({ length: 8 }, (_, i) => mkClone(`ci${i}`));
const ci = await Promise.all(clones.map((c) => run(c, { VERSION_RESERVE: '1' })));
const vs = ci.map((r) => r.info.version).sort();
const tags = sh('git', ['tag', '-l'], origin).split('\n').filter(Boolean).sort();
ok(new Set(vs).size === 8 && vs.every((v) => /^\d{4}\.\d\d\.\d\d\.\d{3}$/.test(v)), `8 samtidige publiserte bygg får 8 ulike versjoner: ${vs.map((v) => v.slice(-3)).join(', ')}`);
ok(vs[0] === `${today}.001` && vs[7] === `${today}.008` && tags.length === 8 && tags.every((t, i) => t === `v${vs[i]}`), 'numrene er 001–008 uten hull, og hver finnes som tagg på origin');
ok(ci.every((r) => r.info.channel === 'publisert' && r.info.dirty === false), 'publiserte bygg er merket «publisert»');
// neste publiserte bygg fortsetter etter høyeste tagg, også fra en fersk klone uten lokale tagger
const fresh = mkClone('fresh');
ok((await run(fresh, { VERSION_RESERVE: '1' })).info.version === `${today}.009`, 'fersk klone fortsetter på 009 (leser tagger fra origin)');
// et lokalt bygg etterpå havner over publiserte nummer og er fortsatt merket lokalt
ok((await run(mkClone('late'))).info.version === `${today}.010-lokal`, 'lokalt bygg etter publiserte: 010-lokal (aldri forvekslet med publisert)');
// uten skrivetilgang: bygget stopper ikke, men merkes
const ro = mkClone('readonly');
sh('git', ['remote', 'set-url', '--push', 'origin', join(tmp, 'finnes-ikke.git')], ro);
const r = await run(ro, { VERSION_RESERVE: '1' });
ok(r.info.channel === 'ureservert' && /-ureservert$/.test(r.info.version), `uten skrivetilgang: bygget fullføres og merkes (${r.info.version})`);

rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `${fail} FEIL` : 'ALLE VERSJONSTESTER OK');
if (fail) process.exit(1);
