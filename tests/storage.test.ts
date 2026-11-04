// Lagringstester (IndexedDB i minnet via fake-indexeddb). Kjør: npm test
import 'fake-indexeddb/auto';
import { useStore } from '../src/state/store';
import { uncoveredKeys, SLICES, CACHE_KEYS } from '../src/storage/slices';
import { getDB, setMeta } from '../src/storage/db';
import { createBackup, pruneBackups, listBackups, restoreBackup, referencedBlobIds, projectSnapshot } from '../src/storage/backup';
import { writeStateAsProject, verifyProject } from '../src/storage/migrate';
import { exportJson } from '../src/storage/archive';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fail++; };

(async () => {
  // 1. Alle felt i tilstanden har et lagringssted (ingen felt kan gå tapt stille)
  const st = useStore.getState() as unknown as Record<string, unknown>;
  const miss = uncoveredKeys(st);
  ok(miss.length === 0, `alle tilstandsfelt er dekket av lagringen${miss.length ? `: mangler ${miss.join(', ')}` : ''}`);
  const all = [...Object.values(SLICES).flat(), ...CACHE_KEYS];
  ok(new Set(all).size === all.length, 'ingen felt lagres to steder');

  // 2. Skjema
  const db = await getDB();
  ok(['projects', 'slices', 'routes', 'caches', 'blobs', 'backups', 'meta'].every((n) => db.objectStoreNames.contains(n as never)), 'IndexedDB-skjema v1 opprettet med alle lagre');

  // 3. Skriv prosjekt + verifiser (som migreringen gjør)
  useStore.setState({
    routes: [{ id: 'r1', name: 'Test', kind: 'egen', color: '#f00', description: '', visible: true, createdAt: '', updatedAt: '', waypoints: Array.from({ length: 100 }, (_, i) => ({ id: `w${i}`, lat: 60 + i / 1000, lon: 7.5 + i / 1000, kind: 'via', source: 't', dataKind: 'forslag', description: `punkt ${i}` })) }],
    activeRouteId: 'r1',
    camps: [{ id: 'c1', lat: 60.2, lon: 7.9, name: 'Leir 1', night: 1, source: 'manuell', notes: 'le bak rygg', attachments: [{ id: 'a1', name: 'foto.jpg', href: '', kind: 'bilde', addedAt: '', blobId: 'img_x', thumbId: 'thm_x' }] }],
    lakeOverrides: [{ id: 'o1', barrierKey: 'lake_1', name: 'Tjern', originalKind: 'innsjø', originalLabel: 'IKKE VERIFISERT', centroid: { lat: 60, lon: 8 }, scope: 'tur', reviewRequired: false, note: 'ok', createdAt: '2026-11-04', active: true }],
    tripDate: '2027-04-02',
  } as never);
  const snap = { ...projectSnapshot().slices, routes: useStore.getState().routes } as Record<string, unknown>;
  await writeStateAsProject(snap, 'default', 'Test');
  ok((await verifyProject('default', snap)) === null, 'prosjekt skrevet og verifisert (100 rutepunkter, leir, overstyring, dato)');
  const sl = await db.getAllFromIndex('slices', 'byProject', 'default');
  ok(sl.length === Object.keys(SLICES).length + 1, `prosjektet er delt i ${sl.length} små poster (ikke ett stort objekt)`);
  ok((await db.getAllFromIndex('routes', 'byProject', 'default')).length === 1, 'ruter lagres én post per rute');

  // 4. Sikkerhetskopier og oppbevaring
  await setMeta('activeProject', 'default');
  for (let i = 0; i < 15; i++) await createBackup(`auto ${i}`, true);
  await createBackup('manuell', false);
  await createBackup('beskyttet', false, true);
  const removed = await pruneBackups();
  const left = await listBackups();
  ok(removed === 5 && left.filter((b) => b.auto).length === 10, `oppbevaring: 10 automatiske beholdt, ${removed} eldste fjernet`);
  ok(left.some((b) => b.reason === 'manuell') && left.some((b) => b.reason === 'beskyttet'), 'manuelle og beskyttede kopier slettes aldri automatisk');

  // 5. Gjenoppretting tar kopi av nåværende først og overskriver ikke uten valg
  const target = left.find((b) => b.reason === 'manuell')!;
  useStore.setState({ tripDate: '2027-03-10', camps: [] });
  await restoreBackup(target.id);
  ok(useStore.getState().tripDate === '2027-04-02' && useStore.getState().camps.length === 1, 'gjenoppretting gir tilbake dato og teltplass');
  const after = await listBackups();
  ok(after.some((b) => b.reason === 'Før gjenoppretting'), 'tilstanden før gjenoppretting ble lagret som egen kopi');

  // 6. Bildereferanser fanges (også fra kopier) – brukes for trygg opprydding
  const refs = await referencedBlobIds();
  ok(refs.has('img_x') && refs.has('thm_x'), 'bilde-id-er i bruk oppdages (aldri slettet ved opprydding)');

  // 7. JSON-eksport v3
  const json = JSON.parse(await exportJson('default', 'Test', { includeImages: false, includeCaches: false }));
  ok(json.format === 'kite-finse-rjukan-plan' && json.version === 3 && json.routes[0].waypoints.length === 100 && json.slices.lakeOverrides.length === 1 && json.slices.tripDate === '2027-04-02', 'JSON v3 inneholder ruter, punkter, overstyringer og dato');
  ok(json.routes[0].waypoints[57].lat === 60.057 && json.routes[0].waypoints[57].description === 'punkt 57', 'koordinater og beskrivelser uendret (full presisjon)');

  console.log(fail ? `${fail} FEIL` : 'ALLE LAGRINGSTESTER OK');
  process.exit(fail ? 1 : 0);
})();
