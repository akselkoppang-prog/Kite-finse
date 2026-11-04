import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useActiveRoute, useDayPlan, useProfile } from '../state/derived';
import { KITES } from '../data/kites';
import { uid, fmtCoord, fmtKm, haversine } from '../lib/geo';
import { download, toGpx, waypointCsv } from '../lib/gpx';
import { exportZip } from '../storage/archive';
import { useSave, flush } from '../storage/persistence';
import { cachedTileCount, clearTiles, corridorTiles, prefetchTiles } from '../lib/offline';
import { SOURCES } from '../data/sources';
import { fmtClock } from '../lib/sun';
import { Card, Kind, Progress } from '../components/ui';

export default function GearPage() {
  const s = useStore();
  const route = useActiveRoute();
  const plan = useDayPlan(route);
  const { stats } = useProfile(route);
  const [newItem, setNewItem] = useState({ cat: 'Diverse', text: '' });
  const cats = Array.from(new Set(s.packing.map((p) => p.cat)));
  const packed = s.packing.filter((p) => p.packed).length;
  const kg = s.packing.reduce((a, p) => a + (p.kg ?? 0), 0);
  const f = s.food;
  const days = s.tripDays + f.extraDays;
  const foodDays = days + f.reserveDays;
  const foodKg = (foodDays * f.kcalPerDay) / f.kcalPerKg;
  const fuelL = foodDays * f.fuelLPerDay;
  const quiver = s.quivers.find((q) => q.id === s.activeQuiverId);

  // offline
  const [tiles, setTiles] = useState<number | null>(null);
  const [prog, setProg] = useState<{ done: number; failed: number; total: number } | null>(null);
  const [zMax, setZMax] = useState(14);
  const abort = useRef<AbortController>();
  useEffect(() => {
    cachedTileCount().then(setTiles).catch(() => setTiles(null));
  }, [prog]);
  const tileUrls = route ? corridorTiles(route.waypoints, SOURCES['kv-topo'].urls[0], 8, zMax, 2000) : [];

  const printOverview = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    const esc = (t: string) => t.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!);
    const rows = plan.days.map((d) => `<tr><td>${d.day}</td><td>${d.date}</td><td>${fmtKm(d.d1 - d.d0)}</td><td>${d.totalH.toFixed(1)} t</td><td>${fmtClock(d.sun.sunrise)}–${fmtClock(d.sun.sunset)}</td><td>${esc(s.dayNotes[`${route?.id}:${d.day}`] ?? '')}</td></tr>`).join('');
    const wps = (route?.waypoints ?? []).filter((x) => x.name || x.category || x.description).map((x) => `<tr><td>${esc(x.name ?? '')}</td><td>${fmtCoord(x)}</td><td>${esc(x.category ?? '')}</td><td>${esc(x.description ?? '')} ${esc(x.notes ?? '')}</td><td>${x.verification ?? 'uverifisert'}</td></tr>`).join('');
    const mks = s.markers.map((x) => `<tr><td>${esc(x.name)}</td><td>${fmtCoord(x)}</td><td>${esc(x.category)}</td><td>${esc(x.description ?? '')} ${esc(x.notes ?? '')}</td><td>${x.verification ?? 'uverifisert'}</td></tr>`).join('');
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Finse–Rjukan ${s.tripDate}</title><style>body{font:12px system-ui;margin:16px}table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1px solid #999;padding:3px 5px;text-align:left}h1{font-size:18px}</style>
      <h1>Finse → Rjukan snowkite · ${s.tripDate} · ${s.tripDays} dager</h1>
      <p>Rute: ${esc(route?.name ?? '')} · ${fmtKm(stats.total)} · ↑${Math.round(stats.up)} m ↓${Math.round(stats.down)} m · Quiver: ${esc(KITES.filter((k) => quiver?.kiteIds.includes(k.id)).map((k) => `${k.size} m² ${k.name}`).join(', '))}</p>
      <p><b>FORESLÅTT RUTE – ikke verifisert i terrenget. Brukergodkjent ≠ verifisert.</b></p>
      <h2>Dager</h2><table><tr><th>Dag</th><th>Dato</th><th>Distanse</th><th>Est. tid</th><th>Sol</th><th>Notater</th></tr>${rows}</table>
      <h2>Sjekkpunkter</h2><table><tr><th>Navn</th><th>Koordinater</th><th>Kategori</th><th>Notat</th><th>Status</th></tr>${wps}${mks}</table>
      <h2>Vann-overstyringer</h2><ul>${s.lakeOverrides.filter((o) => o.active).map((o) => `<li>${esc(o.name)} – ${esc(o.note)} (${o.scope}${o.expires ? `, utløper ${o.expires}` : ''})</li>`).join('') || '<li>Ingen</li>'}</ul>
      <script>setTimeout(()=>print(),300)</script>`);
    w.document.close();
  };

  return (
    <div className="page">
      <Card title={`Pakkeliste · ${packed}/${s.packing.length} pakket${kg ? ` · ${kg.toFixed(1)} kg registrert` : ''}`} className="wide">
        <div className="packgrid">
          {cats.map((c) => (
            <div key={c} className="packcat">
              <h4>{c}</h4>
              {c === 'Kites' && quiver && <div className="small muted">Valgt quiver: {KITES.filter((k) => quiver.kiteIds.includes(k.id)).map((k) => `${k.size} m²`).join(', ')}</div>}
              {s.packing.filter((p) => p.cat === c).map((p) => (
                <div key={p.id} className="packrow">
                  <label className="chk"><input id={`pk-${p.id}`} type="checkbox" checked={p.packed} onChange={(e) => s.set({ packing: s.packing.map((x) => (x.id === p.id ? { ...x, packed: e.target.checked } : x)) })} /> {p.text}</label>
                  <input className="kg" id={`pkg-${p.id}`} type="number" step="0.1" placeholder="kg" value={p.kg ?? ''} onChange={(e) => s.set({ packing: s.packing.map((x) => (x.id === p.id ? { ...x, kg: e.target.value === '' ? undefined : +e.target.value } : x)) })} aria-label="Vekt kg" />
                  <button className="link danger" onClick={() => s.set({ packing: s.packing.filter((x) => x.id !== p.id) })} aria-label="Slett">✕</button>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="row">
          <input id="pk-cat" list="pk-cats" value={newItem.cat} onChange={(e) => setNewItem({ ...newItem, cat: e.target.value })} aria-label="Kategori" />
          <datalist id="pk-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
          <input id="pk-text" placeholder="Nytt utstyr" value={newItem.text} onChange={(e) => setNewItem({ ...newItem, text: e.target.value })} />
          <button className="btn small" disabled={!newItem.text} onClick={() => { s.set({ packing: [...s.packing, { id: uid('pk'), cat: newItem.cat || 'Diverse', text: newItem.text, packed: false }] }); setNewItem({ ...newItem, text: '' }); }}>Legg til</button>
          <button className="btn small ghost" onClick={() => s.set({ packing: s.packing.map((p) => ({ ...p, packed: false })) })}>Nullstill pakket</button>
        </div>
      </Card>

      <Card title="Mat og brensel" right={<Kind k="beregnet" />}>
        <div className="form">
          <label>Ekstra dager utover plan<input id="f-extra" type="number" min={0} value={f.extraDays} onChange={(e) => s.set({ food: { ...f, extraDays: +e.target.value } })} /></label>
          <label>Reservedøgn<input id="f-res" type="number" min={0} value={f.reserveDays} onChange={(e) => s.set({ food: { ...f, reserveDays: +e.target.value } })} /></label>
          <label>kcal per dag<input id="f-kcal" type="number" step={100} value={f.kcalPerDay} onChange={(e) => s.set({ food: { ...f, kcalPerDay: +e.target.value } })} /></label>
          <label>Energitetthet (kcal/kg mat)<input id="f-dens" type="number" step={100} value={f.kcalPerKg} onChange={(e) => s.set({ food: { ...f, kcalPerKg: +e.target.value } })} /></label>
          <label>Brensel (liter per dag)<input id="f-fuel" type="number" step={0.05} value={f.fuelLPerDay} onChange={(e) => s.set({ food: { ...f, fuelLPerDay: +e.target.value } })} /></label>
        </div>
        <div className="kv">
          <span>Turdager</span><b>{s.tripDays} + {f.extraDays} ekstra = {days}</b>
          <span>Matdøgn inkl. reserve</span><b>{foodDays}</b>
          <span>Energi totalt</span><b>{(foodDays * f.kcalPerDay).toLocaleString('nb-NO')} kcal</b>
          <span>Matvekt</span><b>{foodKg.toFixed(1)} kg</b>
          <span>Brensel</span><b>{fuelL.toFixed(2)} l (≈ {(fuelL * 0.75).toFixed(1)} kg rødsprit/bensin-ekv.)</b>
        </div>
        <p className="small muted">Standard: 4500 kcal/dag, 4800 kcal/kg (tørrmat/fett), 0,2 l brensel/døgn til snøsmelting. Juster etter egen erfaring og brennertype.</p>
      </Card>

      <Card title="Nød og avbrudd">
        <ul className="small">
          {Object.values(s.places).filter((p) => p.role.includes('avbrudd') || p.role.includes('transport')).map((p) => (
            <li key={p.key}><button className="link" onClick={() => s.focusOn(p.lat, p.lon, 12)}>{p.name}</button> ({p.type}) · {fmtCoord(p)}{route ? ` · ${(Math.min(...route.waypoints.map((w) => haversine(w, p))) / 1000).toFixed(1)} km fra ruten` : ''}</li>
          ))}
          {Object.keys(s.places).length === 0 && <li className="muted">Hent stedsnavn i Kart-fanen (steg 1).</li>}
          {s.markers.filter((m) => m.category === 'exit' || m.category === 'pickup').map((m) => (
            <li key={m.id}>🆘 <button className="link" onClick={() => s.focusOn(m.lat, m.lon, 13)}>{m.name}</button> (din {m.category === 'exit' ? 'nødutgang' : 'henteplass'}) · {fmtCoord(m)}</li>
          ))}
        </ul>
        <p className="small">Legg til egne nødpunkter: Kart → «📝 Markør» → kategori «Nødutgang» eller «Henteplass».</p>
        <ul className="small muted">
          <li><b>Nærmeste vei:</b> ikke integrert (ingen åpen vinterstatus). Sjekk Statens vegvesen/vegvesen.no for vinterstengte veier og kolonnekjøring.</li>
          <li><b>Mobildekning:</b> ingen åpen API – sjekk Telenor/Telia dekningskart. Anta ingen dekning på vidda.</li>
          <li><b>Satellitt:</b> inReach/PLB med abonnement, test SOS-flyt og meldingsmaler før avreise. Avtal innsjekk-rutine og hva som utløser varsling.</li>
          <li>Nødnummer: 112 (politi), 113 (medisinsk), 110 (brann). Hovedredningssentralen Sør-Norge koordinerer redning.</li>
        </ul>
      </Card>

      <Card title="Offline og eksport" className="wide">
        <div className="btns">
          <button className="btn" onClick={async () => { await flush(); download(`finse-rjukan-prosjekt-${s.tripDate}.zip`, await exportZip(useSave.getState().projectId, useSave.getState().projectName, true), 'application/zip'); }}>Last ned hele prosjektet (ZIP inkl. bilder og NVE/DTM-buffer)</button>
          <button className="btn" disabled={!route} onClick={() => route && download('finse-rjukan.gpx', toGpx([route, ...s.routes.filter((r) => r.id !== route.id && r.visible)], s.camps, s.markers))}>GPX (ruter, punkter, notater)</button>
          <button className="btn" onClick={() => download('waypoints.csv', waypointCsv(route ? [route] : [], s.markers), 'text/csv')}>Waypoint-liste (CSV)</button>
          <button className="btn" onClick={printOverview}>Utskrivbar oversikt</button>
        </div>
        <p className="small muted">Prosjektfilen inneholder alt (også bilder og notater som GPX ikke kan lagre). Appen lagrer også automatisk i nettleseren.</p>
        <h4>Kartfliser for offline bruk</h4>
        <div className="row small">
          <label>Maks zoom
            <select id="off-z" value={zMax} onChange={(e) => setZMax(+e.target.value)}>{[12, 13, 14, 15].map((z) => <option key={z} value={z}>{z}</option>)}</select>
          </label>
          <span>{tileUrls.length} fliser i en 2 km korridor (zoom 8–{zMax}) · {tiles ?? '–'} lagret nå</span>
        </div>
        <div className="btns">
          <button className="btn small" disabled={!route || !!prog && prog.done + prog.failed < prog.total || tileUrls.length > 4000} onClick={async () => {
            abort.current = new AbortController();
            setProg({ done: 0, failed: 0, total: tileUrls.length });
            try {
              await prefetchTiles(tileUrls, (done, failed) => setProg({ done, failed, total: tileUrls.length }), abort.current.signal);
            } catch (e) {
              alert((e as Error).message);
            }
          }}>Last ned fliser langs ruten</button>
          <button className="btn small ghost" onClick={() => abort.current?.abort()}>Stopp</button>
          <button className="btn small danger" onClick={async () => { await clearTiles(); setProg(null); setTiles(0); }}>Slett lagrede fliser</button>
        </div>
        {prog && <><Progress f={(prog.done + prog.failed) / Math.max(1, prog.total)} /><div className="small">{prog.done} lagret · {prog.failed} feilet</div></>}
        <p className="small muted">Kartverkets cache-tjeneste er åpen (CC BY 4.0), men skal brukes med måte: verktøyet henter bare en smal korridor, maks 4000 fliser, i rolig takt. Offline-visning krever at siden er åpnet én gang med nett (service worker). NVE/MET-data må hentes før avreise og lagres i prosjektet.</p>
      </Card>
    </div>
  );
}
