import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useStore } from '../state/store';
import { useActiveRoute, useBarrierCheck, useTerrain, useWind } from '../state/derived';
import { SOURCES } from '../data/sources';
import { fmtCoord, fmtDM, uid } from '../lib/geo';
import { classify } from '../lib/analysis/terrain';
import { scoreColor } from '../lib/analysis/wind';
import { subgoals } from '../lib/subgoals';
import { featureName } from '../lib/api/nve';

const STATUS_COLOR = { GRØNN: '#22c55e', GUL: '#eab308', RØD: '#ef4444', GRÅ: '#94a3b8' } as const;

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

function propsTable(p: Record<string, unknown> | undefined) {
  if (!p) return '';
  return `<table class="ptable">${Object.entries(p)
    .filter(([k, v]) => v != null && v !== '' && !k.startsWith('__') && !/shape|globalid/i.test(k))
    .slice(0, 18)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(String(v))}</td></tr>`)
    .join('')}</table>`;
}

export default function MapView() {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>();
  const groups = useRef<Record<string, L.LayerGroup>>({});
  const baseLayer = useRef<L.TileLayer>();
  const wmsLayers = useRef<Record<string, L.TileLayer.WMS | undefined>>({});

  const s = useStore();
  const route = useActiveRoute();
  const check = useBarrierCheck(route);
  const terrain = useTerrain(route);
  const wind = useWind(route);

  // --- init ---
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, preferCanvas: false }).setView([60.2, 8.0], 9);
    L.control.scale({ imperial: false }).addTo(m);
    map.current = m;
    ['zones', 'water', 'wms', 'alts', 'route', 'wind', 'steep', 'cross', 'places', 'camps', 'sub', 'draft'].forEach((k) => (groups.current[k] = L.layerGroup().addTo(m)));
    const coordBox = new L.Control({ position: 'bottomleft' });
    coordBox.onAdd = () => {
      const d = L.DomUtil.create('div', 'coordbox');
      d.textContent = 'Beveg musen over kartet';
      m.on('mousemove', (e: L.LeafletMouseEvent) => (d.textContent = `${fmtCoord({ lat: e.latlng.lat, lon: e.latlng.lng })}  ·  ${fmtDM({ lat: e.latlng.lat, lon: e.latlng.lng })}`));
      return d;
    };
    coordBox.addTo(m);
    setTimeout(() => m.invalidateSize(), 100);
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => ro.disconnect();
  }, []);

  // --- base layer ---
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const id = s.layers.base === 'topo' ? 'kv-topo' : s.layers.base === 'graatone' ? 'kv-graatone' : 'kv-raster';
    baseLayer.current?.remove();
    baseLayer.current = L.tileLayer(SOURCES[id].urls[0], { maxZoom: 18, attribution: '© <a href="https://www.kartverket.no/">Kartverket</a> (CC BY 4.0)' }).addTo(m);
    baseLayer.current.bringToBack();
  }, [s.layers.base]);

  // --- WMS ---
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const conf = [
      { key: 'nve', on: s.layers.nveWms, cfg: s.wms.nve, attr: '© NVE' },
      { key: 'skred', on: s.layers.skredWms, cfg: s.wms.skred, attr: '© NVE' },
    ];
    conf.forEach(({ key, on, cfg, attr }) => {
      wmsLayers.current[key]?.remove();
      wmsLayers.current[key] = undefined;
      if (on && cfg.url && cfg.layers) {
        wmsLayers.current[key] = L.tileLayer.wms(cfg.url, { layers: cfg.layers, format: 'image/png', transparent: true, version: '1.3.0', opacity: 0.65, attribution: attr }).addTo(m);
      }
    });
  }, [s.layers.nveWms, s.layers.skredWms, s.wms]);

  // --- map clicks (redigering) ---
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const onClick = (e: L.LeafletMouseEvent) => {
      const st = useStore.getState();
      const r = st.routes.find((x) => x.id === st.activeRouteId);
      const { lat, lng } = e.latlng;
      if (st.editMode === 'add' && r) st.addWaypoint(r.id, lat, lng);
      else if (st.editMode === 'insert' && r) st.insertWaypoint(r.id, lat, lng);
      else if (st.editMode === 'zone') st.set({ draftZone: [...st.draftZone, { lat, lon: lng }] });
      else if (st.editMode === 'camp') {
        const night = Math.max(1, ...st.camps.map((c) => c.night));
        st.set({ camps: [...st.camps, { id: uid('camp'), lat, lon: lng, name: `Teltplass ${st.camps.length + 1}`, night, source: 'manuell' }] });
      }
    };
    m.on('click', onClick);
    el.current!.style.cursor = s.editMode === 'none' ? '' : 'crosshair';
    return () => {
      m.off('click', onClick);
    };
  }, [s.editMode]);

  // --- focus ---
  useEffect(() => {
    if (s.focus && map.current) map.current.flyTo([s.focus.lat, s.focus.lon], s.focus.zoom ?? Math.max(map.current.getZoom(), 13), { duration: 0.8 });
  }, [s.focus]);

  // --- fit to route first time ---
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && route && route.waypoints.length > 1 && map.current) {
      map.current.fitBounds(L.latLngBounds(route.waypoints.map((w) => [w.lat, w.lon])), { padding: [30, 30] });
      fitted.current = true;
    }
  }, [route]);

  // --- water layers ---
  useEffect(() => {
    const g = groups.current.water;
    if (!g) return;
    g.clearLayers();
    check.barriers
      .filter((b) => b.kind !== 'sone')
      .forEach((b) => {
        if (b.kind === 'magasin' && !s.layers.reservoirs) return;
        if (b.kind === 'innsjø' && !s.layers.lakes) return;
        const color = STATUS_COLOR[b.status];
        L.geoJSON(b.feature as never, {
          style: { color, weight: b.kind === 'magasin' ? 2.5 : 1.5, fillColor: color, fillOpacity: b.kind === 'magasin' ? 0.28 : 0.18, dashArray: b.kind === 'innsjø' ? '4 3' : undefined },
        })
          .bindPopup(
            `<b>${esc(b.name)}</b><br/><span class="pill" style="background:${color}">${b.status}</span> ${esc(b.label)}<br/>` +
              (b.hrv != null || b.lrv != null ? `HRV: ${b.hrv ?? '–'} moh · LRV: ${b.lrv ?? '–'} moh<br/>` : 'HRV/LRV: ikke tilgjengelig i data<br/>') +
              `<small>Kilde: ${esc(b.source)}</small>${propsTable(b.props)}`,
            { maxWidth: 360 },
          )
          .addTo(g);
      });
    (s.hydro?.dams ?? []).forEach((d) => {
      if (!s.layers.reservoirs) return;
      L.geoJSON(d as never, {
        pointToLayer: (_f, ll) => L.circleMarker(ll, { radius: 5, color: '#fff', weight: 1, fillColor: '#0ea5e9', fillOpacity: 1 }),
        style: { color: '#0ea5e9', weight: 2 },
      })
        .bindPopup(`<b>Dam: ${esc(featureName(d.properties) ?? 'uten navn')}</b><br/><small>Kilde: NVE Vannkraft</small>${propsTable(d.properties)}`)
        .addTo(g);
    });
  }, [check.barriers, s.layers.reservoirs, s.layers.lakes, s.hydro]);

  // --- zones ---
  useEffect(() => {
    const g = groups.current.zones;
    const dg = groups.current.draft;
    if (!g || !dg) return;
    g.clearLayers();
    dg.clearLayers();
    if (s.layers.zones)
      s.zones.forEach((z) => {
        const c = z.kind === 'forbudt' ? '#ef4444' : '#eab308';
        L.polygon(z.ring.map((p) => [p.lat, p.lon]), { color: c, weight: 2, dashArray: '6 4', fillOpacity: 0.2 })
          .bindPopup(`<b>${esc(z.name)}</b><br/>${z.kind === 'forbudt' ? 'Forbudt sone (RØD)' : 'Usikker sone (GUL)'}<br/><small>${esc(z.note ?? '')}</small>`)
          .addTo(g);
      });
    if (s.draftZone.length) {
      L.polyline(s.draftZone.map((p) => [p.lat, p.lon]), { color: '#f97316', dashArray: '4 4' }).addTo(dg);
      s.draftZone.forEach((p) => L.circleMarker([p.lat, p.lon], { radius: 4, color: '#f97316' }).addTo(dg));
    }
  }, [s.zones, s.draftZone, s.layers.zones]);

  // --- alternative routes ---
  useEffect(() => {
    const g = groups.current.alts;
    if (!g) return;
    g.clearLayers();
    if (!s.layers.alternatives) return;
    s.routes
      .filter((r) => r.id !== s.activeRouteId && r.visible)
      .forEach((r) => {
        L.polyline(r.waypoints.map((w) => [w.lat, w.lon]), { color: r.color, weight: 3, opacity: 0.75, dashArray: '8 6' })
          .bindTooltip(`${esc(r.name)} – FORESLÅTT, ikke verifisert (klikk for å aktivere)`, { sticky: true })
          .on('click', () => useStore.getState().set({ activeRouteId: r.id }))
          .addTo(g);
      });
  }, [s.routes, s.activeRouteId, s.layers.alternatives]);

  // --- active route + markers ---
  useEffect(() => {
    const g = groups.current.route;
    const sg = groups.current.sub;
    if (!g || !sg) return;
    g.clearLayers();
    sg.clearLayers();
    if (!route || !s.layers.routes) return;
    const line = route.waypoints.map((w) => [w.lat, w.lon] as [number, number]);
    L.polyline(line, { color: '#0b1220', weight: 7, opacity: 0.6 }).addTo(g);
    L.polyline(line, { color: route.color, weight: 4, dashArray: route.kind === 'gpx' ? undefined : '10 6' })
      .bindTooltip(`${esc(route.name)} – FORESLÅTT RUTE, ikke verifisert i terrenget`, { sticky: true })
      .addTo(g);
    const many = route.waypoints.length > 60;
    route.waypoints.forEach((w, i) => {
      const named = !!w.name;
      const isEnd = i === 0 || i === route.waypoints.length - 1;
      const sel = s.selectedWp === w.id;
      const size = named || isEnd ? 14 : many ? 7 : 10;
      const cls = `wp ${w.kind} ${named ? 'named' : ''} ${sel ? 'sel' : ''} ${w.dataKind}`;
      const icon = L.divIcon({ className: '', html: `<div class="${cls}" style="width:${size}px;height:${size}px;border-color:${route.color}"></div>${named ? `<div class="wplabel">${esc(w.name!)}</div>` : ''}`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
      const mk = L.marker([w.lat, w.lon], { icon, draggable: true, autoPan: true });
      mk.on('dragend', () => {
        const ll = mk.getLatLng();
        useStore.getState().moveWaypoint(route.id, w.id, ll.lat, ll.lng);
      });
      mk.on('click', () => useStore.getState().set({ selectedWp: w.id }));
      mk.bindPopup(() => {
        const d = document.createElement('div');
        d.innerHTML = `<b>${esc(w.name ?? `Punkt ${i + 1}`)}</b><br/>${fmtCoord(w)}<br/>${fmtDM(w)}<br/>Høyde (GPX/Garmin): ${w.eleGpx != null ? `${Math.round(w.eleGpx)} moh` : '–'}<br/><small>Type: ${w.kind} · ${w.dataKind}<br/>Kilde: ${esc(w.source)}</small><br/>`;
        const del = document.createElement('button');
        del.textContent = 'Slett punkt';
        del.className = 'btn small danger';
        del.onclick = () => {
          useStore.getState().deleteWaypoint(route.id, w.id);
          map.current?.closePopup();
        };
        d.appendChild(del);
        return d;
      });
      mk.addTo(g);
    });
    subgoals(route).forEach((sgp) => {
      if (sgp.idx === 0) return;
      L.marker([sgp.lat, sgp.lon], { icon: L.divIcon({ className: '', html: `<div class="subgoal"><span>${sgp.idx}</span></div>`, iconSize: [22, 22], iconAnchor: [11, 30] }), interactive: true, zIndexOffset: -100 })
        .bindTooltip(`Delmål ${sgp.idx}: ${esc(sgp.name)} · ${(sgp.d / 1000).toFixed(1)} km`)
        .addTo(sg);
    });
  }, [route, s.layers.routes, s.selectedWp]);

  // --- wind coloring ---
  useEffect(() => {
    const g = groups.current.wind;
    if (!g) return;
    g.clearLayers();
    if (!s.layers.windColor) return;
    wind.legs.forEach((l) => {
      L.polyline([[l.from.lat, l.from.lon], [l.to.lat, l.to.lon]], { color: scoreColor(l.score), weight: 9, opacity: 0.85 })
        .bindTooltip(`${l.courseText}<br/>Kurs ${Math.round(l.heading)}°, ${Math.round(l.angle)}° fra vind ${s.windFrom}<br/>${l.notes.join('<br/>')}<br/><i>Beregnet – ikke observasjon</i>`, { sticky: true })
        .addTo(g);
    });
  }, [wind, s.layers.windColor, s.windFrom]);

  // --- steep / terrain flags ---
  useEffect(() => {
    const g = groups.current.steep;
    if (!g) return;
    g.clearLayers();
    if (!s.layers.steep || !terrain) return;
    terrain.samples.forEach((t) => {
      const c = classify(t);
      if (c.cls === 'bratt' || c.cls === 'nær-bratt' || c.cls === 'rygg') {
        const color = c.cls === 'bratt' ? '#ef4444' : c.cls === 'nær-bratt' ? '#f97316' : '#a78bfa';
        L.circleMarker([t.lat, t.lon], { radius: 6, color: '#111', weight: 1, fillColor: color, fillOpacity: 0.95 })
          .bindTooltip(`${c.text}<br/>${(t.d / 1000).toFixed(1)} km · ${t.z != null ? Math.round(t.z) : '–'} moh (DTM)<br/><i>Beregnet fra Kartverket DTM</i>`)
          .addTo(g);
      }
    });
  }, [terrain, s.layers.steep]);

  // --- crossings ---
  useEffect(() => {
    const g = groups.current.cross;
    if (!g) return;
    g.clearLayers();
    check.crossings.forEach((c) => {
      L.polyline([[c.entry.lat, c.entry.lon], [c.exit.lat, c.exit.lon]], { color: '#ff0040', weight: 10, opacity: 0.9 })
        .bindTooltip(`KRYSSING: ${esc(c.barrier.name)} (${Math.round(c.lengthM)} m)<br/>${esc(c.barrier.label)}`, { sticky: true })
        .addTo(g);
    });
    check.bandWarnings.forEach((w) => {
      L.circleMarker([w.wp.lat, w.wp.lon], { radius: 11, color: '#ff0040', weight: 3, fill: false, dashArray: '3 3' })
        .bindTooltip(`GPX-høyde ${Math.round(w.wp.eleGpx!)} moh er innenfor reguleringsintervallet til ${esc(w.water)} (${w.band}).<br/>Indikasjon på at punktet ligger PÅ magasinet – kontroller.`)
        .addTo(g);
    });
  }, [check.crossings, check.bandWarnings]);

  // --- places ---
  useEffect(() => {
    const g = groups.current.places;
    if (!g) return;
    g.clearLayers();
    if (!s.layers.places) return;
    Object.values(s.places).forEach((p) => {
      const emoji = p.role.includes('hytte') ? '🛖' : p.role.includes('transport') ? '🚉' : '📍';
      L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html: `<div class="place">${emoji}<span>${esc(p.name)}</span></div>`, iconSize: [20, 20], iconAnchor: [10, 10] }) })
        .bindPopup(`<b>${esc(p.name)}</b> (${esc(p.type)})<br/>${esc(p.kommune ?? '')}<br/>${fmtCoord(p)}<br/><small>Kilde: ${esc(p.source)}, hentet ${p.fetchedAt.slice(0, 10)}.<br/>Åpningstider/tilgang IKKE kontrollert – sjekk ut.no.</small>`)
        .addTo(g);
    });
  }, [s.places, s.layers.places]);

  // --- camps ---
  useEffect(() => {
    const g = groups.current.camps;
    if (!g) return;
    g.clearLayers();
    if (!s.layers.camps) return;
    s.camps.forEach((c) => {
      const mk = L.marker([c.lat, c.lon], { draggable: true, icon: L.divIcon({ className: '', html: `<div class="camp">⛺<span>N${c.night}</span></div>`, iconSize: [24, 24], iconAnchor: [12, 12] }) });
      mk.on('dragend', () => {
        const ll = mk.getLatLng();
        const st = useStore.getState();
        st.set({ camps: st.camps.map((x) => (x.id === c.id ? { ...x, lat: ll.lat, lon: ll.lng, source: 'manuell' } : x)) });
      });
      mk.bindTooltip(`${esc(c.name)} – natt ${c.night} (${c.source}). IKKE befart. Se Dagplan for vurdering.`).addTo(g);
    });
  }, [s.camps, s.layers.camps]);

  return <div ref={el} className="map" />;
}
