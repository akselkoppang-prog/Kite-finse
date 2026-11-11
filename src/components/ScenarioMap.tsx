import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { cumulative, pointAt } from '../lib/geo';
import { escHtml } from '../lib/html';
import { SCENARIO_COLORS } from '../lib/plan/compare';
import { hhmm } from '../lib/sim/expedition';
import type { PlanRun } from '../lib/plan/context';

const TOPO = 'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png';

/** Lite kart som viser rutene og dagsmålene for scenarioene som sammenlignes – én farge per scenario. */
export default function ScenarioMap({ runs }: { runs: PlanRun[] }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
    L.tileLayer(TOPO, { maxZoom: 17, attribution: '© Kartverket' }).addTo(m);
    m.setView([60.2, 8.2], 8);
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const bounds = L.latLngBounds([]);
    runs.forEach((r, i) => {
      if (!r.route) return;
      const color = SCENARIO_COLORS[i % SCENARIO_COLORS.length];
      const ll = r.route.waypoints.map((w) => [w.lat, w.lon] as [number, number]);
      // litt forskjøvet strektykkelse så like ruter fortsatt synes
      L.polyline(ll, { color, weight: 7 - Math.min(4, i * 1.5), opacity: 0.85 }).bindTooltip(escHtml(r.plan.name)).addTo(g);
      ll.forEach((p) => bounds.extend(p));
      const cum = cumulative(r.route.waypoints);
      r.days.forEach((d) => {
        if (d.reason.startsWith('allerede')) return;
        const p = pointAt(r.route!.waypoints, cum, d.endD);
        L.circleMarker([p.lat, p.lon], { radius: 7, color: '#0b1220', weight: 2, fillColor: color, fillOpacity: 1 })
          .bindTooltip(`${escHtml(r.plan.name)} · dag ${d.day}: ${((d.endD - d.startD) / 1000).toFixed(0)} km, ankomst ${hhmm(d.arrival)}`)
          .addTo(g);
      });
    });
    if (bounds.isValid()) m.fitBounds(bounds, { padding: [20, 20] });
  }, [runs]);
  return (
    <div>
      <div ref={el} className="scenmap" />
      <div className="legendmini small">
        {runs.map((r, i) => <span key={r.plan.id}><i style={{ background: SCENARIO_COLORS[i % SCENARIO_COLORS.length] }} />{r.plan.name}</span>)}
      </div>
    </div>
  );
}
