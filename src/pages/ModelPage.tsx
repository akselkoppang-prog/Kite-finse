import { useStore } from '../state/store';
import { kiteInput } from '../state/sim';
import { KITES } from '../data/kites';
import { defaultModel, KITE_SPECS } from '../data/kiteSpecs';
import { DEFAULT_SIM, SIM_MU, airDensity, fHold, heightFactor, mass, physWindow, type SimParams } from '../lib/sim/physics';
import { calibrationFor } from '../lib/sim/calibration';
import { Card, Kind } from '../components/ui';
import Calibration from '../components/sim/Calibration';

const PARAMS: [keyof SimParams, string, number, string][] = [
  ['extraKg', 'Ekstra vekt på kroppen (kg)', 1, 'Sekk, klær, skredutstyr – legges til rytter + pulk'],
  ['holdFactor', 'Maks trekk i selen (× kroppsvekt)', 0.05, 'F_hold. Kraft over dette depowres bort. Bestemmer øvre vindgrense og fart når kiten er stor.'],
  ['gustTol', 'Kasttoleranse (× F_hold)', 0.05, 'Hvor mye mer enn F_hold du tåler kortvarig depowret'],
  ['muStartFactor', 'Oppstartsfriksjon (× glidefriksjon)', 0.1, 'Statisk friksjon + akselerasjon. Bestemmer nedre vindgrense.'],
  ['cdaRider', 'Luftmotstand rytter+pulk CdA (m²)', 0.05, ''],
  ['groundDragDeg', 'Bakkens dragvinkel λ (°)', 1, 'Skrens på kanten og pulk som drar sidelengs – begrenser hvor høyt du kan gå mot vinden'],
  ['kiteHeightM', 'Kitehøyde over bakken (m)', 1, 'For vindprofil (prognose gjelder 10 m)'],
  ['z0', 'Ruhet z0 (m)', 0.001, 'Snødekt vidde ~0,001–0,005'],
  ['comfortKmh', 'Komfortfart med pulk (km/t)', 1, 'Maks fart du VIL holde – den viktigste begrensningen i god vind'],
  ['terrainFactor', 'Terrengfaktor på komfortfart', 0.05, '1 = slett, 0,85 kupert, 0,65 ru/skavler'],
  ['defensiveFactor', 'Fremdrift ved kast over grensen', 0.05, ''],
  ['tackSec', 'Tidstap per stagvending/jibb (s)', 1, ''],
  ['corridorM', 'Bredde på kryss-korridor (m)', 50, 'Hvor langt ut du går på hvert slag – færre slag ved bredere korridor'],
  ['kiteChangeMin', 'Kitebytte (min)', 1, 'Landing, pakking, oppskyting'],
  ['skiKmh', 'Ski med pulk uten kite (km/t)', 0.1, ''],
  ['walkSteepKmh', 'Bratt / nedstigning med pulk (km/t)', 0.1, ''],
  ['stormWalkFactor', 'Fart i for mye vind (× ski)', 0.05, ''],
  ['variability', 'Vindvariasjon innen timen (CV)', 0.05, 'Fem kvantiler (10–90 %) simuleres per etappe'],
  ['tempC', 'Standard temperatur (°C)', 1, 'Brukes når prognose mangler'],
];

