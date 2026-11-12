import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { escHtml, numHtml, safeColor } from '../lib/html';
import { useStore } from '../state/store';
import { useActiveRoute, useBarrierCheck, useTerrain, useWind } from '../state/derived';
import { useExpedition, updateDay } from '../state/expedition';
import { DAY_COLORS, hhmm } from '../lib/sim/expedition';
import { SOURCES } from '../data/sources';
import { fmtCoord, fmtDM, nearestOnRoute, uid, cumulative, pointAt } from '../lib/geo';
import { classify } from '../lib/analysis/terrain';
import { scoreColor } from '../lib/analysis/wind';
import { subgoals } from '../lib/subgoals';
import { featureName } from '../lib/api/nve';
import { categoryOf } from '../data/categories';
import { cachedTileLayer } from '../lib/offline';
import { SimLayer, DailyLayer } from './sim/SimPlayer';
import { buildWaypoints, type DraftPt } from '../lib/route/draft';
import { mapClick, movePoint } from '../lib/route/builder';

export const STATUS_COLOR = { GRØNN: '#22c55e', GUL: '#eab308', RØD: '#ef4444', GRÅ: '#94a3b8', BRUKER: '#2dd4bf' } as const;
export const ROUTE_RED = '#ef4444';
export const ALT_BLUE = '#3b82f6';

const esc = escHtml;

