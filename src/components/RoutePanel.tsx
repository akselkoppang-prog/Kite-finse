import { useRef, useState } from 'react';
import { useStore, routeHash } from '../state/store';
import { useActiveRoute, useBarrierCheck, useProfile, useTerrain } from '../state/derived';
import { buildChainRoutes, checkLakesForActive, exportPlanJson, importGpxFile, importPlanJson, loadHydro, resolveAllPlaces, runTerrainForActive } from '../lib/actions';
import { download, toGpx } from '../lib/gpx';
import { detourAround } from '../lib/analysis/barriers';
import { Badge, Card, Progress, fmtTime } from './ui';
import { fmtKm, uid } from '../lib/geo';

export default function RoutePanel() {
  const s = useStore();
  const route = useActiveRoute();
  const check = useBarrierCheck(route);
  const terrain = useTerrain(route);
  const { stats } = useProfile(route);
  const [msg, setMsg] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [prog, setProg] = useState(0);
  const [zoneName, setZoneName] = useState('');
  const [zoneKind, setZoneKind] = useState<'forbudt' | 'usikker'>('forbudt');
  const gpxIn = useRef<HTMLInputElement>(null);
  const jsonIn = useRef<HTMLInputElement>(null);

  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label);
    setMsg('');
    setProg(0);
    try {
      const r = await fn();
      if (r) setMsg(r);
    } catch (e) {
      setMsg(`❌ ${label}: ${(e as Error).message}. Tjenesten kan være utilgjengelig, blokkert av CORS eller ha endret adresse – se Datakilder.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="panel">
      <Card title="Ruter" right={<span className="muted small">{s.routes.length} stk</span>}>
        <div className="routes">
          {s.routes.map((r) => (
            <div key={r.id} className={`route-row ${r.id === s.activeRouteId ? 'active' : ''}`}>
              <input type="checkbox" checked={r.visible} title="Vis i kart" onChange={(e) => s.upsertRoute({ ...r, visible: e.target.checked })} />
              <span className="swatch" style={{ background: r.color }} />
              <button className="link" onClick={() => s.set({ activeRouteId: r.id })}>
                {r.name}
              </button>
              <span className="muted small">{r.kind}</span>
            </div>
          ))}
        </div>
        <div className="btns">
          <button className="btn" onClick={() => gpxIn.current?.click()}>Importer GPX</button>
          <button className="btn" disabled={!route} onClick={() => route && download(`${route.name.replace(/\W+/g, '_')}.gpx`, toGpx([route], s.camps, s.markers))}>Eksporter aktiv GPX</button>
          <button className="btn" onClick={() => download('finse-rjukan-alle-ruter.gpx', toGpx(s.routes.filter((r) => r.visible), s.camps, s.markers))}>Eksporter alle</button>
          <button className="btn" disabled={!route} onClick={() => route && s.duplicateRoute(route.id)}>Dupliser til redigerbar kopi</button>
          <button className="btn danger" disabled={!route} onClick={() => route && confirm(`Slette «${route.name}»?`) && s.removeRoute(route.id)}>Slett</button>
        </div>
        <div className="btns">
          <button className="btn ghost" onClick={() => download('kiteplan.json', exportPlanJson(), 'application/json')}>Lagre plan (JSON)</button>
          <button className="btn ghost" onClick={() => jsonIn.current?.click()}>Åpne plan</button>
        </div>
        <p className="muted small">Planen lagres automatisk i nettleseren (localStorage). Bruk «Lagre plan» for sikkerhetskopi / deling.</p>
        <input ref={gpxIn} type="file" accept=".gpx,application/gpx+xml" hidden onChange={(e) => e.target.files?.[0] && run('GPX-import', async () => importGpxFile(e.target.files![0]))} />
        <input
          ref={jsonIn}
          type="file"
          accept=".json"
          hidden
          onChange={(e) =>
            e.target.files?.[0] &&
            run('Planimport', async () => {
              importPlanJson(await e.target.files![0].text());
              return 'Plan lastet';
            })
          }
        />
      </Card>

      <Card title="Hent ekte data">
        <ol className="steps">
          <li>
            <button className="btn" disabled={!!busy} onClick={() => run('Stedsnavn', async () => {
              const missing = await resolveAllPlaces(setMsg);
              const b = buildChainRoutes();
              return `✓ Stedsnavn hentet. Bygde ${b.built.length} forslag. ${missing.length ? `Fant ikke: ${missing.join(', ')}` : ''} ${b.missing.join('; ')}`;
            })}>
              1. Hent hytter/steder + lag alternative ruter
            </button>
            <span className="muted small"> Kartverket stedsnavn · {Object.keys(s.places).length} steder</span>
          </li>
          <li>
            <button className="btn" disabled={!!busy} onClick={() => run('NVE magasiner', async () => {
              const h = await loadHydro();
              return `✓ NVE: ${h.reservoirs.length} magasin-polygoner, ${h.dams.length} dammer (lag: ${h.layers.map((l) => l.name).join(', ')})`;
            })}>
              2. Last regulerte magasiner (NVE)
            </button>
            <span className="muted small"> {s.hydro ? `${s.hydro.reservoirs.length} magasiner · ${fmtTime(s.hydro.fetchedAt)}` : 'ikke lastet'}</span>
          </li>
          <li>
            <button className="btn" disabled={!!busy || !route} onClick={() => run('Innsjøer', async () => `✓ ${await checkLakesForActive()} innsjøer berører aktiv rute`)}>
              3. Finn alle vann ruten krysser (NVE)
            </button>
            <span className="muted small"> {check.lakesAt ? fmtTime(check.lakesAt) : 'ikke kontrollert for denne ruteversjonen'}</span>
          </li>
          <li>
            <button className="btn" disabled={!!busy || !route} onClick={() => run('Terrenganalyse', async () => {
              const r = await runTerrainForActive(1000, setProg);
              return `✓ Terreng analysert: ${r.samples.length} punkter (DTM, hver 1 km)`;
            })}>
              4. Terrenganalyse (DTM: helning, rygger, le)
            </button>
            <span className="muted small"> {terrain ? fmtTime(terrain.fetchedAt) : 'ikke kjørt'}</span>
          </li>
        </ol>
        {busy && (
          <div>
            <span className="small">{busy} …</span>
            {busy === 'Terrenganalyse' && <Progress f={prog} />}
          </div>
        )}
        {msg && <p className="msg small">{msg}</p>}
      </Card>

      {route && (
        <Card title="Vannkontroll – aktiv rute" right={<Badge s={check.status} />}>
          {!check.waterChecked && <p className="warn small">Vann er ikke fullstendig kontrollert (steg 2 og 3). Ruten kan IKKE aksepteres.</p>}
          {check.bandWarnings.map((w) => (
            <div key={w.wp.id} className="cross">
              <Badge s="RØD">Indikasjon</Badge> Punkt #{w.index + 1} har GPX-høyde <b>{Math.round(w.wp.eleGpx!)} moh</b> – innenfor reguleringsintervallet til <b>{w.water}</b> ({w.band}). Ligger trolig PÅ magasinet.
              <button className="btn small" onClick={() => s.focusOn(w.wp.lat, w.wp.lon, 13)}>Vis</button>
            </div>
          ))}
          {check.crossings.length === 0 && check.waterChecked && <p className="ok small">Ingen kryssinger av kjente vann/soner funnet i NVE-data for denne ruteversjonen.</p>}
          {check.crossings.map((c, i) => (
            <div key={i} className="cross">
              <Badge s={c.blocking ? 'RØD' : c.label === 'BRUKERGODKJENT' ? 'BRUKER' : 'GUL'}>{c.label}</Badge> <b>{c.barrier.name}</b> · {Math.round(c.lengthM)} m ved {fmtKm(c.fromD)}
              <div className="small muted">{c.barrier.label}{c.override ? ` · overstyring: ${c.overrideState}` : ''}</div>
              {c.hazards.map((h) => <div key={h} className="small err">⚠️ {h}</div>)}
              <div className="btns">
                <button className="btn small" onClick={() => s.focusOn(c.entry.lat, c.entry.lon, 13)}>Vis</button>
                {c.barrier.kind !== 'sone' && <button className="btn small" onClick={() => s.set({ selectedBarrier: c.barrier.id, selectedWp: null, selectedMarker: null })}>✓ Godkjenn / detaljer</button>}
                <button
                  className="btn small"
                  onClick={() => {
                    const nw = detourAround(route.waypoints, c.barrier);
                    if (!nw) return setMsg('Kunne ikke beregne omvei (start/slutt inne i barriere eller ugyldig geometri).');
                    const copy = { ...route, id: uid('rt'), name: `${route.name} + omvei ${c.barrier.name}`, kind: 'egen' as const, color: '#3b82f6', waypoints: nw, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
                    s.upsertRoute(copy);
                    s.set({ activeRouteId: copy.id });
                    s.log('rute', `Laget omvei rundt ${c.barrier.name} som ny rute «${copy.name}»`);
                    setMsg(`Laget ny rute med beregnet omvei rundt ${c.barrier.name}. Kjør steg 3 og 4 på nytt for den nye ruten.`);
                  }}
                >
                  Foreslå omvei (ny rute)
                </button>
                {c.barrier.kind === 'innsjø' && c.barrier.label.startsWith('IKKE') && (
                  <button
                    className="btn small ghost"
                    onClick={() => {
                      const note = prompt('Dokumentasjon på at vannet er UREGULERT (kilde + dato, f.eks. «NVE Atlas 2027-01-10: ikke magasin»):');
                      if (note) s.set({ userVerifiedLakes: { ...s.userVerifiedLakes, [c.barrier.id]: note } });
                    }}
                  >
                    Dokumenter uregulert…
                  </button>
                )}
              </div>
            </div>
          ))}
          <p className="muted small">Kryssing sjekkes mot NVE-polygoner (hentet {fmtTime(check.hydroAt)} / {fmtTime(check.lakesAt)}) og dine egne soner. Ruteversjon: {routeHash(route).split(':')[1]}</p>
        </Card>
      )}

      <Card title="Rediger i kart">
        <div className="seg">
          {(
            [
              ['none', 'Panorer'],
              ['add', '+ Punkt (slutt)'],
              ['insert', '+ Punkt (sett inn)'],
              ['zone', 'Tegn sone'],
              ['camp', '⛺ Teltplass'],
              ['marker', '📝 Markør'],
            ] as const
          ).map(([m, l]) => (
            <button key={m} className={`btn small ${s.editMode === m ? 'on' : ''}`} onClick={() => s.set({ editMode: m, draftZone: m === 'zone' ? s.draftZone : [] })}>
              {l}
            </button>
          ))}
        </div>
        <p className="muted small">Dra punkter for å flytte. Klikk et punkt eller en markør for å redigere navn, kategori, beskrivelse, notater, bilder og status. Klikk et vann for detaljer og whitelist. GPX-ruten: dupliser først hvis du vil beholde originalen.</p>
        {s.editMode === 'zone' && (
          <div className="zone-form">
            <span className="small">{s.draftZone.length} hjørner klikket</span>
            <input placeholder="Navn på sone" value={zoneName} onChange={(e) => setZoneName(e.target.value)} />
            <select value={zoneKind} onChange={(e) => setZoneKind(e.target.value as 'forbudt' | 'usikker')}>
              <option value="forbudt">Forbudt (RØD)</option>
              <option value="usikker">Usikker (GUL)</option>
            </select>
            <button
              className="btn small"
              disabled={s.draftZone.length < 3}
              onClick={() => {
                s.set({ zones: [...s.zones, { id: uid('zone'), name: zoneName || `Sone ${s.zones.length + 1}`, kind: zoneKind, ring: s.draftZone, createdAt: new Date().toISOString() }], draftZone: [], editMode: 'none' });
                setZoneName('');
              }}
            >
              Lagre sone
            </button>
            <button className="btn small ghost" onClick={() => s.set({ draftZone: [] })}>Nullstill</button>
          </div>
        )}
        {s.zones.length > 0 && (
          <ul className="list small">
            {s.zones.map((z) => (
              <li key={z.id}>
                <Badge s={z.kind === 'forbudt' ? 'RØD' : 'GUL'}>{z.kind}</Badge> {z.name}{' '}
                <button className="link" onClick={() => s.set({ zones: s.zones.filter((x) => x.id !== z.id) })}>slett</button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {route && (
        <Card title="Nøkkeltall – aktiv rute">
          <div className="kv">
            <span>Total distanse</span><b>{fmtKm(stats.total)}</b>
            <span>Samlet stigning</span><b>{Math.round(stats.up)} m</b>
            <span>Samlet nedstigning</span><b>{Math.round(stats.down)} m</b>
            <span>Høyeste punkt</span><b>{stats.hi ? `${Math.round(stats.hi.z)} moh @ ${fmtKm(stats.hi.d)}` : '–'}</b>
            <span>Laveste punkt</span><b>{stats.lo ? `${Math.round(stats.lo.z)} moh @ ${fmtKm(stats.lo.d)}` : '–'}</b>
            <span>Punkter</span><b>{route.waypoints.length}</b>
            <span>Høydekilde</span><b>{stats.src}</b>
          </div>
          <p className="muted small">Distanse langs rette linjer mellom punkter – faktisk tilbakelagt distanse blir lengre (kryss, terreng).</p>
        </Card>
      )}
    </div>
  );
}
