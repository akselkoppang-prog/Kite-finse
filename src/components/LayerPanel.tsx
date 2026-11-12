import { useState } from 'react';
import { useStore, type LayerToggles } from '../state/store';
import { allCategories } from '../data/categories';

// de vanligste lagene vises alltid; resten ligger under «Flere kartlag»
const MAIN: [keyof LayerToggles, string][] = [
  ['routes', 'Planlagt rute'],
  ['dayBreaks', 'Dagsetapper (farge, 🏁 dagsslutt, vind)'],
  ['camps', 'Overnattingssteder'],
  ['places', 'Hytter, avbrudd og transport'],
  ['alternatives', 'Alternative ruter'],
  ['reservoirs', 'Regulerte vann og dammer (NVE)'],
];
const MORE: [keyof LayerToggles, string][] = [
  ['lakes', 'Innsjøer langs ruten (NVE)'],
  ['steep', 'Bratt / skredterreng (beregnet)'],
  ['windColor', 'Hvor godt vinden passer langs ruten'],
  ['windArrows', 'Vindpiler fra værmeldingen (MET)'],
  ['zones', 'Egne soner (rød skravur = ikke gå)'],
  ['markers', 'Egne markører og notater'],
  ['nveWms', 'NVE vannkraft – kartbilde (WMS)'],
  ['skredWms', 'NVE bratthet/skred – kartbilde (WMS)'],
];

export default function LayerPanel() {
  const layers = useStore((s) => s.layers);
  const wms = useStore((s) => s.wms);
  const setLayer = useStore((s) => s.setLayer);
  const custom = useStore((s) => s.customCategories);
  const hidden = useStore((s) => s.hiddenCategories);
  const [open, setOpen] = useState(false);
  const row = (k: keyof LayerToggles, label: string) => {
    const needsWms = (k === 'nveWms' && !wms.nve.layers) || (k === 'skredWms' && !wms.skred.layers);
    return (
      <label key={k} className="chk">
        <input type="checkbox" checked={!!layers[k]} onChange={(e) => setLayer(k, e.target.checked as never)} />
        {label}
        {needsWms && <span className="muted small"> (velg lag i Datakilder)</span>}
      </label>
    );
  };
  return (
    <div className={`layerpanel ${open ? 'open' : ''}`}>
      <button className="btn small" onClick={() => setOpen(!open)}>
        🗺️ Kartlag og forklaring {open ? '▾' : '▸'}
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
          {MAIN.map(([k, label]) => row(k, label))}
          <details className="small morelayers">
            <summary>Flere kartlag ({MORE.filter(([k]) => layers[k]).length} av {MORE.length} på)</summary>
            {MORE.map(([k, label]) => row(k, label))}
          </details>
          <details className="small">
            <summary>Symbolkategorier ({allCategories(custom).length - hidden.length} synlige)</summary>
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
