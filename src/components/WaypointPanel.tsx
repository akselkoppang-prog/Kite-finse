import { useState } from 'react';
import { useStore } from '../state/store';
import { useActiveRoute, useDayPlan } from '../state/derived';
import { allCategories, categoryOf, VERIFICATION_TEXT } from '../data/categories';
import { cumulative, fmtCoord, fmtDM, nearestOnRoute, uid } from '../lib/geo';
import { cachedElevation } from '../lib/api/kartverket';
import { Badge } from './ui';
import { AttachmentImg } from './SaveStatus';
import { putImage } from '../storage/blobs';
import { releaseImage } from '../storage/backup';
import { useSave } from '../storage/persistence';
import type { Annotated, Attachment, Verification } from '../types';

/** Skalerer et bilde ned (maks 800 px) til JPEG-data-URL så det får plass i lokal lagring. */

export default function WaypointPanel({ kind, id }: { kind: 'wp' | 'marker'; id: string }) {
  const s = useStore();
  const route = useActiveRoute();
  const plan = useDayPlan(route);
  const [newCat, setNewCat] = useState({ label: '', icon: '📍', color: '#a855f7' });
  const [linkUrl, setLinkUrl] = useState('');
  const [msg, setMsg] = useState('');
  const wpIdx = kind === 'wp' && route ? route.waypoints.findIndex((w) => w.id === id) : -1;
  const wp = wpIdx >= 0 ? route!.waypoints[wpIdx] : undefined;
  const mk = kind === 'marker' ? s.markers.find((m) => m.id === id) : undefined;
  const item = (wp ?? mk) as (Annotated & { lat: number; lon: number; name?: string; source: string; eleGpx?: number }) | undefined;
  if (!item) return null;
  const close = () => s.set({ selectedWp: null, selectedMarker: null });
  const patch = (p: Partial<Annotated & { name: string; lat: number; lon: number }>) => {
    const t = new Date().toISOString();
    if (wp && route) s.updateWaypoint(route.id, wp.id, p);
    else if (mk) s.set({ markers: s.markers.map((m) => (m.id === mk.id ? { ...m, ...p, updatedAt: t, createdAt: m.createdAt ?? t } : m)) });
  };
  const cats = allCategories(s.customCategories);
  const cat = categoryOf(item.category, s.customCategories);
  const dist = wp && route ? cumulative(route.waypoints)[wpIdx] : route ? nearestOnRoute(route.waypoints, item).d : 0;
  const off = mk && route ? nearestOnRoute(route.waypoints, item).dist : 0;
  const dtm = cachedElevation(item);
  const ver = (item.verification ?? 'uverifisert') as Verification;
  const day = plan.days.findIndex((d) => dist >= d.d0 && dist <= d.d1 + 1);

  const addAttachment = (a: Attachment) => {
    // les siste versjon (opplasting er asynkron)
    const st = useStore.getState();
    const cur = wp && route ? st.routes.find((r) => r.id === route.id)?.waypoints.find((w) => w.id === wp.id) : st.markers.find((m) => m.id === mk?.id);
    patch({ attachments: [...(cur?.attachments ?? []), a] });
  };

  return (
    <div className="drawer">
      <header>
        <h3>
          {cat?.icon ?? (kind === 'wp' ? '📍' : '📝')} {item.name || (kind === 'wp' ? `Rutepunkt ${wpIdx + 1}` : 'Markør')}
        </h3>
        <button className="btn small" onClick={close} aria-label="Lukk">✕</button>
      </header>
      <div className="form1">
        <label>Navn<input id="wp-name" value={item.name ?? ''} onChange={(e) => patch({ name: e.target.value })} /></label>
        <div className="kv small">
          <span>Koordinater</span><b className="mono">{fmtCoord(item)}<br />{fmtDM(item)}</b>
          <span>Fra start</span><b>{(dist / 1000).toFixed(1)} km{mk && route ? ` (punktet ligger ${Math.round(off)} m fra ruten)` : ''}{day >= 0 ? ` · dag ${day + 1}` : ''}</b>
          <span>Høyde</span><b>{dtm?.z != null ? `${Math.round(dtm.z)} moh (Kartverket DTM)` : item.eleGpx != null ? `${Math.round(item.eleGpx)} moh (GPX/Garmin)` : 'ikke hentet'}</b>
          <span>Type</span><b>{kind === 'wp' ? 'Rutepunkt (del av rutelinjen)' : 'Egen markør (ikke del av ruten)'}</b>
          <span>Kilde</span><b>{item.source}</b>
          <span>Lagt til</span><b>{item.createdAt?.slice(0, 10) ?? 'før notater ble innført'}{item.updatedAt ? ` · endret ${item.updatedAt.slice(0, 16).replace('T', ' ')}` : ''}</b>
        </div>
        <label>Kategori / ikon
          <select id="wp-cat" value={item.category ?? ''} onChange={(e) => patch({ category: e.target.value || undefined })}>
            <option value="">(ingen – vanlig punkt)</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
          </select>
        </label>
        <details className="small">
          <summary>Ny kategori…</summary>
          <div className="row">
            <input id="cat-label" placeholder="Navn" value={newCat.label} onChange={(e) => setNewCat({ ...newCat, label: e.target.value })} />
            <input id="cat-icon" style={{ width: 52 }} value={newCat.icon} onChange={(e) => setNewCat({ ...newCat, icon: e.target.value })} aria-label="Ikon (emoji)" />
            <input id="cat-color" type="color" value={newCat.color} onChange={(e) => setNewCat({ ...newCat, color: e.target.value })} aria-label="Farge" />
            <button className="btn small" disabled={!newCat.label} onClick={() => {
              const c = { id: uid('cat'), label: newCat.label, icon: newCat.icon || '📍', color: newCat.color, custom: true };
              s.set({ customCategories: [...s.customCategories, c] });
              patch({ category: c.id });
              setNewCat({ label: '', icon: '📍', color: '#a855f7' });
            }}>Opprett og bruk</button>
          </div>
        </details>
        <label>Beskrivelse<textarea id="wp-desc" rows={3} value={item.description ?? ''} onChange={(e) => patch({ description: e.target.value })} placeholder="F.eks. Leir her – le bak morenerygg. Bratt nedkjøring med pulk." /></label>
        <label>Personlige notater<textarea id="wp-notes" rows={3} value={item.notes ?? ''} onChange={(e) => patch({ notes: e.target.value })} /></label>
        <label>Status
          <select id="wp-ver" value={ver} onChange={(e) => patch({ verification: e.target.value as Verification })}>
            {Object.entries(VERIFICATION_TEXT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <div className="small"><Badge s={VERIFICATION_TEXT[ver].cls}>{VERIFICATION_TEXT[ver].label}</Badge> {ver === 'brukergodkjent' && 'Din egen godkjenning – ikke kontrollert mot en kilde.'}{ver === 'verifisert' && 'Bruk bare når du har kontrollert mot en navngitt kilde (skriv den i notatet).'}</div>

        <h4>Vedlegg</h4>
        <div className="attach">
          {(item.attachments ?? []).map((a) => (
            <div key={a.id} className="att">
              {a.kind === 'bilde' ? <AttachmentImg a={a} /> : <a href={a.href} target="_blank" rel="noreferrer">🔗 {a.name}</a>}
              <button className="link danger" onClick={() => { patch({ attachments: (item.attachments ?? []).filter((x) => x.id !== a.id) }); if (a.blobId) void releaseImage(a.blobId); }}>fjern</button>
            </div>
          ))}
        </div>
        <div className="row">
          <input id="att-url" placeholder="https://… (lenke/dokumentasjon)" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
          <button className="btn small" disabled={!/^https?:\/\//.test(linkUrl)} onClick={() => {
            addAttachment({ id: uid('att'), name: linkUrl.replace(/^https?:\/\//, '').slice(0, 40), href: linkUrl, kind: 'lenke', addedAt: new Date().toISOString() });
            setLinkUrl('');
          }}>Legg til lenke</button>
        </div>
        <label className="small">Bilde (skaleres til maks 1600 px og lagres som fil i nettleseren)
          <input id="att-img" type="file" accept="image/*" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              setMsg('Lagrer bilde …');
              const img = await putImage(f, f.name, useSave.getState().projectId);
              addAttachment({ id: uid('att'), name: f.name, href: '', kind: 'bilde', addedAt: new Date().toISOString(), blobId: img.blobId, thumbId: img.thumbId, size: img.size, width: img.width, height: img.height });
              setMsg(img.deduped ? 'Bildet fantes allerede – gjenbrukt (ingen ekstra plass).' : `Bilde lagret (${img.width}×${img.height}, ${(img.size / 1024).toFixed(0)} kB inkl. miniatyr).`);
            } catch (err) {
              setMsg(`Kunne ikke lagre bildet: ${(err as Error).message}`);
            }
            e.target.value = '';
          }} />
        </label>
        {msg && <p className="small muted">{msg}</p>}

        <div className="btns">
          <button className="btn small" onClick={() => s.focusOn(item.lat, item.lon, 15)}>Zoom hit</button>
          {wp && route && (
            <>
              <button className="btn small" onClick={() => s.moveWaypointIndex(route.id, wp.id, -1)} disabled={wpIdx === 0}>↑ Flytt før</button>
              <button className="btn small" onClick={() => s.moveWaypointIndex(route.id, wp.id, 1)} disabled={wpIdx === route.waypoints.length - 1}>↓ Flytt etter</button>
              {plan.breaks.length > 0 && (
                <select id="wp-dayend" value="" onChange={(e) => {
                  const i = +e.target.value;
                  const nb = [...plan.breaks];
                  nb[i] = dist;
                  s.setDayBreaks(route.id, nb);
                  s.log('rute', `Satt slutt på dag ${i + 1} ved ${item.name ?? 'punkt'} (${(dist / 1000).toFixed(1)} km)`);
                }}>
                  <option value="">Bruk som dagsslutt…</option>
                  {plan.breaks.map((_, i) => <option key={i} value={i}>Slutt dag {i + 1}</option>)}
                </select>
              )}
            </>
          )}
          <button className="btn small danger" onClick={() => {
            if (wp && route) s.deleteWaypoint(route.id, wp.id);
            else if (mk) s.set({ markers: s.markers.filter((m) => m.id !== mk.id) });
            close();
          }}>Slett</button>
        </div>
      </div>
    </div>
  );
}
