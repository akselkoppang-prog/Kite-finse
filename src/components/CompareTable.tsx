import { useMemo } from 'react';
import { useStore, routeHash } from '../state/store';
import { buildBarriers, findCrossings } from '../lib/analysis/barriers';
import { windLegs, summarize, scoreColor } from '../lib/analysis/wind';
import { classify } from '../lib/analysis/terrain';
import { densify, DIRS8, haversine, totalLength, fmtKm } from '../lib/geo';
import { Badge, Card } from './ui';
import type { Route } from '../types';

export function useRouteMetrics() {
  const s = useStore();
  return useMemo(() => {
    const bails = Object.values(s.places).filter((p) => p.role.includes('avbrudd'));
    return s.routes.map((r) => {
      const h = routeHash(r);
      const lakes = s.lakes[h]?.lakes ?? [];
      const barriers = buildBarriers(s.hydro?.reservoirs ?? [], lakes, s.zones, s.userVerifiedLakes);
      const crossings = findCrossings(r.waypoints, barriers);
      const red = crossings.filter((c) => c.barrier.status === 'RØD');
      const t = s.terrain[h];
      const steep = t ? t.samples.filter((x) => classify(x).cls === 'bratt').length : null;
      const windByDir = Object.fromEntries(DIRS8.map((d) => [d, summarize(windLegs(r.waypoints, d, 1500, t?.samples)).meanScore])) as Record<(typeof DIRS8)[number], number>;
      const samples = densify(r.waypoints, 2000);
      const bailMean = bails.length ? samples.reduce((acc, p) => acc + Math.min(...bails.map((b) => haversine(p, b))), 0) / samples.length / 1000 : null;
      return {
        route: r,
        km: totalLength(r.waypoints) / 1000,
        crossings,
        red: red.length,
        waterChecked: !!s.hydro && !!s.lakes[h],
        steep,
        windByDir,
        bailMean,
      };
    });
  }, [s.routes, s.hydro, s.lakes, s.zones, s.userVerifiedLakes, s.terrain, s.places]);
}

export default function CompareTable() {
  const rows = useRouteMetrics();
  const windFrom = useStore((s) => s.windFrom);
  const set = useStore((s) => s.set);
  const active = useStore((s) => s.activeRouteId);
  const pick = (f: (r: (typeof rows)[number]) => number | null, filter: (r: (typeof rows)[number]) => boolean = () => true, max = false): Route | undefined => {
    const c = rows.filter(filter).filter((r) => f(r) != null);
    c.sort((a, b) => (max ? f(b)! - f(a)! : f(a)! - f(b)!));
    return c[0]?.route;
  };
  const landOk = (r: (typeof rows)[number]) => r.waterChecked && r.red === 0;
  const recs = [
    { label: 'Korteste forsvarlige landbaserte', r: pick((r) => r.km, landOk), need: 'krever vannkontroll uten røde kryssinger' },
    { label: `Best for vind fra ${windFrom}`, r: pick((r) => r.windByDir[windFrom], landOk, true), need: 'blant landbaserte ruter' },
    { label: 'Minst skredterreng (DTM)', r: pick((r) => r.steep, landOk), need: 'krever terrenganalyse' },
    { label: 'Best avbruddsmuligheter', r: pick((r) => r.bailMean, landOk), need: 'snittavstand til nærmeste hytte/vei' },
  ];
  return (
    <Card title="Sammenlign ruter" className="wide">
      <div className="recs">
        {recs.map((x) => (
          <div key={x.label} className="rec">
            <div className="small muted">{x.label}</div>
            {x.r ? (
              <button className="link" onClick={() => set({ activeRouteId: x.r!.id })}>
                {x.r.name}
              </button>
            ) : (
              <span className="small warn">Ingen kvalifisert rute ({x.need})</span>
            )}
          </div>
        ))}
      </div>
      <div className="tablewrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Rute</th>
              <th>Lengde</th>
              <th>Vann</th>
              <th>Bratte pkt.</th>
              <th>Avbrudd snitt</th>
              {DIRS8.map((d) => (
                <th key={d} className={d === windFrom ? 'hl' : ''}>{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.route.id} className={`clickable ${r.route.id === active ? 'sel' : ''}`} onClick={() => set({ activeRouteId: r.route.id })}>
                <td>
                  <span className="swatch" style={{ background: r.route.color }} /> {r.route.name}
                </td>
                <td>{fmtKm(r.km * 1000)}</td>
                <td>{!r.waterChecked ? <Badge s="GRÅ">ikke kontrollert</Badge> : r.red ? <Badge s="RØD">{r.red} kryssing(er)</Badge> : <Badge s="GRØNN">0 kjente</Badge>}</td>
                <td>{r.steep ?? '–'}</td>
                <td>{r.bailMean != null ? `${r.bailMean.toFixed(1)} km` : '–'}</td>
                {DIRS8.map((d) => (
                  <td key={d}>
                    <span className="dot" style={{ background: scoreColor(r.windByDir[d]) }}>{Math.round(r.windByDir[d] * 100)}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Vindkolonner: beregnet kite-egnethet (0–100) ut fra kursvinkel mot vindretningen (+ DTM-le hvis analysert). En gunstig vindretning gjør IKKE ruten trygg.</p>
    </Card>
  );
}
