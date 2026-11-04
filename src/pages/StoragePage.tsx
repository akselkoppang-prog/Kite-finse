import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useSave, estimate, requestPersistence, flush, switchProject, hydrate } from '../storage/persistence';
import { getDB, getMeta, setMeta, type ProjectRec } from '../storage/db';
import { createBackup, deleteBackup, getBackupData, getRetention, listBackups, pruneBackups, referencedBlobIds, restoreBackup } from '../storage/backup';
import { exportJson, exportZip, importProject } from '../storage/archive';
import { deleteImage, useBlobUrl } from '../storage/blobs';
import { LEGACY_KEY, legacyPresent, type MigrationReport } from '../storage/migrate';
import { clearElevCache } from '../lib/api/kartverket';
import { clearTiles, cachedTileCount } from '../lib/offline';
import { download } from '../lib/gpx';
import { uid } from '../lib/geo';
import { Badge, Card, fmtTime } from '../components/ui';
import type { Attachment } from '../types';

const kb = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(0, b / 1024).toFixed(0)} kB`);

interface Usage {
  slices: { name: string; size: number }[];
  routes: number;
  routeCount: number;
  caches: { name: string; size: number }[];
  imagesMain: number;
  imagesThumb: number;
  imageCount: number;
  backups: number;
  backupCount: number;
  projects: (ProjectRec & { size: number })[];
}

async function computeUsage(pid: string): Promise<Usage> {
  const db = await getDB();
  const [slices, routes, caches, blobs, backups, projects, allSlices, allRoutes] = await Promise.all([
    db.getAllFromIndex('slices', 'byProject', pid),
    db.getAllFromIndex('routes', 'byProject', pid),
    db.getAll('caches'),
    db.getAllFromIndex('blobs', 'byProject', pid),
    db.getAllFromIndex('backups', 'byProject', pid),
    db.getAll('projects'),
    db.getAll('slices'),
    db.getAll('routes'),
  ]);
  return {
    slices: slices.map((s) => ({ name: s.slice, size: s.size })).sort((a, b) => b.size - a.size),
    routes: routes.reduce((a, r) => a + r.size, 0),
    routeCount: routes.length,
    caches: caches.filter((c) => c.projectId === pid || c.projectId === '*').map((c) => ({ name: c.name, size: c.size || JSON.stringify(c.value ?? null).length })).sort((a, b) => b.size - a.size),
    imagesMain: blobs.filter((b) => b.role === 'main').reduce((a, b) => a + b.size, 0),
    imagesThumb: blobs.filter((b) => b.role === 'thumb').reduce((a, b) => a + b.size, 0),
    imageCount: blobs.filter((b) => b.role === 'main').length,
    backups: backups.reduce((a, b) => a + b.size, 0),
    backupCount: backups.length,
    projects: projects.map((p) => ({ ...p, size: allSlices.filter((s) => s.projectId === p.id).reduce((a, s) => a + s.size, 0) + allRoutes.filter((r) => r.projectId === p.id).reduce((a, r) => a + r.size, 0) })),
  };
}

/** Hvor brukes et bilde? (rutepunkt, markør eller teltplass) */
function ownerOf(blobId: string): { label: string; remove: () => void } | null {
  const s = useStore.getState();
  const hit = (atts?: Attachment[]) => atts?.some((a) => a.blobId === blobId || a.thumbId === blobId);
  const strip = (atts?: Attachment[]) => atts?.filter((a) => a.blobId !== blobId && a.thumbId !== blobId);
  for (const r of s.routes)
    for (const w of r.waypoints)
      if (hit(w.attachments)) return { label: `Rutepunkt «${w.name ?? w.id}» (${r.name})`, remove: () => s.updateWaypoint(r.id, w.id, { attachments: strip(w.attachments) }) };
  for (const m of s.markers) if (hit(m.attachments)) return { label: `Markør «${m.name}»`, remove: () => s.set({ markers: s.markers.map((x) => (x.id === m.id ? { ...x, attachments: strip(x.attachments) } : x)) }) };
  for (const c of s.camps) if (hit(c.attachments)) return { label: `Teltplass «${c.name}»`, remove: () => s.set({ camps: s.camps.map((x) => (x.id === c.id ? { ...x, attachments: strip(x.attachments) } : x)) }) };
  return null;
}

function Thumb({ id }: { id: string }) {
  const url = useBlobUrl(id);
  return url ? <img src={url} alt="" className="stthumb" /> : <span className="stthumb" />;
}

export default function StoragePage() {
  const save = useSave();
  const pid = save.projectId;
  const [u, setU] = useState<Usage | null>(null);
  const [backups, setBackups] = useState<Awaited<ReturnType<typeof listBackups>>>([]);
  const [retention, setRet] = useState(10);
  const [tiles, setTiles] = useState<number | null>(null);
  const [mig, setMig] = useState<MigrationReport | null>(null);
  const [images, setImages] = useState<{ id: string; thumbId?: string; name: string; size: number; owner: string | null; used: boolean }[]>([]);
  const [msg, setMsg] = useState('');
  const [confirm, setConfirm] = useState<{ text: string; run: () => Promise<void> | void } | null>(null);
  const [legacyBytes, setLegacyBytes] = useState(legacyPresent());
  const [importMode, setImportMode] = useState<'new' | 'replace'>('new');
  const [busy, setBusy] = useState('');
  const fileIn = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setU(await computeUsage(pid));
    setBackups(await listBackups());
    setRet(await getRetention());
    setMig((await getMeta<MigrationReport>('migration')) ?? null);
    setTiles(await cachedTileCount().catch(() => null));
    setLegacyBytes(legacyPresent());
    const db = await getDB();
    const blobs = await db.getAllFromIndex('blobs', 'byProject', pid);
    const used = await referencedBlobIds();
    setImages(
      blobs
        .filter((b) => b.role === 'main')
        .map((b) => ({ id: b.id, thumbId: blobs.find((t) => t.parentId === b.id)?.id, name: b.name, size: b.size + (blobs.find((t) => t.parentId === b.id)?.size ?? 0), owner: ownerOf(b.id)?.label ?? null, used: used.has(b.id) }))
        .sort((a, b) => b.size - a.size),
    );
    await estimate();
  }, [pid]);
  useEffect(() => {
    void refresh();
  }, [refresh, save.saves]);

  const ask = (text: string, run: () => Promise<void> | void) => setConfirm({ text, run });
  const doRun = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setMsg('');
    try {
      const r = await fn();
      if (typeof r === 'string') setMsg(r);
    } catch (e) {
      setMsg(`❌ ${label}: ${(e as Error).message}`);
    } finally {
      setBusy('');
      void refresh();
    }
  };
  const q = save.quota;
  const imgTotal = (u?.imagesMain ?? 0) + (u?.imagesThumb ?? 0);
  const projBytes = (u?.slices.reduce((a, s) => a + s.size, 0) ?? 0) + (u?.routes ?? 0);
  const cacheBytes = u?.caches.reduce((a, c) => a + c.size, 0) ?? 0;
  const unused = images.filter((i) => !i.used);
  const name = save.projectName;

  return (
    <div className="page">
      <Card title="INNSTILLINGER / LAGRING" className="wide" right={<Badge s={save.state === 'saved' ? 'GRØNN' : save.state === 'failed' || save.state === 'unavailable' ? 'RØD' : 'GUL'}>{({ loading: 'LASTER', saved: 'LAGRET', saving: 'LAGRER', unsaved: 'ULAGREDE ENDRINGER', warning: 'LAGRINGSVARSEL', failed: 'LAGRING FEILET', unavailable: 'LAGRES IKKE' } as const)[save.state]}</Badge>}>
        <div className="summary">
          <div><span>Siste lagring</span><b>{fmtTime(save.lastSavedAt)}</b></div>
          <div><span>Siste sikkerhetskopi</span><b>{fmtTime(save.lastBackupAt)}</b></div>
          <div><span>Brukt av appen (nettleserens anslag)</span><b>{q ? kb(q.usage) : 'ukjent'}</b></div>
          <div><span>Tilgjengelig kvote (anslag)</span><b>{q ? kb(q.quota) : 'ukjent'}</b></div>
          <div><span>Prosjektdata</span><b>{kb(projBytes)}</b></div>
          <div><span>Ruter ({u?.routeCount ?? 0})</span><b>{kb(u?.routes ?? 0)}</b></div>
          <div><span>Bilder ({u?.imageCount ?? 0})</span><b>{kb(imgTotal)}</b></div>
          <div><span>Hurtigbuffer (kan hentes på nytt)</span><b>{kb(cacheBytes)}</b></div>
          <div><span>Sikkerhetskopier ({u?.backupCount ?? 0})</span><b>{kb(u?.backups ?? 0)}</b></div>
          <div><span>Prosjekter</span><b>{u?.projects.length ?? 0}</b></div>
          <div><span>Kartfliser offline</span><b>{tiles ?? '–'}</b></div>
          <div><span>Varig lagring</span><b>{save.persisted === true ? 'innvilget' : save.persisted === false ? 'IKKE innvilget' : 'ikke støttet'}</b></div>
        </div>
        {q && <div className="quota"><div style={{ width: `${Math.min(100, (100 * q.usage) / Math.max(1, q.quota))}%` }} /></div>}
        <div className="btns">
          <button className="btn small" onClick={() => doRun('Lagre', async () => { await flush(); return 'Lagret.'; })}>Lagre nå</button>
          <button className="btn small" onClick={() => doRun('Varig lagring', async () => { const p = await requestPersistence(); return p ? 'Nettleseren har innvilget varig lagring.' : 'Nettleseren innvilget ikke varig lagring (vanlig i Safari). Ta jevnlige eksporter.'; })}>Be om varig lagring</button>
          <button className="btn small ghost" onClick={() => void refresh()}>Oppdater</button>
        </div>
        <div className="note small">
          <b>Om lagring i nettleseren:</b> Data lagres lokalt i denne nettleseren på denne enheten (IndexedDB). Den <b>synkroniseres ikke</b> mellom iPad, iPhone og PC. Kvoten avhenger av nettleser og ledig plass og kan ikke garanteres.
          {save.persisted !== true && <> Uten «varig lagring» kan nettleseren slette data ved lite plass. <b>Safari</b> kan slette data for nettsteder du ikke har brukt på 7 dager – legg appen til på Hjem-skjermen (Del → Legg til på Hjem-skjerm) og last ned en ZIP-kopi jevnlig.</>}
          {' '}I privat nettlesing slettes alt når fanen lukkes.
        </div>
        {msg && <p className="msg small">{msg}</p>}
        {busy && <p className="small">{busy} …</p>}
      </Card>

      <Card title="Eksport og import" className="wide">
        <div className="btns">
          <button className="btn" onClick={() => doRun('ZIP-eksport', async () => { await flush(); const z = await exportZip(pid, name); download(`${name.replace(/\W+/g, '_')}_${new Date().toISOString().slice(0, 10)}.zip`, z, 'application/zip'); await setMeta(`lastExport:${pid}`, new Date().toISOString()); return `ZIP lastet ned (${kb(z.size)}): project.json, metadata.json, routes/*.gpx, images/, attachments/.`; })}>⬇ Last ned komplett ZIP (anbefalt)</button>
          <button className="btn" onClick={() => doRun('JSON-eksport', async () => { await flush(); const j = await exportJson(pid, name, { includeImages: true, includeCaches: false }); download(`${name.replace(/\W+/g, '_')}_${new Date().toISOString().slice(0, 10)}.json`, j, 'application/json'); return `JSON med bilder lastet ned (${kb(j.length)}).`; })}>⬇ JSON med bilder</button>
          <button className="btn ghost" onClick={() => doRun('JSON-eksport', async () => { await flush(); const j = await exportJson(pid, name, { includeImages: false, includeCaches: true }); download(`${name.replace(/\W+/g, '_')}_data.json`, j, 'application/json'); return 'JSON uten bilder, med NVE/terreng-buffer (for offline) lastet ned.'; })}>⬇ JSON uten bilder + buffer</button>
        </div>
        <div className="row small">
          <label>Import som
            <select id="imp-mode" value={importMode} onChange={(e) => setImportMode(e.target.value as 'new' | 'replace')}>
              <option value="new">Nytt prosjekt (aktivt prosjekt røres ikke)</option>
              <option value="replace">Erstatt aktivt prosjekt (sikkerhetskopi tas først)</option>
            </select>
          </label>
          <button className="btn small" onClick={() => fileIn.current?.click()}>⬆ Importer ZIP/JSON…</button>
          <input ref={fileIn} type="file" accept=".zip,.json,application/zip,application/json" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            const go = () => doRun('Import', async () => {
              await flush();
              const r = await importProject(f, importMode, pid);
              if (importMode === 'new') await switchProject(r.projectId);
              await flush();
              return `Importert «${r.name}» (${r.format}): ${r.routes} ruter, ${r.images} bilder${importMode === 'new' ? ' – åpnet som nytt prosjekt' : ''}.`;
            });
            if (importMode === 'replace') ask(`Erstatte innholdet i «${name}» med «${f.name}»? En sikkerhetskopi tas først.`, go);
            else void go();
          }} />
        </div>
        <p className="small muted">Import godtar ZIP fra denne versjonen og JSON fra alle tidligere versjoner (base64-bilder gjøres om til Blob). Koordinater lagres med full presisjon.</p>
      </Card>

      <Card title="Sikkerhetskopier" className="wide" right={<button className="btn small" onClick={() => doRun('Sikkerhetskopi', async () => { await flush(); await createBackup('Manuell sikkerhetskopi', false); return 'Sikkerhetskopi tatt.'; })}>Ta sikkerhetskopi nå</button>}>
        <div className="row small">
          <label>Behold siste automatiske kopier
            <input id="bk-ret" type="number" min={2} max={100} value={retention} onChange={(e) => setRet(+e.target.value)} onBlur={() => doRun('Lagre innstilling', async () => { await setMeta('backupRetention', Math.max(2, retention)); const n = await pruneBackups(); return n ? `${n} eldre automatiske kopier fjernet.` : 'Lagret.'; })} />
          </label>
          <span className="muted">Automatisk: hvert 10. min ved endringer, før sletting av ruter, før import og gjenoppretting. Manuelle og beskyttede kopier slettes aldri automatisk.</span>
        </div>
        <div className="tablewrap" style={{ maxHeight: 360 }}>
          <table className="tbl small">
            <thead><tr><th>Tid</th><th>Årsak</th><th>Type</th><th>Størrelse</th><th /></tr></thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.id}>
                  <td>{fmtTime(b.createdAt)}</td>
                  <td>{b.reason}</td>
                  <td>{b.keep ? '🔒 beskyttet' : b.auto ? 'automatisk' : 'manuell'}</td>
                  <td>{kb(b.size)}</td>
                  <td className="btns">
                    <button className="btn small" onClick={() => ask(`Gjenopprette kopien fra ${fmtTime(b.createdAt)} («${b.reason}»)? Nåværende prosjekt lagres først som egen kopi.`, () => doRun('Gjenoppretting', async () => { await flush(); await restoreBackup(b.id); return 'Kopien er gjenopprettet. Forrige tilstand ligger som «Før gjenoppretting».'; }))}>Gjenopprett</button>
                    <button className="btn small ghost" onClick={() => doRun('Last ned kopi', async () => { const d = await getBackupData(b.id); if (d) download(`sikkerhetskopi_${b.createdAt.slice(0, 16).replace(/[:T]/g, '-')}.json`, d, 'application/json'); return 'Lastet ned.'; })}>Last ned</button>
                    <button className="btn small danger" onClick={() => ask(`Slette kopien «${b.reason}» (${fmtTime(b.createdAt)})?${b.keep ? ' Den er BESKYTTET.' : ''}`, () => doRun('Slett kopi', async () => { await deleteBackup(b.id); return 'Kopien er slettet.'; }))}>Slett</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {backups.length === 0 && <p className="small muted">Ingen kopier ennå.</p>}
      </Card>

      <Card title="Prosjekter">
        <ul className="small list">
          {u?.projects.map((p) => (
            <li key={p.id}>
              <b>{p.name}</b> {p.id === pid && <Badge s="GRØNN">aktivt</Badge>} · {kb(p.size)} · endret {fmtTime(p.updatedAt)}
              {p.id !== pid && (
                <>
                  {' '}<button className="link" onClick={() => doRun('Bytt prosjekt', async () => { await switchProject(p.id); return `Åpnet «${p.name}».`; })}>åpne</button>
                  {' '}<button className="link danger" onClick={() => ask(`Slette prosjektet «${p.name}» med ruter, notater og bilder? Sikkerhetskopiene beholdes.`, () => doRun('Slett prosjekt', async () => {
                    const db = await getDB();
                    const tx = db.transaction(['projects', 'slices', 'routes', 'caches', 'blobs'], 'readwrite');
                    tx.objectStore('projects').delete(p.id);
                    for (const st of ['slices', 'routes', 'caches', 'blobs'] as const) {
                      let c = await tx.objectStore(st).index('byProject').openCursor(p.id);
                      while (c) { await c.delete(); c = await c.continue(); }
                    }
                    await tx.done;
                    return 'Prosjektet er slettet.';
                  }))}>slett</button>
                </>
              )}
            </li>
          ))}
        </ul>
        <div className="row small">
          <input id="proj-name" defaultValue={name} onBlur={(e) => doRun('Gi nytt navn', async () => { const db = await getDB(); const p = await db.get('projects', pid); if (p && e.target.value.trim()) { await db.put('projects', { ...p, name: e.target.value.trim() }); useSave.getState().set({ projectName: e.target.value.trim() }); } })} aria-label="Navn på aktivt prosjekt" />
          <button className="btn small" onClick={() => doRun('Nytt prosjekt', async () => {
            await flush();
            const db = await getDB();
            const id = uid('prj');
            const now = new Date().toISOString();
            await db.put('projects', { id, name: `Ny ekspedisjon ${now.slice(0, 10)}`, createdAt: now, updatedAt: now, schema: 1 });
            await switchProject(id);
            const { loadInitialGpx } = await import('../lib/actions');
            await loadInitialGpx();
            await flush();
            return 'Nytt prosjekt opprettet med din GPX som utgangspunkt.';
          })}>+ Ny ekspedisjon</button>
        </div>
      </Card>

      <Card title={`Bilder og vedlegg (${images.length})`} className="wide">
        {unused.length > 0 && (
          <p className="small warn">{unused.length} fil(er) brukes ikke av noe prosjekt eller noen kopi ({kb(unused.reduce((a, i) => a + i.size, 0))}).
            <button className="btn small" onClick={() => ask(`Slette ${unused.length} ubrukte filer?`, () => doRun('Rydd', async () => { for (const i of unused) await deleteImage(i.id); return 'Ubrukte filer slettet.'; }))}>Slett ubrukte</button>
          </p>
        )}
        <div className="tablewrap" style={{ maxHeight: 420 }}>
          <table className="tbl small">
            <thead><tr><th /><th>Fil</th><th>Brukes av</th><th>Størrelse</th><th /></tr></thead>
            <tbody>
              {images.map((i) => (
                <tr key={i.id}>
                  <td>{i.thumbId && <Thumb id={i.thumbId} />}</td>
                  <td>{i.name}</td>
                  <td>{i.owner ?? (i.used ? 'sikkerhetskopi / annet prosjekt' : <span className="warn">ubrukt</span>)}</td>
                  <td>{kb(i.size)}</td>
                  <td>
                    <button className="btn small danger" onClick={() => ask(`Slette bildet «${i.name}»${i.owner ? ` fra ${i.owner}` : ''}?${i.used && !i.owner ? ' Det brukes av en sikkerhetskopi – kopien vil mangle bildet.' : ''}`, () => doRun('Slett bilde', async () => {
                      const o = ownerOf(i.id);
                      o?.remove();
                      await flush();
                      const still = await referencedBlobIds();
                      if (!still.has(i.id) || !i.owner) await deleteImage(i.id);
                      return still.has(i.id) && i.owner ? 'Fjernet fra punktet. Filen beholdes fordi en sikkerhetskopi bruker den.' : 'Bildet er slettet.';
                    }))}>Slett</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">Bilder skaleres til maks 1600 px (JPEG) med 240 px miniatyr og lagres som Blob. Samme bilde lastet opp flere ganger lagres én gang.</p>
      </Card>

      <Card title="Hurtigbuffer (kan hentes på nytt)">
        <ul className="small list">
          {u?.caches.map((c) => (
            <li key={c.name}>{({ hydro: 'NVE magasiner/dammer', lakes: 'NVE innsjøer langs ruter', terrain: 'Terrenganalyse (DTM)', routeForecast: 'MET-prognose langs ruten', elevation: 'Høydecache (DTM-punkter)' } as Record<string, string>)[c.name] ?? c.name}: {kb(c.size)}
              {' '}<button className="link danger" onClick={() => doRun('Tøm buffer', async () => {
                const db = await getDB();
                if (c.name === 'elevation') { clearElevCache(); await db.delete('caches', ['*', 'elevation']); }
                else { await db.delete('caches', [pid, c.name]); useStore.setState({ [c.name]: c.name === 'lakes' || c.name === 'terrain' ? {} : null } as never); }
                return 'Tømt – hentes på nytt ved behov.';
              })}>tøm</button>
            </li>
          ))}
          <li>Kartfliser offline: {tiles ?? '–'} <button className="link danger" onClick={() => doRun('Tøm fliser', async () => { await clearTiles(); return 'Kartfliser tømt.'; })}>tøm</button></li>
          <li>Simuleringsresultater: lagres ikke (beregnes på nytt) – ingenting å rydde.</li>
        </ul>
      </Card>

      <Card title="Flytting fra gammel lagring (localStorage)">
        {!mig ? <p className="small muted">Ingen informasjon.</p> : mig.status === 'none' ? <p className="small">Ingen gammel plan funnet – ingenting å flytte.</p> : (
          <>
            <p className="small"><Badge s={mig.status === 'verified' ? 'GRØNN' : 'RØD'}>{mig.status === 'verified' ? 'VERIFISERT' : mig.status.toUpperCase()}</Badge> {fmtTime(mig.at)} · gammel plan {kb(mig.originalBytes)} · {Object.entries(mig.counts).map(([k, v]) => `${v} ${k}`).join(', ')}</p>
            {mig.error && <p className="err small">{mig.error}</p>}
            <p className="small"><b>Hva tok plass i den gamle planen:</b></p>
            <ul className="small list">{mig.bySize.slice(0, 8).map((x) => <li key={x.key}>{x.key}: {kb(x.bytes)}</li>)}</ul>
            {mig.imagesConverted > 0 && <p className="small">{mig.imagesConverted} bilder flyttet fra base64 ({kb(mig.imageBytesBefore)}) til Blob ({kb(mig.imageBytesAfter)} inkl. miniatyrer).</p>}
          </>
        )}
        {legacyBytes > 0 && (
          <div className="btns">
            <span className="small">Gammel kopi ligger fortsatt i localStorage ({kb(legacyBytes)}).</span>
            <button className="btn small" onClick={() => { try { download('gammel-plan-localStorage.json', localStorage.getItem(LEGACY_KEY) ?? '', 'application/json'); } catch { setMsg('Kunne ikke lese gammel kopi'); } }}>Last ned gammel kopi</button>
            {mig?.status === 'verified' && <button className="btn small danger" onClick={() => ask('Slette den gamle kopien fra localStorage? Den er flyttet og verifisert, og en beskyttet sikkerhetskopi av originalen ligger i listen over. Last den gjerne ned først.', () => { localStorage.removeItem(LEGACY_KEY); setLegacyBytes(0); setMsg('Gammel kopi slettet fra localStorage.'); })}>Slett gammel kopi</button>}
          </div>
        )}
      </Card>

      {confirm && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-box">
            <p>{confirm.text}</p>
            <div className="btns">
              <button className="btn danger" onClick={async () => { const c = confirm; setConfirm(null); await c.run(); }}>Ja, fortsett</button>
              <button className="btn ghost" onClick={() => setConfirm(null)}>Avbryt</button>
            </div>
          </div>
        </div>
      )}
      <button hidden onClick={() => void hydrate(pid)} />
    </div>
  );
}
