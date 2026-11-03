import { useState } from 'react';
import { useStore } from '../state/store';
import { useActiveRoute, useBarrierCheck, useProfile, useTerrain, useWind } from '../state/derived';
import { subgoals, nearestPlace } from '../lib/subgoals';
import { classify } from '../lib/analysis/terrain';
import { scoreColor } from '../lib/analysis/wind';
import { fmtCoord, fmtDM, fmtKm } from '../lib/geo';
import { nearestName } from '../lib/api/kartverket';
import { Badge, Card, Kind } from './ui';
import type { Status } from '../types';

export default function SubgoalTable() {
  const route = useActiveRoute();
  const { profile } = useProfile(route);
  const terrain = useTerrain(route);
  const check = useBarrierCheck(route);
  const wind = useWind(route);
  const places = useStore((s) => s.places);
  const focusOn = useStore((s) => s.focusOn);
  const windFrom = useStore((s) => s.windFrom);
  const [names, setNames] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  const sgs = subgoals(route);
  if (!route) return null;
  const bails = Object.values(places).filter((p) => p.role.includes('avbrudd'));

  const lookupNames = async () => {
    const out: Record<string, string> = {};
    for (const g of sgs) {
      try {
        const n = await nearestName(g, 3000);
        if (n) out[`${g.idx}`] = `${n.name} (${n.type}${n.dist != null ? `, ${Math.round(n.dist)} m` : ''})`;
      } catch {
        out[`${g.idx}`] = 'oppslag feilet';
      }
    }
    setNames(out);
  };

  return (
    <Card title={`Delmål (~hver 12,5 km) · ${route.name}`} right={<button className="btn small" onClick={lookupNames}>Hent nærmeste stedsnavn</button>} className="wide">
      <div className="tablewrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>Navn</th>
              <th>Koordinater (WGS84)</th>
              <th>Fra start</th>
              <th>Til neste</th>
              <th>Høyde</th>
              <th>Terreng</th>
              <th>Kite ({windFrom})</th>
              <th>Hindringer til neste</th>
              <th>Nærmeste avbrudd</th>
              <th>Kilde / status</th>
            </tr>
          </thead>
          <tbody>
            {sgs.map((g, i) => {
              const next = sgs[i + 1];
              const pz = profile.reduce((b, p) => (Math.abs(p.d - g.d) < Math.abs(b.d - g.d) ? p : b), profile[0]);
              const t = terrain?.samples.reduce((b, x) => (Math.abs(x.d - g.d) < Math.abs(b.d - g.d) ? x : b), terrain.samples[0]);
              const legs = next ? wind.legs.filter((l) => l.d0 >= g.d - 1 && l.d1 <= next.d + 1) : [];
              const ws = legs.length ? legs.reduce((s, l) => s + l.score * (l.d1 - l.d0), 0) / legs.reduce((s, l) => s + (l.d1 - l.d0), 0) : null;
              const cross = next ? check.crossings.filter((c) => c.fromD < next.d && c.toD > g.d) : [];
              const steep = next && terrain ? terrain.samples.filter((x) => x.d >= g.d && x.d <= next.d && ['bratt', 'nær-bratt'].includes(classify(x).cls)).length : 0;
              const bail = nearestPlace(g, bails);
              const st: Status = cross.some((c) => c.barrier.status === 'RØD') ? 'RØD' : !check.waterChecked || !terrain ? 'GRÅ' : steep || cross.length ? 'GUL' : 'GRØNN';
              return (
                <tr key={g.idx} onClick={() => focusOn(g.lat, g.lon, 13)} className="clickable">
                  <td>{g.idx}</td>
                  <td>
                    <b>{g.name}</b>
                    {names[`${g.idx}`] && <div className="small muted">≈ {names[`${g.idx}`]}</div>}
                  </td>
                  <td className="mono small">
                    {fmtCoord(g)}
                    <br />
                    {fmtDM(g)}
                  </td>
                  <td>{fmtKm(g.d)}</td>
                  <td>{next ? fmtKm(next.d - g.d) : '—'}</td>
                  <td>
                    {pz?.z != null ? `${Math.round(pz.z)} moh` : '–'}
                    <div className="small muted">{pz?.src}</div>
                  </td>
                  <td className="small">{t ? classify(t).text : <span className="muted">kjør terrenganalyse</span>}</td>
                  <td>{ws != null ? <span className="dot" style={{ background: scoreColor(ws) }}>{Math.round(ws * 100)} %</span> : '–'}</td>
                  <td className="small">
                    {cross.map((c) => (
                      <div key={c.barrier.id}>🚫 {c.barrier.name}</div>
                    ))}
                    {steep > 0 && <div>⚠️ {steep} bratte punkter</div>}
                    {!cross.length && !steep && (check.waterChecked && terrain ? 'Ingen funnet' : <span className="muted">ikke fullt kontrollert</span>)}
                  </td>
                  <td className="small">{bail ? `${bail.place.name} (${bail.km.toFixed(1)} km luftlinje)` : <span className="muted">hent stedsnavn</span>}</td>
                  <td className="small">
                    <Kind k={g.snapped ? 'forslag' : 'beregnet'} /> <Badge s={st} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Kite-egnethet = beregnet kursvinkel mot valgt vindretning (+ le fra DTM). Status GRØNN betyr kun «kontrollert mot NVE/DTM» – ikke trygt. Klikk rad for å zoome.
      </p>
      <button className="btn small ghost" onClick={() => setShowAll(!showAll)}>{showAll ? 'Skjul' : 'Vis'} alle {route.waypoints.length} rutepunkter</button>
      {showAll && <WaypointTable />}
    </Card>
  );
}

function WaypointTable() {
  const route = useActiveRoute()!;
  const s = useStore();
  let acc = 0;
  return (
    <div className="tablewrap" style={{ maxHeight: 360 }}>
      <table className="tbl small">
        <thead>
          <tr>
            <th>#</th>
            <th>Navn</th>
            <th>Lat</th>
            <th>Lon</th>
            <th>Akk. km</th>
            <th>Høyde GPX</th>
            <th>Type</th>
            <th>Kilde</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {route.waypoints.map((w, i) => {
            if (i > 0) {
              const a = route.waypoints[i - 1];
              const R = 6371008.8, rad = Math.PI / 180;
              const h = Math.sin(((w.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(w.lat * rad) * Math.sin(((w.lon - a.lon) * rad) / 2) ** 2;
              acc += 2 * R * Math.asin(Math.sqrt(h));
            }
            return (
              <tr key={w.id} className={s.selectedWp === w.id ? 'sel' : ''}>
                <td>{i + 1}</td>
                <td>
                  <input className="inline" value={w.name ?? ''} placeholder="—" onChange={(e) => s.renameWaypoint(route.id, w.id, e.target.value)} />
                </td>
                <td className="mono">{w.lat.toFixed(5)}</td>
                <td className="mono">{w.lon.toFixed(5)}</td>
                <td>{(acc / 1000).toFixed(1)}</td>
                <td>{w.eleGpx != null ? Math.round(w.eleGpx) : '–'}</td>
                <td>
                  <Kind k={w.dataKind} />
                </td>
                <td className="muted" title={w.source}>{w.source.slice(0, 40)}</td>
                <td>
                  <button className="link" onClick={() => s.focusOn(w.lat, w.lon, 15)}>vis</button>{' '}
                  <button className="link danger" onClick={() => s.deleteWaypoint(route.id, w.id)}>slett</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