export default function MapView() {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>();
  const [mapObj, setMapObj] = useState<L.Map>();
  const groups = useRef<Record<string, L.LayerGroup>>({});
  const baseLayer = useRef<L.TileLayer>();
  const wmsLayers = useRef<Record<string, L.TileLayer.WMS | undefined>>({});

  const s = useStore();
  const route = useActiveRoute();
  const check = useBarrierCheck(route);
  const terrain = useTerrain(route);
  const wind = useWind(route);
  const exp = useExpedition();

  // --- init ---
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true }).setView([60.2, 8.0], 9);
    L.control.scale({ imperial: false }).addTo(m);
    map.current = m;
    setMapObj(m);
    ['zones', 'water', 'alts', 'route', 'wind', 'steep', 'cross', 'places', 'camps', 'sub', 'markers', 'breaks', 'arrows', 'draft', 'xing', 'rdraft'].forEach((k) => (groups.current[k] = L.layerGroup().addTo(m)));
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

  // --- base layer (med offline-cache via service worker) ---
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const id = s.layers.base === 'topo' ? 'kv-topo' : s.layers.base === 'graatone' ? 'kv-graatone' : 'kv-raster';
    baseLayer.current?.remove();
    baseLayer.current = cachedTileLayer(SOURCES[id].urls[0], { maxZoom: 18, attribution: '© <a href="https://www.kartverket.no/">Kartverket</a> (CC BY 4.0)' }).addTo(m);
    baseLayer.current.bringToBack();
  }, [s.layers.base]);

  // --- WMS ---
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const conf = [
      { key: 'nve', on: s.layers.nveWms, cfg: s.wms.nve },
      { key: 'skred', on: s.layers.skredWms, cfg: s.wms.skred },
    ];
    conf.forEach(({ key, on, cfg }) => {
      wmsLayers.current[key]?.remove();
      wmsLayers.current[key] = undefined;
      if (on && cfg.url && cfg.layers) {
        wmsLayers.current[key] = L.tileLayer.wms(cfg.url, { layers: cfg.layers, format: 'image/png', transparent: true, version: '1.3.0', opacity: 0.65, attribution: '© NVE' }).addTo(m);
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
      if (st.editMode === 'draft') { mapClick({ lat, lon: lng }); return; }
      if (st.editMode === 'none') {
        // Hurtigmeny: legg til teltplass, notat eller rutepunkt der du klikket
        const box = document.createElement('div');
        box.className = 'clickmenu';
        const btn = (txt: string, fn: () => void) => {
          const b = document.createElement('button');
          b.className = 'btn small';
          b.textContent = txt;
          b.onclick = () => {
            fn();
            m.closePopup();
          };
          box.appendChild(b);
        };
        btn('⛺ Legg til teltplass', () => {
          const id = uid('camp');
          const night = 1;
          st.set({ camps: [...st.camps, { id, lat, lon: lng, name: `Teltplass ${st.camps.length + 1}`, night, source: 'manuell', kind: 'telt', createdAt: new Date().toISOString() }], selectedCamp: id, selectedWp: null, selectedMarker: null, selectedBarrier: null });
        });
        btn('📝 Notat / markør her', () => {
          const id = uid('mk');
          const now = new Date().toISOString();
          st.set({ markers: [...st.markers, { id, lat, lon: lng, name: `Notat ${st.markers.length + 1}`, category: 'note', source: 'Klikket i kart', verification: 'uverifisert', createdAt: now, updatedAt: now }], selectedMarker: id, selectedWp: null, selectedBarrier: null, selectedCamp: null });
        });
        if (r) btn('📍 Sett inn rutepunkt', () => st.insertWaypoint(r.id, lat, lng));
        btn('⛴ Krysning her (ferje, bro, elv, is …)', () => st.set({ crossings: [...st.crossings, { id: uid('kryss'), name: `Krysning ${st.crossings.length + 1}`, kind: 'elv', lat, lon: lng, waitMin: 0, transferMin: 15 }], tab: 'netter' }));
        L.popup({ closeButton: true, autoPan: true }).setLatLng(e.latlng).setContent(box).openOn(m);
        return;
      }
      if (st.editMode === 'add' && r) st.addWaypoint(r.id, lat, lng);
      else if (st.editMode === 'insert' && r) st.insertWaypoint(r.id, lat, lng);
      else if (st.editMode === 'zone') st.set({ draftZone: [...st.draftZone, { lat, lon: lng }] });
      else if (st.editMode === 'camp') {
        const night = Math.max(1, ...st.camps.map((c) => c.night));
        st.set({ camps: [...st.camps, { id: uid('camp'), lat, lon: lng, name: `Teltplass ${st.camps.length + 1}`, night, source: 'manuell' }] });
      } else if (st.editMode === 'marker') {
        const id = uid('mk');
        const now = new Date().toISOString();
        st.set({ markers: [...st.markers, { id, lat, lon: lng, name: `Notat ${st.markers.length + 1}`, category: 'note', source: 'Klikket i kart', verification: 'uverifisert', createdAt: now, updatedAt: now }], selectedMarker: id, selectedWp: null, selectedBarrier: null });
        st.log('rute', `La til markør ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
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
    const f = s.focus;
    const m = map.current;
    if (!f || !m || !Number.isFinite(f.lat) || !Number.isFinite(f.lon)) return;
    // Kartet kan være skjult (0×0 px) når en knapp på en annen side hopper hit. Å animere et kart uten
    // størrelse gir «Invalid LatLng (NaN, NaN)». Vent til kartet er synlig og har fått størrelse.
    let tries = 0;
    let timer = 0;
    const go = () => {
      m.invalidateSize();
      const sz = m.getSize();
      if (sz.x > 0 && sz.y > 0) m.setView([f.lat, f.lon], f.zoom ?? Math.max(m.getZoom(), 13), { animate: tries === 0, duration: 0.8 });
      else if (tries++ < 20) timer = window.setTimeout(go, 100);
    };
    go();
    return () => clearTimeout(timer);
  }, [s.focus]);

  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && route && route.waypoints.length > 1 && map.current) {
      map.current.fitBounds(L.latLngBounds(route.waypoints.map((w) => [w.lat, w.lon])), { padding: [30, 30] });
      fitted.current = true;
    }
  }, [route]);

  // --- vann: magasiner, innsjøer, dammer ---
  useEffect(() => {
    const g = groups.current.water;
    if (!g) return;
    g.clearLayers();
    check.barriers
      .filter((b) => b.kind !== 'sone')
      .forEach((b) => {
        if (b.kind === 'magasin' && !s.layers.reservoirs) return;
        if (b.kind === 'innsjø' && !s.layers.lakes) return;
        const over = check.activeOverrideKeys.has(b.id);
        const color = over ? STATUS_COLOR.BRUKER : STATUS_COLOR[b.status];
        const lyr = L.geoJSON(b.feature as never, {
          style: { color, weight: over ? 3 : b.kind === 'magasin' ? 2.5 : 1.5, fillColor: color, fillOpacity: b.kind === 'magasin' ? 0.28 : 0.18, dashArray: over ? '2 6' : b.kind === 'innsjø' ? '4 3' : undefined },
        })
          .bindTooltip(`<b>${esc(b.name)}</b><br/>${over ? '<b>USER OVERRIDE</b> – ' : ''}${esc(b.label)}<br/><i>Klikk for detaljer og overstyring</i>`, { sticky: true })
          .on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            useStore.getState().set({ selectedBarrier: b.id, selectedWp: null, selectedMarker: null });
          })
          .addTo(g);
        if (over) {
          const c = lyr.getBounds().getCenter();
          L.marker(c, { icon: L.divIcon({ className: '', html: '<div class="override-tag">✋ USER OVERRIDE</div>', iconSize: [110, 20], iconAnchor: [55, 10] }), interactive: false }).addTo(g);
        }
      });
    (s.hydro?.dams ?? []).forEach((d) => {
      if (!s.layers.reservoirs) return;
      L.geoJSON(d as never, {
        pointToLayer: (_f, ll) => L.circleMarker(ll, { radius: 5, color: '#fff', weight: 1, fillColor: '#0ea5e9', fillOpacity: 1 }),
        style: { color: '#0ea5e9', weight: 2 },
      })
        .bindPopup(`<b>Dam: ${esc(featureName(d.properties) ?? 'uten navn')}</b><br/><small>Kilde: NVE Vannkraft. Farer ved dammer kan ikke overstyres.</small>`)
        .addTo(g);
    });
  }, [check.barriers, check.activeOverrideKeys, s.layers.reservoirs, s.layers.lakes, s.hydro]);

  // --- soner (forbudt = rød skravur) ---
  useEffect(() => {
    const g = groups.current.zones;
    const dg = groups.current.draft;
    if (!g || !dg) return;
    g.clearLayers();
    dg.clearLayers();
    if (s.layers.zones)
      s.zones.forEach((z) => {
        const nogo = z.kind === 'forbudt';
        const c = nogo ? '#ef4444' : '#eab308';
        L.polygon(z.ring.map((p) => [p.lat, p.lon]), { color: c, weight: 2, dashArray: '6 4', fillOpacity: nogo ? 0.9 : 0.2, className: nogo ? 'zone-nogo' : '' })
          .bindPopup(`<b>${esc(z.name)}</b><br/>${nogo ? 'Din no-go-sone – viktig advarsel' : 'Usikker sone (advarsel)'}<br/><small>${esc(z.note ?? '')}</small>`)
          .addTo(g);
      });
    if (s.draftZone.length) {
      L.polyline(s.draftZone.map((p) => [p.lat, p.lon]), { color: '#f97316', dashArray: '4 4' }).addTo(dg);
      s.draftZone.forEach((p) => L.circleMarker([p.lat, p.lon], { radius: 4, color: '#f97316' }).addTo(dg));
    }
  }, [s.zones, s.draftZone, s.layers.zones]);

  // --- alternative ruter (blå) ---
  useEffect(() => {
    const g = groups.current.alts;
    if (!g) return;
    g.clearLayers();
    if (!s.layers.alternatives) return;
    s.routes
      .filter((r) => r.id !== s.activeRouteId && r.visible)
      .forEach((r) => {
        L.polyline(r.waypoints.map((w) => [w.lat, w.lon]), { color: ALT_BLUE, weight: 3, opacity: 0.8, dashArray: '8 6' })
          .bindTooltip(`Alternativ: ${esc(r.name)} – FORESLÅTT, ikke verifisert (klikk for å gjøre til hovedrute)`, { sticky: true })
          .on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            useStore.getState().set({ activeRouteId: r.id });
          })
          .addTo(g);
      });
  }, [s.routes, s.activeRouteId, s.layers.alternatives]);

  // --- ruteveiviseren: START, MÅL, nummererte mellompunkter og linjen som blir lagret ---
  const draft = s.routeDraft;
  useEffect(() => {
    const g = groups.current.rdraft;
    if (!g) return;
    g.clearLayers();
    if (!draft) return;
    const st = useStore.getState();
    const ref = draft.geometry !== 'rett' ? st.routes.find((r) => r.id === draft.geometry) : undefined;
    const line = buildWaypoints(draft, ref);
    if (line.length > 1) {
      L.polyline(line.map((w) => [w.lat, w.lon] as [number, number]), { color: '#0b1220', weight: 8, opacity: 0.6, interactive: false }).addTo(g);
      L.polyline(line.map((w) => [w.lat, w.lon] as [number, number]), { color: '#a855f7', weight: 4, dashArray: draft.geometry === 'rett' ? '8 6' : undefined, interactive: false }).addTo(g);
    }
    const pin = (p: DraftPt, cls: string, label: string, title: string) => {
      const mk = L.marker([p.lat, p.lon], { draggable: true, autoPan: true, zIndexOffset: 2000, icon: L.divIcon({ className: '', html: `<div class="dpin ${cls}">${esc(label)}</div>${p.name ? `<div class="dplabel">${esc(p.name)}</div>` : ''}`, iconSize: [30, 30], iconAnchor: [15, 15] }) });
      mk.bindTooltip(title, { direction: 'top', offset: [0, -14] });
      mk.on('dragend', () => { const ll = mk.getLatLng(); movePoint(p.id, { lat: ll.lat, lon: ll.lng }); });
      mk.on('click', (e) => L.DomEvent.stopPropagation(e));
      mk.addTo(g);
    };
    draft.via.forEach((v, i) => pin(v, 'dp-via', String(i + 1), `Mellompunkt ${i + 1}${v.name ? `: ${esc(v.name)}` : ''} – dra for å flytte`));
    if (draft.start) pin(draft.start, 'dp-start', 'START', `START${draft.start.name ? `: ${esc(draft.start.name)}` : ''} – dra for å flytte`);
    if (draft.finish) pin(draft.finish, 'dp-finish', 'MÅL', `MÅL${draft.finish.name ? `: ${esc(draft.finish.name)}` : ''} – dra for å flytte`);
  }, [draft, s.routes]);

  const drafting = !!s.routeDraft;
  // --- hovedrute (rød) + punkter ---
  useEffect(() => {
    const g = groups.current.route;
    const sg = groups.current.sub;
    if (!g || !sg) return;
    g.clearLayers();
    sg.clearLayers();
    if (!route || !s.layers.routes) return;
    const line = route.waypoints.map((w) => [w.lat, w.lon] as [number, number]);
    L.polyline(line, { color: '#0b1220', weight: 7, opacity: 0.6 }).addTo(g);
    L.polyline(line, { color: ROUTE_RED, weight: 4, dashArray: route.kind === 'gpx' ? undefined : '10 6' })
      .bindTooltip(`Hovedrute: ${esc(route.name)} – FORESLÅTT, ikke verifisert i terrenget`, { sticky: true })
      .addTo(g);
    // mens ruteveiviseren er åpen vises bare linjen – punktene i utkastet er de som gjelder
    if (drafting) return;
    const many = route.waypoints.length > 60;
    // Store GPX-filer: tegn bare navngitte/kategoriserte punkter + hvert n-te som dragbare markører (ytelse)
    const stride = route.waypoints.length > 400 ? Math.ceil(route.waypoints.length / 200) : 1;
    route.waypoints.forEach((w, i) => {
      if (stride > 1 && !w.name && !w.category && i % stride !== 0 && i !== route.waypoints.length - 1 && s.selectedWp !== w.id) return;
      const cat = categoryOf(w.category, s.customCategories);
      if (cat && s.hiddenCategories.includes(cat.id)) return;
      const named = !!w.name;
      const isEnd = i === 0 || i === route.waypoints.length - 1;
      const sel = s.selectedWp === w.id;
      const approved = w.verification === 'brukergodkjent';
      let html: string;
      let size: number;
      if (isEnd && route.waypoints.length > 1 && !cat) {
        size = 18;
        const first = i === 0;
        html = `<div class="endpin ${first ? 'ep-start' : 'ep-finish'} ${sel ? 'sel' : ''}" title="${first ? 'START' : 'MÅL'}: ${esc(w.name ?? route.name)}">${first ? 'S' : 'M'}</div><div class="eplabel ${first ? 'ep-start' : 'ep-finish'}">${first ? 'START' : 'MÅL'}${named ? ` · ${esc(w.name!)}` : ''}</div>`;
      } else if (cat) {
        size = 26;
        html = `<div class="catpin ${sel ? 'sel' : ''} ${approved ? 'approved' : ''}" style="border-color:${safeColor(cat.color)}">${esc(cat.icon)}</div>${named ? `<div class="wplabel">${esc(w.name!)}</div>` : ''}`;
      } else {
        size = named || isEnd ? 14 : many ? 7 : 10;
        html = `<div class="wp ${w.kind} ${sel ? 'sel' : ''} ${approved ? 'approved' : ''} ${w.dataKind}" style="width:${size}px;height:${size}px;border-color:${ROUTE_RED}"></div>${named ? `<div class="wplabel">${esc(w.name!)}</div>` : ''}`;
      }
      const mk = L.marker([w.lat, w.lon], { icon: L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }), draggable: true, autoPan: true });
      mk.on('dragend', () => {
        const ll = mk.getLatLng();
        // start og mål er viktige: bekreft før de flyttes (hindrer at et uhell endrer hele turen)
        if (isEnd && !confirm(`Flytte ${i === 0 ? 'STARTEN' : 'MÅLET'} for «${route.name}» hit? Distanser, dagsetapper og vær regnes på nytt.`)) { mk.setLatLng([w.lat, w.lon]); return; }
        useStore.getState().moveWaypoint(route.id, w.id, ll.lat, ll.lng);
      });
      mk.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        useStore.getState().set({ selectedWp: w.id, selectedMarker: null, selectedBarrier: null });
      });
      if (w.description || w.notes) mk.bindTooltip(`<b>${esc(w.name ?? `Punkt ${i + 1}`)}</b><br/>${esc((w.description ?? w.notes ?? '').slice(0, 140))}`);
      mk.addTo(g);
    });
    subgoals(route).forEach((sgp) => {
      if (sgp.idx === 0) return;
      L.marker([sgp.lat, sgp.lon], { icon: L.divIcon({ className: '', html: `<div class="subgoal"><span>${sgp.idx}</span></div>`, iconSize: [22, 22], iconAnchor: [11, 30] }), zIndexOffset: -100 })
        .bindTooltip(`Delmål ${sgp.idx}: ${esc(sgp.name)} · ${(sgp.d / 1000).toFixed(1)} km`)
        .addTo(sg);
    });
  }, [route, s.layers.routes, s.selectedWp, s.customCategories, s.hiddenCategories, drafting]);

  // --- egne markører (lilla) ---
  useEffect(() => {
    const g = groups.current.markers;
    if (!g) return;
    g.clearLayers();
    if (!s.layers.markers) return;
    s.markers.forEach((m) => {
      const cat = categoryOf(m.category, s.customCategories);
      if (s.hiddenCategories.includes(m.category)) return;
      const approved = m.verification === 'brukergodkjent';
      const html = `<div class="catpin marker ${s.selectedMarker === m.id ? 'sel' : ''} ${approved ? 'approved' : ''}" style="border-color:${safeColor(cat?.color)}">${esc(cat?.icon ?? '📝')}</div><div class="wplabel">${esc(m.name)}</div>`;
      const mk = L.marker([m.lat, m.lon], { draggable: true, icon: L.divIcon({ className: '', html, iconSize: [26, 26], iconAnchor: [13, 13] }) });
      mk.on('dragend', () => {
        const ll = mk.getLatLng();
        const st = useStore.getState();
        st.set({ markers: st.markers.map((x) => (x.id === m.id ? { ...x, lat: ll.lat, lon: ll.lng, updatedAt: new Date().toISOString() } : x)) });
      });
      mk.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        useStore.getState().set({ selectedMarker: m.id, selectedWp: null, selectedBarrier: null });
      });
      if (m.description) mk.bindTooltip(`<b>${esc(m.name)}</b><br/>${esc(m.description.slice(0, 140))}`);
      mk.addTo(g);
    });
  }, [s.markers, s.layers.markers, s.selectedMarker, s.customCategories, s.hiddenCategories]);

  // --- ekspedisjonsdager: farget strekning, dra-bart sluttflagg og vindpil per dag ---
  useEffect(() => {
    const g = groups.current.breaks;
    if (!g) return;
    g.clearLayers();
    if (!route || !s.layers.dayBreaks || !exp.days.length) return;
    const cum = cumulative(route.waypoints);
    exp.days.forEach((d, i) => {
      if (d.endD <= d.startD) return;
      const color = DAY_COLORS[i % DAY_COLORS.length];
      const pts: [number, number][] = [];
      for (let x = d.startD; x < d.endD; x += 300) { const q = pointAt(route.waypoints, cum, x); pts.push([q.lat, q.lon]); }
      const e = pointAt(route.waypoints, cum, d.endD);
      pts.push([e.lat, e.lon]);
      L.polyline(pts, { color, weight: 7, opacity: 0.85, interactive: false }).addTo(g);
      // vindpil for dagen (ditt scenario) midt på strekningen
      const mid = pointAt(route.waypoints, cum, (d.startD + d.endD) / 2);
      const w = exp.plan.days[i]?.wind;
      if (w) L.marker([mid.lat, mid.lon], { interactive: true, icon: L.divIcon({ className: '', html: `<div class="daywind" style="border-color:${color}"><span style="transform:rotate(${(w.dir + 180) % 360 - 90}deg)">➤</span><b>${numHtml(w.avg)}</b></div>`, iconSize: [42, 42], iconAnchor: [21, 21] }) })
        .bindTooltip(`Dag ${d.day}: vind fra ${numHtml(Math.round(w.dir))}°, ${numHtml(w.avg)} m/s (${numHtml(w.min)}–${numHtml(w.max)}, kast ${numHtml(w.gust)}) – ${exp.plan.days[i].windMode === 'manuell' ? 'ditt scenario, ikke prognose' : 'værmelding'}`)
        .addTo(g);
      const last = i === exp.days.length - 1 && d.remainingKm <= 0.05;
      if (last) return;
      const mk = L.marker([e.lat, e.lon], { draggable: true, zIndexOffset: 600, icon: L.divIcon({ className: '', html: `<div class="dayend" style="background:${color}">🏁 Dag ${d.day} · ${hhmm(d.arrival)}</div>`, iconSize: [110, 24], iconAnchor: [10, 24] }) });
      mk.on('dragend', () => {
        const ll = mk.getLatLng();
        const near = nearestOnRoute(route.waypoints, { lat: ll.lat, lon: ll.lng });
        updateDay(i, { target: { mode: 'stopp', stopD: near.d }, campId: undefined });
      });
      mk.bindTooltip(`Slutt dag ${d.day}: ${(d.endD / 1000).toFixed(1)} km, ankomst ${hhmm(d.arrival)}. Dra langs ruten for å velge ditt eget stopp.`).addTo(g);
    });
  }, [route, exp.days, exp.plan, s.layers.dayBreaks]);

  // --- vind-egnethet ---
  useEffect(() => {
    const g = groups.current.wind;
    if (!g) return;
    g.clearLayers();
    if (!s.layers.windColor) return;
    wind.legs.forEach((l) => {
      L.polyline([[l.from.lat, l.from.lon], [l.to.lat, l.to.lon]], { color: scoreColor(l.score), weight: 9, opacity: 0.85 })
        .bindTooltip(`${esc(l.courseText)}<br/>Kurs ${Math.round(l.heading)}°, ${Math.round(l.angle)}° fra vind ${esc(s.windFrom)}<br/>${l.notes.map(esc).join('<br/>')}<br/><i>Beregnet – ikke observasjon</i>`, { sticky: true })
        .addTo(g);
    });
  }, [wind, s.layers.windColor, s.windFrom]);

  // --- vindpiler fra MET-prognose ---
  useEffect(() => {
    const g = groups.current.arrows;
    if (!g) return;
    g.clearLayers();
    if (!s.layers.windArrows) return;
    s.windPoints.forEach((wp) => {
      const row = wp.fc.rows[Math.min(s.forecastHour, wp.fc.rows.length - 1)];
      if (!row || row.windFrom == null) return;
      const to = (row.windFrom + 180) % 360;
      const html = `<div class="windarrow"><div class="arr" style="transform:rotate(${to}deg)">➤</div><div class="wlbl">${row.windSpeed?.toFixed(0) ?? '–'}<small>/${row.windGust?.toFixed(0) ?? '–'}</small></div></div>`;
      L.marker([wp.lat, wp.lon], { icon: L.divIcon({ className: '', html, iconSize: [44, 44], iconAnchor: [22, 22] }), interactive: true })
        .bindTooltip(`<b>${esc(wp.label)}</b><br/>${new Date(row.time).toLocaleString('nb-NO', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}<br/>Vind ${numHtml(row.windSpeed)} m/s (kast ${numHtml(row.windGust)}) fra ${numHtml(Math.round(row.windFrom))}°<br/>${numHtml(row.temp)}°C<br/><i>MET-prognose for punktet (modellgitter) – ikke måling</i>`)
        .addTo(g);
    });
  }, [s.windPoints, s.forecastHour, s.layers.windArrows]);

  // --- bratt / terreng ---
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

  // --- kryssinger ---
  useEffect(() => {
    const g = groups.current.cross;
    if (!g) return;
    g.clearLayers();
    check.crossings.forEach((c) => {
      const color = c.blocking ? '#ff0040' : c.label === 'BRUKERGODKJENT' ? STATUS_COLOR.BRUKER : '#eab308';
      L.polyline([[c.entry.lat, c.entry.lon], [c.exit.lat, c.exit.lon]], { color, weight: 10, opacity: 0.9 })
        .bindTooltip(`${esc(c.label)}: ${esc(c.barrier.name)} (${Math.round(c.lengthM)} m)<br/>${esc(c.barrier.label)}${c.hazards.length ? `<br/>⚠️ ${esc(c.hazards.join('; '))}` : ''}`, { sticky: true })
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          useStore.getState().set({ selectedBarrier: c.barrier.id, selectedWp: null, selectedMarker: null });
        })
        .addTo(g);
    });
    check.bandWarnings.forEach((w) => {
      L.circleMarker([w.wp.lat, w.wp.lon], { radius: 11, color: '#ff0040', weight: 3, fill: false, dashArray: '3 3' })
        .bindTooltip(`GPX-høyde ${Math.round(w.wp.eleGpx!)} moh er innenfor reguleringsintervallet til ${esc(w.water)} (${esc(w.band)}).<br/>Indikasjon på at punktet ligger PÅ magasinet – kontroller.`)
        .addTo(g);
    });
  }, [check.crossings, check.bandWarnings]);

  // --- steder ---
  useEffect(() => {
    const g = groups.current.places;
    if (!g) return;
    g.clearLayers();
    if (!s.layers.places) return;
    Object.values(s.places).forEach((p) => {
      const emoji = p.role.includes('hytte') ? '🛖' : p.role.includes('transport') ? '🚉' : '📍';
      L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html: `<div class="place">${emoji}<span>${esc(p.name)}</span></div>`, iconSize: [20, 20], iconAnchor: [10, 10] }) })
        .bindPopup(`<b>${esc(p.name)}</b> (${esc(p.type)})<br/>${esc(p.kommune ?? '')}<br/>${fmtCoord(p)}<br/><small>Kilde: ${esc(p.source)}, hentet ${esc(String(p.fetchedAt ?? '').slice(0, 10))}.<br/>Åpningstider/tilgang IKKE kontrollert – sjekk ut.no.</small>`)
        .addTo(g);
    });
  }, [s.places, s.layers.places]);

  // --- teltplasser ---
  useEffect(() => {
    const g = groups.current.camps;
    if (!g) return;
    g.clearLayers();
    if (!s.layers.camps) return;
    const plan = s.plans.find((p) => p.id === s.activePlanId);
    const ICON: Record<string, string> = { telt: '⛺', hytte: '🏠', gapahuk: '🛖', leirplass: '🏕️', annet: '📍' };
    s.camps.forEach((c) => {
      // natten i AKTIVT scenario (ikke et felles nattnummer); steder som ikke gjelder scenarioet vises dempet
      const ni = plan ? plan.days.findIndex((d) => d.campId === c.id) : -1;
      const other = !!c.scenarioIds?.length && !c.scenarioIds.includes(s.activePlanId);
      const lbl = ni >= 0 ? `N${ni + 1}★` : other ? 'annet scen.' : '';
      const mk = L.marker([c.lat, c.lon], { draggable: true, opacity: other ? 0.45 : 1, icon: L.divIcon({ className: '', html: `<div class="camp ${c.approved ? 'approved' : ''} ${ni >= 0 ? 'pref' : ''}">${ICON[c.kind ?? 'telt'] ?? '📍'}<span>${lbl}${c.capacity != null ? ` ${numHtml(c.capacity)}p` : ''}${c.resupply ? ' 🥫' : ''}${c.approved ? ' ✓' : ''}</span></div>`, iconSize: [24, 24], iconAnchor: [12, 12] }) });
      mk.on('dragend', () => {
        const ll = mk.getLatLng();
        const st = useStore.getState();
        st.set({ camps: st.camps.map((x) => (x.id === c.id ? { ...x, lat: ll.lat, lon: ll.lng, source: 'manuell' } : x)) });
      });
      mk.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        useStore.getState().set({ selectedCamp: c.id, selectedWp: null, selectedMarker: null, selectedBarrier: null });
      });
      mk.bindTooltip(`${esc(c.name)} – natt ${numHtml(c.night)}${c.role ? ` (${esc(c.role)})` : ''} · ${esc(c.source)}. ${c.approved ? 'Brukergodkjent (ikke befart av verktøyet).' : 'IKKE befart.'} Klikk for å redigere.`).addTo(g);
    });
  }, [s.camps, s.layers.camps, s.plans, s.activePlanId]);

  // --- krysninger (ferje, bro, elv, is …) ---
  useEffect(() => {
    const g = groups.current.xing;
    if (!g) return;
    g.clearLayers();
    const ICON: Record<string, string> = { ferje: '⛴', båt: '🚤', bro: '🌉', elv: '〰️', vei: '🛣', is: '🧊', grense: '🛂', annet: '⚑' };
    s.crossings.forEach((c) => {
      const mk = L.marker([c.lat, c.lon], { draggable: true, icon: L.divIcon({ className: '', html: `<div class="xing">${ICON[c.kind] ?? '⚑'}<span>${esc(c.name)}</span></div>`, iconSize: [24, 24], iconAnchor: [12, 12] }) });
      mk.on('dragend', () => {
        const ll = mk.getLatLng();
        const st = useStore.getState();
        st.set({ crossings: st.crossings.map((x) => (x.id === c.id ? { ...x, lat: ll.lat, lon: ll.lng } : x)) });
      });
      mk.on('click', (e) => { L.DomEvent.stopPropagation(e); useStore.getState().set({ tab: 'netter' }); });
      mk.bindTooltip(`${esc(c.name)} – ${esc(c.kind)}: ${c.schedule ? `avganger ${esc(c.schedule)}` : `venting ${numHtml(c.waitMin)} min`}, overgang ${numHtml(c.transferMin)} min${c.source ? '' : ' (ikke bekreftet)'}. Klikk for å redigere.`).addTo(g);
    });
  }, [s.crossings]);

  return (
    <>
      <div ref={el} className="map" />
      <SimLayer map={mapObj} route={route?.waypoints} />
      <DailyLayer map={mapObj} />
    </>
  );
}
