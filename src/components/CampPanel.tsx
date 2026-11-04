import { useState } from 'react';
import { useStore } from '../state/store';
import { useActiveRoute, useBarrierCheck, useTerrain } from '../state/derived';
import { evaluateCamp } from '../lib/analysis/camps';
import { dirName, fmtCoord, fmtDM, nearestOnRoute, uid } from '../lib/geo';
import { cachedElevation } from '../lib/api/kartverket';
import { Badge } from './ui';
import { AttachmentImg } from './SaveStatus';
import { putImage } from '../storage/blobs';
import { releaseImage } from '../storage/backup';
import { useSave } from '../storage/persistence';
import type { Camp } from '../types';


/** Redigering av teltplass: navn, natt, rolle (foretrukket/reserve), notater, bilder, godkjenning, kopi, slett. */
export default function CampPanel({ id }: { id: string }) {
  const s = useStore();
  const route = useActiveRoute();
  const check = useBarrierCheck(route);
  const terrain = useTerrain(route);
  const [confirmDel, setConfirmDel] = useState(false);
  const c = s.camps.find((x) => x.id === id);
  if (!c) return null;
  const upd = (p: Partial<Camp>) => s.set({ camps: s.camps.map((x) => (x.id === id ? { ...x, ...p, updatedAt: new Date().toISOString() } : x)) });
  const near = route ? nearestOnRoute(route.waypoints, c) : null;
  const t = terrain && near && near.dist < 400 ? terrain.samples.reduce((b, x) => (Math.abs(x.d - near.d) < Math.abs(b.d - near.d) ? x : b), terrain.samples[0]) : undefined;
  const ev = evaluateCamp(c, t, dirName(s.sim.manual.dir), check.barriers, Object.values(s.places));
  const z = cachedElevation(c);
  const close = () => s.set({ selectedCamp: null });
  return (
    <div className="drawer">
      <header>
        <h3>⛺ {c.name}</h3>
        <button className="btn small" onClick={close} aria-label="Lukk">✕</button>
      </header>
      <div className="form1">
        <label>Navn<input id="camp-name" value={c.name} onChange={(e) => upd({ name: e.target.value })} /></label>
        <div className="row">
          <label>Natt<select id="camp-night" value={c.night} onChange={(e) => upd({ night: +e.target.value })}>{Array.from({ length: Math.max(s.tripDays, 6) }, (_, i) => <option key={i} value={i + 1}>Natt {i + 1}</option>)}</select></label>
          <label>Rolle<select id="camp-role" value={c.role ?? ''} onChange={(e) => {
            const role = (e.target.value || undefined) as Camp['role'];
            // bare én foretrukket per natt
            s.set({ camps: s.camps.map((x) => (x.id === id ? { ...x, role } : role === 'foretrukket' && x.night === c.night && x.role === 'foretrukket' ? { ...x, role: 'reserve' } : x)) });
          }}><option value="">–</option><option value="foretrukket">★ Foretrukket</option><option value="reserve">Reserve</option></select></label>
        </div>
        <div className="kv small">
          <span>Koordinater</span><b className="mono">{fmtCoord(c)}<br />{fmtDM(c)}</b>
          <span>Høyde</span><b>{z?.z != null ? `${Math.round(z.z)} moh (DTM)` : 'ikke hentet'}</b>
          <span>Avstand til rute</span><b>{near ? `${Math.round(near.dist)} m ved ${(near.d / 1000).toFixed(1)} km` : '–'}</b>
          <span>Vind ({dirName(s.sim.manual.dir)})</span><b>{ev.exposure}</b>
          <span>Skred</span><b>{ev.avalanche.text}</b>
          <span>Vann</span><b>{ev.waterText}</b>
          <span>Kilde</span><b>{c.source}</b>
        </div>
        {ev.flags.map((f) => <div key={f} className="small warn">⚠️ {f}</div>)}
        <label className="chk"><input id="camp-ok" type="checkbox" checked={!!c.approved} onChange={(e) => upd({ approved: e.target.checked })} /> Godkjent av meg <Badge s="BRUKER" /></label>
        <label>Notater<textarea id="camp-notes" rows={3} value={c.notes ?? c.note ?? ''} onChange={(e) => upd({ notes: e.target.value })} /></label>
        <div className="attach">
          {(c.attachments ?? []).map((a) => (
            <div key={a.id} className="att"><AttachmentImg a={a} /><button className="link danger" onClick={() => { upd({ attachments: (c.attachments ?? []).filter((x) => x.id !== a.id) }); if (a.blobId) void releaseImage(a.blobId); }}>fjern</button></div>
          ))}
        </div>
        <label className="small">Legg til bilde<input id="camp-img" type="file" accept="image/*" onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const img = await putImage(f, f.name, useSave.getState().projectId);
            const cur = useStore.getState().camps.find((x) => x.id === id);
            upd({ attachments: [...(cur?.attachments ?? []), { id: uid('att'), name: f.name, href: '', kind: 'bilde', addedAt: new Date().toISOString(), blobId: img.blobId, thumbId: img.thumbId, size: img.size, width: img.width, height: img.height }] });
          } catch (err) {
            alert(`Kunne ikke lagre bildet: ${(err as Error).message}`);
          }
        }} /></label>
        <p className="small muted">Flytt teltplassen ved å dra ikonet i kartet.</p>
        <div className="btns">
          <button className="btn small" onClick={() => s.focusOn(c.lat, c.lon, 15)}>Zoom hit</button>
          <button className="btn small" onClick={() => {
            const copy: Camp = { ...c, id: uid('camp'), name: `${c.name} (kopi)`, lat: c.lat + 0.002, lon: c.lon + 0.002, role: undefined, createdAt: new Date().toISOString() };
            s.set({ camps: [...s.camps, copy], selectedCamp: copy.id });
          }}>Dupliser</button>
          {!confirmDel ? (
            <button className="btn danger" onClick={() => setConfirmDel(true)}>🗑 Slett teltplass</button>
          ) : (
            <>
              <span className="small">Sikker?</span>
              <button className="btn small danger" onClick={() => { s.set({ camps: s.camps.filter((x) => x.id !== id), selectedCamp: null }); s.log('annet', `Slettet teltplass ${c.name}`); }}>Ja, slett</button>
              <button className="btn small ghost" onClick={() => setConfirmDel(false)}>Avbryt</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
