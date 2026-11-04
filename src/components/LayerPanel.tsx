import { useState } from 'react';
import { useStore, type LayerToggles } from '../state/store';
import { allCategories } from '../data/categories';

const ITEMS: [keyof LayerToggles, string][] = [
  ['routes', 'Planlagt rute'],
  ['alternatives', 'Alternative ruter'],
  ['reservoirs', 'Regulerte magasiner + dammer (NVE)'],
  ['lakes', 'Innsjøer langs rute (NVE)'],
  ['steep', 'Bratt / skredterreng (DTM-beregnet)'],
  ['windColor', 'Vind-egnethet langs rute'],
  ['places', 'Hytter, avbrudd, transport'],
  ['camps', 'Teltplasser'],
  ['zones', 'Egne soner (rød skravur = no-go)'],
  ['markers', 'Egne markører / notater'],
  ['dayBreaks', 'Dagene (farger, 🏁 og vind per dag)'],
  ['windArrows', 'Vindpiler (MET)'],
  ['nveWms', 'NVE Vannkraft WMS'],
  ['skredWms', 'NVE Bratthet/skred WMS'],
];

export default function LayerPanel() {
  const layers = useStore((s) => s.layers);
  const wms = useStore((s) => s.wms);
  const setLayer = useStore((s) => s.setLayer);
  const custom = useStore((s) => s.customCategories);
  const hidden = useStore((s) => s.hiddenCategories);
  const [open, setOpen] = useState(window.innerWidth > 900);
  return (
    <div className={`layerpanel ${open ? 'open' : ''}`}>
      <button className="btn small" onClick={() => setOpen(!open)}>
        🗺️ Kartlag {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="layer-body">
          <div className="seg">
            {(['topo', 'graatone', 'raster'] as const).map((b) => (
              <button key={b} className={`btn small ${layers.base === b ? 'on' : ''}`} onClick={() => setLayer('base', b)}>
                {b === 'topo' ? 'Topo' : b === 'graatone' ? 'Gråtone' : 'Raster'}
              </button>
            ))}
          </div>
          {ITEMS.map(([k, label]) => {
            const needsWms = (k === 'nveWms' && !wms.nve.layers) || (k === 'skredWms' && !wms.skred.layers);
            return (
              <label key={k} className="chk">
                <input type="checkbox" checked={!!layers[k]} onChange={(e) => setLayer(k, e.target.checked as never)} />
                {label}
                {needsWms && <span className="muted small"> (velg lag i Datakilder)</span>}
              </label>
            );
          })}
          <details className="small">
            <summary>Kategorier ({allCategories(custom).length - hidden.length} synlige)</summary>
            {allCategories(custom).map((c) => (
              <label key={c.id} className="chk">
                <input type="checkbox" checked={!hidden.includes(c.id)} onChange={(e) => useStore.getState().set({ hiddenCategories: e.target.checked ? hidden.filter((x) => x !== c.id) : [...hidden, c.id] })} />
                {c.icon} {c.label}
              </label>
            ))}
          </details>
          <div className="legendmini small">
            <span><i style={{ background: '#ef4444' }} />Hovedrute</span><span><i style={{ background: '#3b82f6' }} />Alternativ</span><span><i style={{ background: '#22c55e' }} />Godkjent av deg</span><span><i style={{ background: '#eab308' }} />Advarsel</span><span><i style={{ background: '#a855f7' }} />Notat</span><span><i style={{ background: '#2dd4bf' }} />USER OVERRIDE</span>
          </div>
          <div className="muted small">Bakgrunn: © Kartverket (CC BY 4.0)</div>
        </div>
      )}
    </div>
  );
}
