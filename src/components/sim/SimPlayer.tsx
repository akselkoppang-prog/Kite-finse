import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { usePlay } from '../../state/play';
import { useStore } from '../../state/store';
import { positionAt } from '../../lib/sim/route';
import { cumulative, pointAt, type LatLon } from '../../lib/geo';
import { fmtClock } from '../../lib/sun';
import { KITES } from '../../data/kites';

/** Kartlag: simulert posisjon + tilbakelagt strekning. */
export function SimLayer({ map, route }: { map?: L.Map; route?: LatLon[] }) {
  const result = usePlay((p) => p.result);
  const t = usePlay((p) => p.t);
  const grp = useRef<L.LayerGroup>();
  const marker = useRef<L.Marker>();
  const trail = useRef<L.Polyline>();
  const cum = useRef<number[]>([]);
  useEffect(() => {
    if (!map) return;
    grp.current = L.layerGroup().addTo(map);
    return () => {
      grp.current?.remove();
    };
  }, [map]);
  useEffect(() => {
    cum.current = route ? cumulative(route) : [];
    grp.current?.clearLayers();
    marker.current = undefined;
    trail.current = undefined;
  }, [route, result]);
  useEffect(() => {
    if (!grp.current || !result || !route?.length) return;
    const { d, leg } = positionAt(result, t);
    const p = pointAt(route, cum.current, d);
    const pts: [number, number][] = [];
    const startD = result.legs[0]?.d0 ?? 0;
    for (let x = startD; x < d; x += 500) {
      const q = pointAt(route, cum.current, x);
      pts.push([q.lat, q.lon]);
    }
    pts.push([p.lat, p.lon]);
    if (!trail.current) trail.current = L.polyline(pts, { color: '#facc15', weight: 6, opacity: 0.9 }).addTo(grp.current);
    else trail.current.setLatLngs(pts);
    const icon = L.divIcon({ className: '', html: `<div class="simdot">${leg?.mode === 'kite' ? '🪁' : leg?.mode.startsWith('gå') ? '🚶' : '⛷️'}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
    if (!marker.current) marker.current = L.marker([p.lat, p.lon], { icon, zIndexOffset: 2000, interactive: false }).addTo(grp.current);
    else {
      marker.current.setLatLng([p.lat, p.lon]);
      marker.current.setIcon(icon);
    }
  }, [t, result, route]);
  return null;
}

/** Kontrollpanel for avspilling (vises i kartet når en simulering er lastet). */
export function SimPlayer() {
  const { result, t, playing, rate, label, set } = usePlay();
  const raf = useRef<number>();
  const last = useRef<number>(0);
  useEffect(() => {
    if (!playing || !result) return;
    last.current = performance.now();
    const step = (now: number) => {
      const dtReal = now - last.current;
      last.current = now;
      const cur = usePlay.getState().t;
      const { leg } = positionAt(result, cur);
      const night = leg && cur < leg.t0; // pause/natt – spol raskt
      let next = cur + dtReal * rate * 60 * (night ? 40 : 1);
      if (next >= result.end) {
        next = result.end;
        set({ t: next, playing: false });
        return;
      }
      set({ t: next });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current!);
  }, [playing, rate, result, set]);
  if (!result) return null;
  const { d, leg } = positionAt(result, t);
  const startD = result.legs[0]?.d0 ?? 0;
  const endD = result.legs[result.legs.length - 1]?.d1 ?? 0;
  const k = leg?.kiteId ? KITES.find((x) => x.id === leg.kiteId) : undefined;
  return (
    <div className="simplayer">
      <div className="small"><b>Simulering:</b> {label}</div>
      <div className="row">
        <button className="btn small" onClick={() => set({ playing: !playing })} aria-label={playing ? 'Pause' : 'Spill'}>{playing ? '⏸' : '▶'}</button>
        <button className="btn small" onClick={() => set({ t: result.start, playing: false })} aria-label="Start på nytt">⏮</button>
        {[1, 5, 10].map((r) => <button key={r} className={`btn small ${rate === r ? 'on' : ''}`} onClick={() => set({ rate: r })}>{r}×</button>)}
        <button className="btn small ghost" onClick={() => set({ result: null, playing: false })} aria-label="Lukk">✕</button>
      </div>
      <input type="range" min={result.start} max={result.end} value={t} onChange={(e) => set({ t: +e.target.value, playing: false })} aria-label="Tidslinje" />
      <div className="small mono">
        {new Date(t).toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Oslo' })} {fmtClock(new Date(t))} · dag {leg?.day ?? 1} · {(d / 1000).toFixed(1)} km ({((d - startD) / 1000).toFixed(1)} tilbakelagt, {((endD - d) / 1000).toFixed(1)} igjen)
      </div>
      {leg && <div className="small">{leg.mode}{k ? ` · ${k.name} ${k.size}` : ''} · vind {leg.wind.speed.toFixed(1)} m/s fra {Math.round(leg.wind.dirFrom)}° · TWA {Math.round(leg.twa)}° ({leg.course}{leg.courseMode && leg.courseMode !== 'direkte' ? `, ${leg.courseMode}` : ''}) · {leg.groundKmh.toFixed(0)} km/t over bakken, {leg.progressKmh.toFixed(0)} km/t fremdrift</div>}
      <div className="small muted">1× = 1 simulert minutt per sekund. Netter spoles raskt.</div>
    </div>
  );
}

/** Sluttpunkt og leirkandidater fra dagsdistanse-simulatoren. */
export function DailyLayer({ map }: { map?: L.Map }) {
  const dv = useStore((s) => s.dailyView);
  const grp = useRef<L.LayerGroup>();
  useEffect(() => {
    if (!map) return;
    grp.current = L.layerGroup().addTo(map);
    return () => {
      grp.current?.remove();
    };
  }, [map]);
  useEffect(() => {
    const g = grp.current;
    if (!g) return;
    g.clearLayers();
    if (!dv) return;
    L.marker([dv.lat, dv.lon], { icon: L.divIcon({ className: '', html: '<div class="daybreak">🎯 Sluttpunkt (simulert)</div>', iconSize: [140, 22], iconAnchor: [8, 22] }) }).addTo(g);
    dv.cands.forEach((c, i) => {
      L.marker([c.lat, c.lon], { icon: L.divIcon({ className: '', html: `<div class="camp">⛺<span>K${i + 1}</span></div>`, iconSize: [24, 24], iconAnchor: [12, 12] }) })
        .bindTooltip(`Leirkandidat ${i + 1} (beregnet, ikke befart)<br/>${c.text}${c.flags.length ? `<br/>⚠️ ${c.flags.join('; ')}` : ''}`)
        .addTo(g);
    });
  }, [dv]);
  return null;
}
