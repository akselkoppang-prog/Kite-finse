import { Advanced, Term } from '../components/ux';
import { useState } from 'react';
import { useStore } from '../state/store';
import { KITES, QUIVER_ADVICE, type Kite } from '../data/kites';
import { defaultWindow, evaluate, SNOW_MU, TERRAIN_ADD, type Goal, type Snow, type Terrain } from '../lib/analysis/kite';
import { DIRS8, DIR_DEG, angleDiff, uid } from '../lib/geo';
import { Card, Kind } from '../components/ui';
import type { Quiver } from '../types';
import KiteSpecs from '../components/KiteSpecs';

const STATUS_CLASS: Record<string, string> = { aktuell: 'GRØNN', grensetilfelle: 'GUL', 'for lite trekk': 'GRÅ', overpower: 'RØD' };

function windowOf(k: Kite, s: ReturnType<typeof useStore.getState>) {
  const o = s.kiteOverrides[k.id];
  return o ? { ...o, custom: true } : defaultWindow(k, s.riderKg + s.pulkKg, s.snow, s.terrainKind);
}

/** Dekning: hvilke vindstyrker (m/s, hele tall 2–22) har minst én kite i vinduet? */
function coverage(q: Quiver, s: ReturnType<typeof useStore.getState>) {
  const kites = KITES.filter((k) => q.kiteIds.includes(k.id));
  const winds = Array.from({ length: 21 }, (_, i) => i + 2);
  return winds.map((w) => ({ w, n: kites.filter((k) => { const win = windowOf(k, s); return w >= win.low && w <= win.high; }).length }));
}

