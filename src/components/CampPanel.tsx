import { useState } from 'react';
import { useStore } from '../state/store';
import { useActiveRoute, useBarrierCheck, useTerrain } from '../state/derived';
import { evaluateCamp } from '../lib/analysis/camps';
import { dirName, fmtCoord, fmtDM, nearestOnRoute, uid } from '../lib/geo';
import { cachedElevation } from '../lib/api/kartverket';
import { Badge } from './ui';
import { useExpedition, updateDay, assignCamp } from '../state/expedition';
import { hhmm } from '../lib/sim/expedition';
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
  const exp = useExpedition();
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
          <label>Type<select id="camp-kind" value={c.kind ?? 'telt'} onChange={(e) => upd({ kind: e.target.value as Camp['kind'] })}><option value="telt">⛺ Telt</option><option value="hytte">🏠 Hytte</option><option value="gapahuk">🛖 Gapahuk/bu</option><option value="leirplass">🏕️ Leirplass</option><option value="annet">Annet</option></select></label>
          <label>Plasser<input id="camp-cap" type="number" min={0} value={c.capacity ?? ''} onChange={(e) => upd({ capacity: e.target.value === '' ? undefined : +e.target.value })} style={{ width: 70 }} /></label>
          <label className="chk"><input type="checkbox" checked={!!c.resupply} onChange={(e) => upd({ resupply: e.target.checked })} /> påfyll mat/brensel</label>
        </div>
        <label className="chk"><input id="camp-only" type="checkbox" checked={!!c.scenarioIds?.length} onChange={(e) => upd({ scenarioIds: e.target.checked ? [s.activePlanId] : undefined })} /> Bare i scenarioet «{s.plans.find((p) => p.id === s.activePlanId)?.name}»{c.scenarioIds && c.scenarioIds.length > 1 ? ` (+${c.scenarioIds.length - 1} til)` : ''}</label>
        <label>Beskrivelse<textarea id="camp-desc" rows={2} value={c.description ?? ''} placeholder="F.eks. le bak morenerygg, god snø til smelting" onChange={(e) => upd({ description: e.target.value })} /></label>
        {(() => {
          const di = exp.plan.days.findIndex((d) => d.campId === c.id);
          const out = di >= 0 ? exp.days[di] : undefined;
          return (
            <div className="campplan small">
              {out ? <>⛺ Overnatting etter <b>dag {di + 1}</b> · forventet ankomst <b>{hhmm(out.arrival)}</b> ({out.forcedStop ? 'ditt valg – lenger enn modellen rekker' : 'etter planen'})</> : <span className="muted">Ikke valgt som overnatting i dagplanen.</span>}
              <div className="row">
                <select id="camp-useday" value="" onChange={(e) => {
                  if (!route || e.target.value === '') return;
                  assignCamp(+e.target.value, id);
                }}>
                  <option value="">Bruk som overnatting etter dag …</option>
                  {exp.plan.days.slice(0, -1).map((_, i) => <option key={i} value={i}>Dag {i + 1}</option>)}
                </select>
              </div>
            </div>
          );
        })()}
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
        <label>Min vurdering<input id="camp-assess" value={c.assessment ?? ''} placeholder="F.eks. befart 2025 – god teltplass" onChange={(e) => upd({ assessment: e.target.value })} /></label>
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
              <button className="btn small danger" onClick={() => {
                // fjern koblingen i dagplanen (stoppet beholdes som ditt manuelle stopp)
                exp.plan.days.forEach((d, i) => d.campId === id && updateDay(i, { campId: undefined }));
                s.set({ camps: s.camps.filter((x) => x.id !== id), selectedCamp: null });
                s.log('annet', `Slettet teltplass ${c.name}`);
              }}>Ja, slett</button>
              <button className="btn small ghost" onClick={() => setConfirmDel(false)}>Avbryt</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
