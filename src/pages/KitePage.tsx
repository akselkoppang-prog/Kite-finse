import { useStore } from '../state/store';
import { KITES, QUIVER_ADVICE } from '../data/kites';
import { evaluate, SNOW_MU, TERRAIN_ADD, type Goal, type Snow, type Terrain } from '../lib/analysis/kite';
import { DIRS8, DIR_DEG, angleDiff } from '../lib/geo';
import { Card, Kind } from '../components/ui';

const STATUS_CLASS: Record<string, string> = { aktuell: 'GRØNN', grensetilfelle: 'GUL', 'for lite trekk': 'GRÅ', overpower: 'RØD', frarådet: 'RØD' };

export default function KitePage() {
  const s = useStore();
  const travel = 135; // hovedretning Finse→Rjukan er omtrent SØ
  const courseAngle = angleDiff(travel, DIR_DEG[s.windFrom]);
  const verdicts = evaluate(KITES, { wind: s.windSpeed, gust: s.windGust, courseAngle, snow: s.snow, pulkKg: s.pulkKg, riderKg: s.riderKg, terrain: s.terrainKind, goal: s.goal }, s.kiteOverrides);

  return (
    <div className="page">
      <Card title="Forhold">
        <div className="form">
          <label>Middelvind {s.windSpeed} m/s<input type="range" min={2} max={20} step={0.5} value={s.windSpeed} onChange={(e) => s.set({ windSpeed: +e.target.value, windGust: Math.max(+e.target.value, s.windGust) })} /></label>
          <label>Vindkast {s.windGust} m/s<input type="range" min={2} max={28} step={0.5} value={s.windGust} onChange={(e) => s.set({ windGust: Math.max(+e.target.value, s.windSpeed) })} /></label>
          <label>
            Vindretning (fra)
            <select value={s.windFrom} onChange={(e) => s.set({ windFrom: e.target.value as never })}>
              {DIRS8.map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
          <label>
            Snøforhold
            <select value={s.snow} onChange={(e) => s.set({ snow: e.target.value as Snow })}>
              {Object.entries(SNOW_MU).map(([k, v]) => <option key={k} value={k}>{v.text}</option>)}
            </select>
          </label>
          <label>
            Terreng
            <select value={s.terrainKind} onChange={(e) => s.set({ terrainKind: e.target.value as Terrain })}>
              {Object.entries(TERRAIN_ADD).map(([k, v]) => <option key={k} value={k}>{v.text}</option>)}
            </select>
          </label>
          <label>
            Ønsket fremdrift
            <select value={s.goal} onChange={(e) => s.set({ goal: e.target.value as Goal })}>
              <option value="rolig">Rolig / kontroll</option>
              <option value="effektiv">Effektiv distanse</option>
              <option value="fart">Høy fart</option>
            </select>
          </label>
          <label>Pulk {s.pulkKg} kg<input type="range" min={10} max={70} value={s.pulkKg} onChange={(e) => s.set({ pulkKg: +e.target.value })} /></label>
          <label>Kroppsvekt + utstyr på kropp {s.riderKg} kg<input type="range" min={55} max={100} value={s.riderKg} onChange={(e) => s.set({ riderKg: +e.target.value })} /></label>
        </div>
        <p className="small">
          Total last: <b>{s.riderKg + s.pulkKg} kg</b>. Hovedretning Finse→Rjukan ≈ SØ (135°) → vind fra {s.windFrom} gir kursvinkel <b>{Math.round(courseAngle)}°</b> mot vinden
          {courseAngle < 45 ? ' (motvind)' : courseAngle < 70 ? ' (kryss)' : courseAngle > 165 ? ' (rett medvind)' : ' (slør)'}.
        </p>
      </Card>

      <Card title="Vurdering" right={<Kind k="beregnet" />} className="wide">
        <div className="kites">
          {verdicts.map((v, i) => (
            <div key={v.kite.id} className={`kite k-${STATUS_CLASS[v.status]}`}>
              <div className="kite-head">
                <span className="rank">{i + 1}</span>
                <b>{v.kite.name} {v.kite.size} m²</b>
                <span className={`badge b-${STATUS_CLASS[v.status]}`}>{v.status}</span>
              </div>
              <div className="small muted">{v.kite.type} · <Kind k="sjekk-selv" /> type/egenskaper fra faglig vurdering</div>
              <div className="small">
                Vindu: <b>{v.window.low}–{v.window.high} m/s</b> {v.window.custom ? '(ditt eget)' : '(beregnet tommelfingerregel)'}
              </div>
              <ul className="small">
                {v.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
              <div className="small"><i>{v.kite.role}</i></div>
              <details className="small">
                <summary>Juster vindu / produsentdata</summary>
                <p>{v.kite.assessment}</p>
                <div className="row">
                  <label>Min <input type="number" step={0.5} defaultValue={v.window.low} id={`lo-${v.kite.id}`} /></label>
                  <label>Maks <input type="number" step={0.5} defaultValue={v.window.high} id={`hi-${v.kite.id}`} /></label>
                  <button className="btn small" onClick={() => {
                    const lo = +(document.getElementById(`lo-${v.kite.id}`) as HTMLInputElement).value;
                    const hi = +(document.getElementById(`hi-${v.kite.id}`) as HTMLInputElement).value;
                    s.set({ kiteOverrides: { ...s.kiteOverrides, [v.kite.id]: { low: lo, high: hi } } });
                  }}>Lagre</button>
                  {v.window.custom && <button className="btn small ghost" onClick={() => { const o = { ...s.kiteOverrides }; delete o[v.kite.id]; s.set({ kiteOverrides: o }); }}>Tilbakestill</button>}
                </div>
                <a href={v.kite.makerUrl} target="_blank" rel="noreferrer">Produsentside ({v.kite.maker})</a>
              </details>
            </div>
          ))}
        </div>
        <p className="small warn">
          Vinduene er beregnet fra en forenklet modell (trekk ∝ areal × vind², last ∝ vekt × friksjon) kalibrert til en tommelfingerregel på 5,5–12 m/s for 10 m² foil med 110 kg. De er IKKE sikkerhetsgrenser og ikke produsentdata. Juster med egne erfaringstall – du kjenner kitene dine etter 8 år bedre enn modellen.
        </p>
      </Card>

      <Card title="Quiver-anbefaling" right={<Kind k="sjekk-selv" />}>
        <pre className="pre">{QUIVER_ADVICE}</pre>
        <p className="small muted">Produsentdata (vindområde, vekt, pakkvolum) kunne ikke hentes fra utviklingsmiljøet. Legg dem inn under «Juster vindu» – de lagres lokalt.</p>
      </Card>
    </div>
  );
}