export default function KitePage() {
  const s = useStore();
  const [onlySelected, setOnlySelected] = useState(true);
  const q = s.quivers.find((x) => x.id === s.activeQuiverId) ?? s.quivers[0];
  const setQ = (patch: Partial<Quiver>, text?: string) => {
    s.set({ quivers: s.quivers.map((x) => (x.id === q.id ? { ...x, ...patch } : x)) });
    if (text) s.log('kite', text);
  };
  const toggle = (id: string) => {
    const has = q.kiteIds.includes(id);
    const kiteIds = has ? q.kiteIds.filter((x) => x !== id) : [...q.kiteIds, id];
    setQ({ kiteIds, primary: q.primary === id && has ? undefined : q.primary, secondary: q.secondary === id && has ? undefined : q.secondary, storm: q.storm === id && has ? undefined : q.storm }, `${has ? 'Fjernet' : 'La til'} ${KITES.find((k) => k.id === id)?.name} i quiver «${q.name}»`);
  };
  const travel = 135; // hovedretning Finse→Rjukan ≈ SØ
  const courseAngle = angleDiff(travel, DIR_DEG[s.windFrom]);
  const pool = onlySelected ? KITES.filter((k) => q.kiteIds.includes(k.id)) : KITES;
  const verdicts = evaluate(pool, { wind: s.windSpeed, gust: s.windGust, courseAngle, snow: s.snow, pulkKg: s.pulkKg, riderKg: s.riderKg, terrain: s.terrainKind, goal: s.goal }, s.kiteOverrides);
  const selectedKites = KITES.filter((k) => q.kiteIds.includes(k.id));

  return (
    <div className="page">
      <Card title={<>Min <Term k="quiver" /> (du velger)</>} className="wide" right={<Kind k="sjekk-selv" />}>
        <div className="row">
          <label className="small">Konfigurasjon
            <select id="quiver-sel" value={q.id} onChange={(e) => s.set({ activeQuiverId: e.target.value })}>
              {s.quivers.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.kiteIds.length})</option>)}
            </select>
          </label>
          <input id="quiver-name" value={q.name} onChange={(e) => setQ({ name: e.target.value })} aria-label="Navn på quiver" />
          <button className="btn small" onClick={() => { const n = { ...q, id: uid('q'), name: `${q.name} (kopi)` }; s.set({ quivers: [...s.quivers, n], activeQuiverId: n.id }); }}>Dupliser</button>
          <button className="btn small" onClick={() => { const n: Quiver = { id: uid('q'), name: `Quiver ${s.quivers.length + 1}`, kiteIds: [] }; s.set({ quivers: [...s.quivers, n], activeQuiverId: n.id }); }}>Ny tom</button>
          <button className="btn small danger" disabled={s.quivers.length < 2} onClick={() => { const rest = s.quivers.filter((x) => x.id !== q.id); s.set({ quivers: rest, activeQuiverId: rest[0].id }); }}>Slett</button>
        </div>
        <div className="kitepick">
          {KITES.map((k) => {
            const on = q.kiteIds.includes(k.id);
            const w = windowOf(k, s);
            return (
              <div key={k.id} className={`kp ${on ? 'on' : ''}`}>
                <label className="chk"><input id={`kp-${k.id}`} type="checkbox" checked={on} onChange={() => toggle(k.id)} /> <b>{k.name} {k.size} m²</b></label>
                <div className="small muted">{k.type} · vindu {w.low}–{w.high} m/s {w.custom ? '(ditt)' : '(beregnet)'}</div>
                {on && (
                  <div className="seg">
                    {(['primary', 'secondary', 'storm'] as const).map((r) => (
                      <button key={r} className={`btn small ${q[r] === k.id ? 'on' : ''}`} onClick={() => setQ({ [r]: q[r] === k.id ? undefined : k.id }, `${k.name} satt som ${r === 'primary' ? 'primær' : r === 'secondary' ? 'sekundær' : 'sterkvind/nød'}`)}>
                        {r === 'primary' ? '★ Primær' : r === 'secondary' ? '② Sekundær' : '⚡ Sterk vind'}
                      </button>
                    ))}
                  </div>
                )}
                <textarea id={`kn-${k.id}`} rows={2} placeholder="Egne notater/erfaring (f.eks. «trekker 110 kg fra 6 m/s på hardpakke»)" value={s.kiteNotes[k.id] ?? ''} onChange={(e) => s.set({ kiteNotes: { ...s.kiteNotes, [k.id]: e.target.value } })} />
              </div>
            );
          })}
        </div>
        <label className="small">Notat for quiveren<input id="quiver-note" value={q.note ?? ''} onChange={(e) => setQ({ note: e.target.value })} /></label>
        <div className="btns">
          <button className="btn small ghost" onClick={() => setQ({ kiteIds: ['peak4', 'hyper7', 'sonic10', 'soul15'], primary: 'sonic10', secondary: 'soul15', storm: 'peak4' }, `Brukte forslaget i «${q.name}»`)}>Bruk verktøyets forslag i denne</button>
          <span className="small muted">Forslaget er bare et råd – ingen kite er utelukket.</span>
        </div>
      </Card>

      <KiteSpecs />

      <Advanced className="wide" title="Sammenlign quivers" hint="vinddekning for ulike kite-sett">
      <Card title="Sammenlign quivers – vinddekning" className="wide" right={<Kind k="beregnet" />}>
        <div className="tablewrap">
          <table className="tbl small cov">
            <thead>
              <tr><th>Quiver</th><th>Kites</th>{Array.from({ length: 21 }, (_, i) => <th key={i}>{i + 2}</th>)}</tr>
            </thead>
            <tbody>
              {s.quivers.map((x) => (
                <tr key={x.id} className={`clickable ${x.id === q.id ? 'sel' : ''}`} onClick={() => s.set({ activeQuiverId: x.id })}>
                  <td>{x.name}</td>
                  <td>{x.kiteIds.length}</td>
                  {coverage(x, s).map((c) => <td key={c.w} className={`cv cv${Math.min(3, c.n)}`} title={`${c.w} m/s: ${c.n} kite(r)`}>{c.n || ''}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">Kolonner = middelvind m/s. Tallet = antall kites i quiveren med beregnet (eller ditt eget) vindu som dekker vinden, for {s.riderKg + s.pulkKg} kg på «{SNOW_MU[s.snow].text}». Hull (tomme ruter) betyr ingen passende kite etter modellen.</p>
      </Card>
      </Advanced>

      <Card title="Forhold">
        <div className="form">
          <label>Middelvind {s.windSpeed} m/s<input id="k-wind" type="range" min={2} max={20} step={0.5} value={s.windSpeed} onChange={(e) => s.set({ windSpeed: +e.target.value, windGust: Math.max(+e.target.value, s.windGust) })} /></label>
          <label>Vindkast {s.windGust} m/s<input id="k-gust" type="range" min={2} max={28} step={0.5} value={s.windGust} onChange={(e) => s.set({ windGust: Math.max(+e.target.value, s.windSpeed) })} /></label>
          <label>Vindretning (fra)<select id="k-dir" value={s.windFrom} onChange={(e) => s.set({ windFrom: e.target.value as never })}>{DIRS8.map((d) => <option key={d}>{d}</option>)}</select></label>
          <label>Snøforhold<select id="k-snow" value={s.snow} onChange={(e) => s.set({ snow: e.target.value as Snow })}>{Object.entries(SNOW_MU).map(([k, v]) => <option key={k} value={k}>{v.text}</option>)}</select></label>
          <label>Terreng<select id="k-terr" value={s.terrainKind} onChange={(e) => s.set({ terrainKind: e.target.value as Terrain })}>{Object.entries(TERRAIN_ADD).map(([k, v]) => <option key={k} value={k}>{v.text}</option>)}</select></label>
          <label>Ønsket fremdrift<select id="k-goal" value={s.goal} onChange={(e) => s.set({ goal: e.target.value as Goal })}><option value="rolig">Rolig / kontroll</option><option value="effektiv">Effektiv distanse</option><option value="fart">Høy fart</option></select></label>
          <label>Pulk {s.pulkKg} kg<input id="k-pulk" type="range" min={10} max={70} value={s.pulkKg} onChange={(e) => s.set({ pulkKg: +e.target.value })} /></label>
          <label>Kroppsvekt + utstyr på kropp {s.riderKg} kg<input id="k-rider" type="range" min={55} max={100} value={s.riderKg} onChange={(e) => s.set({ riderKg: +e.target.value })} /></label>
        </div>
        <p className="small">Total last <b>{s.riderKg + s.pulkKg} kg</b>. Hovedretning ≈ SØ → vind fra {s.windFrom} gir kursvinkel <b>{Math.round(courseAngle)}°</b>.</p>
      </Card>

      <Card title="Hurtigråd (enkel modell – se Simulator for fysikkmodellen)" right={<label className="chk small"><input id="k-only" type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} /> Kun min quiver</label>} className="wide">
        {pool.length === 0 && <p className="small warn">Ingen kites valgt i quiveren.</p>}
        <div className="kites">
          {verdicts.map((v, i) => (
            <div key={v.kite.id} className={`kite k-${STATUS_CLASS[v.status]}`}>
              <div className="kite-head">
                <span className="rank">{i + 1}</span>
                <b>{v.kite.name} {v.kite.size} m²</b>
                <span className={`badge b-${STATUS_CLASS[v.status]}`}>{v.status}</span>
              </div>
              <div className="small">Vindu: <b>{v.window.low}–{v.window.high} m/s</b> {v.window.custom ? '(ditt eget)' : '(beregnet tommelfingerregel)'}</div>
              <ul className="small">{v.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              {s.kiteNotes[v.kite.id] && <div className="small">📝 {s.kiteNotes[v.kite.id]}</div>}
              <details className="small">
                <summary>Mitt vindu (overstyr modellen)</summary>
                <div className="row">
                  <label>Min <input type="number" step={0.5} defaultValue={v.window.low} id={`lo-${v.kite.id}`} /></label>
                  <label>Maks <input type="number" step={0.5} defaultValue={v.window.high} id={`hi-${v.kite.id}`} /></label>
                  <button className="btn small" onClick={() => {
                    const lo = +(document.getElementById(`lo-${v.kite.id}`) as HTMLInputElement).value;
                    const hi = +(document.getElementById(`hi-${v.kite.id}`) as HTMLInputElement).value;
                    s.set({ kiteOverrides: { ...s.kiteOverrides, [v.kite.id]: { low: lo, high: hi } } });
                    s.log('kite', `Eget vindu for ${v.kite.name}: ${lo}–${hi} m/s`);
                  }}>Lagre</button>
                  {v.window.custom && <button className="btn small ghost" onClick={() => { const o = { ...s.kiteOverrides }; delete o[v.kite.id]; s.set({ kiteOverrides: o }); }}>Tilbakestill</button>}
                </div>
              </details>
            </div>
          ))}
        </div>
        <p className="small warn">Rangeringen er rådgivende. Vinduene er en forenklet modell (trekk ∝ areal × vind², last ∝ vekt × friksjon), ikke produsentdata og ikke sikkerhetsgrenser.</p>
      </Card>

      <Advanced className="wide" title="Faglige vurderinger" hint="bakgrunn for anbefalingene">
      <Card title="Faglige vurderinger (sammendrag)" className="wide">
        <div className="tablewrap">
          <table className="tbl small">
            <thead>
              <tr><th>Kite</th><th>Størrelse</th><th>Produsentdata <Kind k="kartdata" /></th><th>Type <Kind k="sjekk-selv" /></th><th>Rolle</th><th>Vindegenskaper</th><th>Relansering</th><th>Upwind</th><th>Pakkvolum</th><th>Snø</th><th>Pulk 110 kg</th><th>Valgt</th></tr>
            </thead>
            <tbody>
              {KITES.map((k) => (
                <tr key={k.id} className={q.kiteIds.includes(k.id) ? 'sel' : ''}>
                  <td><b>{k.maker}</b> {k.name.replace(`${k.maker} `, '')}</td>
                  <td>{k.size} m²</td>
                  <td><a href={k.makerUrl} target="_blank" rel="noreferrer">se kitedatabasen over</a></td>
                  <td>{k.type}</td>
                  <td>{k.role}</td>
                  <td>{k.windChar}</td>
                  <td>{k.relaunch}</td>
                  <td>{Math.round(k.upwind * 100)} / 100</td>
                  <td>{k.packability}</td>
                  <td>{k.snowSuit}</td>
                  <td>{k.pulkSuit}</td>
                  <td>{q.kiteIds.includes(k.id) ? '✓' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">Kolonnene er <b>faglige vurderinger</b>. Dokumenterte spesifikasjoner med kilder står i kitedatabasen over. Ytelse per kite simuleres i «Ytelsessimulator».</p>
      </Card>
      </Advanced>

      <Advanced className="wide" title="Rådgivende quiver-forslag">
      <Card title="Rådgivende quiver-forslag" right={<Kind k="sjekk-selv" />}>
        <pre className="pre">{QUIVER_ADVICE}</pre>
        <p className="small">Valgt nå: {selectedKites.map((k) => `${k.size} m² ${k.name}`).join(', ') || 'ingen'}.</p>
      </Card>
      </Advanced>
    </div>
  );
}