export default function ModelPage() {
  const s = useStore();
  const p = { ...s.simParams, riderKg: s.riderKg, pulkKg: s.pulkKg, snow: s.snow };
  const rho = airDensity(p.tempC, 1150);
  return (
    <div className="page">
      <Card title="Modellantakelser og ligninger" className="wide">
        <p className="small">Simulatoren er en <b>forenklet, fysisk begrunnet kraftbalanse</b> – ikke en strømningsmodell. Alle tall under er antakelser du kan endre. Ingen av kitene har publiserte polardiagrammer eller målte ytelsesdata, så resultatene er estimater med usikkerhet, ikke målte verdier.</p>
        <pre className="pre">{`ρ = p/(R·T),  p = 101325·(1 − 2,25577·10⁻⁵·h)^5,25588           luft (h = høyde, T = temp)
W_kite = W_10 · ln(z_kite/z0) / ln(10/z0)                          vind i kitehøyde
W_a = |W − V| ,  AWA = vinkel mellom kurs og tilsynelatende vind   tilsynelatende vind ved fart V
F = min(½·ρ·A·c_F·W_a²,  F_hold)                                  kitekraft (resten depowres)
ε = atan(1/G) + λ                                                  minste vinkel mot tilsynelatende vind
Fremdrift = F             hvis AWA ≥ 90° + ε
          = F·sin(AWA−ε)  ellers                                   (0 → kan ikke gå høyere)
R = m·g·(μ + stigning) + ½·ρ·CdA·V²                                motstand
V = største fart ≤ V_komfort der fremdrift ≥ R                     fart over bakken
VMG = max_θ V(θ)·cos(avvik)                                        fremdrift langs ruten (kryss/jibb)
stagvendinger ≈ L·tan(avvik)/korridor,  seilt = L/cos(avvik)
Oppstart:  ½·ρ·A·c_F·boost·W² ≥ m·g·μ·k_start                      ellers «for lite vind»
Overpower: ½·ρ·A·c_F·(1−depower)·W² > F_hold·kasttoleranse         middel → kiten ned, kast → defensiv kjøring`}</pre>
        <div className="kv small">
          <span>Masse nå</span><b>{mass(p)} kg (rytter {p.riderKg} + pulk {p.pulkKg} + ekstra {p.extraKg})</b>
          <span>F_hold</span><b>{fHold(p).toFixed(0)} N</b>
          <span>Luft ved {p.tempC} °C, 1150 moh</span><b>ρ = {rho.toFixed(3)} kg/m³</b>
          <span>Vindfaktor 10 m → {p.kiteHeightM} m</span><b>× {heightFactor(p).toFixed(3)}</b>
          <span>Friksjon «{p.snow}»</span><b>μ = {SIM_MU[p.snow]} (antakelse)</b>
        </div>
      </Card>

      <Card title="Parametre" className="wide" right={<button className="btn small ghost" onClick={() => s.set({ simParams: DEFAULT_SIM })}>Tilbakestill</button>}>
        <div className="form">
          {PARAMS.map(([k, label, step, help]) => (
            <label key={k} title={help}>{label}<input id={`mp-${k}`} type="number" step={step} value={s.simParams[k] as number} onChange={(e) => s.set({ simParams: { ...s.simParams, [k]: +e.target.value } })} />{help && <span className="muted">{help}</span>}</label>
          ))}
          <label className="chk"><input id="mp-cal" type="checkbox" checked={s.simParams.usePersonalCalibration} onChange={(e) => s.set({ simParams: { ...s.simParams, usePersonalCalibration: e.target.checked } })} /> Bruk personlig kalibrering fra GPS-spor</label>
        </div>
      </Card>

      <Card title="Kiteparametre i modellen" className="wide">
        <div className="tablewrap">
          <table className="tbl small">
            <thead><tr><th>Kite</th><th>Areal (m²)</th><th>c_F <Kind k="sjekk-selv" /></th><th>Glidetall G</th><th>Depower</th><th>Boost lettvind</th><th>Kalibrering</th><th>Fysikkvindu</th><th /></tr></thead>
            <tbody>
              {KITES.map((k) => {
                const d = defaultModel(k.id, k.type);
                const e = s.kiteModelEdits[k.id] ?? {};
                const ki = kiteInput(k.id, s);
                const w = physWindow(ki, p, rho);
                const cal = calibrationFor(k.id, s.calibTracks);
                const ed = (f: 'area' | 'cF' | 'glide' | 'depower' | 'dynBoost', step: number, def: number) => (
                  <input type="number" step={step} style={{ width: 70 }} value={e[f] ?? def} onChange={(ev) => s.set({ kiteModelEdits: { ...s.kiteModelEdits, [k.id]: { ...e, [f]: +ev.target.value } } })} />
                );
                return (
                  <tr key={k.id}>
                    <td><b>{k.name} {k.size}</b></td>
                    <td>{ed('area', 0.5, k.size)}</td>
                    <td>{ed('cF', 0.05, d.cF)}<div className="muted">antakelse</div></td>
                    <td>{ed('glide', 0.1, d.glide)}<div className="muted">{d.glideKind === 'beregnet' ? `beregnet fra AR ${KITE_SPECS[k.id]?.aspectRatio?.v}` : 'antakelse (AR ukjent)'}</div></td>
                    <td>{ed('depower', 0.05, d.depower)}<div className="muted">antakelse</div></td>
                    <td>{ed('dynBoost', 0.1, d.dynBoost)}</td>
                    <td>{cal ? `× ${cal.factor.toFixed(2)} (${cal.n} spor)` : '–'}</td>
                    <td>{w.low.toFixed(1)}–{w.high.toFixed(1)} m/s</td>
                    <td><button className="link" onClick={() => { const x = { ...s.kiteModelEdits }; delete x[k.id]; s.set({ kiteModelEdits: x }); }}>standard</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted">G er utledet av aspect ratio der produsent/forhandler oppgir den (G ≈ 1,6 + 0,5·AR for foil, 1,4 + 0,5·AR for tube, inkl. liner). c_F, depower og boost er antakelser per kitetype. Areal = nominell (flat) størrelse; Flysurfer oppgir også projisert areal (se Kite-quiver).</p>
      </Card>

      <Card title="Datakategorier" >
        <ol className="small">
          <li><b>Målt</b> – dine GPS-spor (kalibrering)</li>
          <li><b>Hentet fra kilde</b> – produsent/forhandler (kitedata), Kartverket/NVE/MET (kart, høyde, vann, vær)</li>
          <li><b>Beregnet med fysisk modell</b> – fart, VMG, tid, vindgrenser, sol</li>
          <li><b>Estimert fra antakelser</b> – c_F, depower, friksjon, komfortfart</li>
          <li><b>Manuelt lagt inn</b> – dine vindgrenser, parametre, notater</li>
        </ol>
        <p className="small muted">Et tall som «22,4 km/t» er alltid et modellestimat – se usikkerhetsberegningen i simulatoren.</p>
      </Card>

      <Calibration />
    </div>
  );
}
