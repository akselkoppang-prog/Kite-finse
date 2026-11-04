import { useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { kiteInput } from '../../state/sim';
import { KITES } from '../../data/kites';
import { analyseTrack, calibrationFor, downsample, parseTimedGpx, type TrackMeta } from '../../lib/sim/calibration';
import { uid } from '../../lib/geo';
import { Card, Kind } from '../ui';
import type { Snow } from '../../lib/analysis/kite';

/** Kalibrering av ytelsesmodellen mot dine egne snøkite-spor (GPX med tidsstempler). */
export default function Calibration() {
  const s = useStore();
  const file = useRef<HTMLInputElement>(null);
  const [meta, setMeta] = useState<TrackMeta>({ name: '', date: new Date().toISOString().slice(0, 10), kiteId: 'sonic10', kiteSize: 10, windSpeed: 8, windDir: 225, riderKg: s.riderKg, pulkKg: s.pulkKg, snow: s.snow, comment: '' });
  const [msg, setMsg] = useState('');
  const add = async (f: File) => {
    try {
      const pts = parseTimedGpx(await f.text());
      if (pts.length < 20) throw new Error('Sporet mangler tidsstempler (<time>) eller har for få punkter');
      const m = { ...meta, name: meta.name || f.name, kiteSize: KITES.find((k) => k.id === meta.kiteId)?.size ?? meta.kiteSize };
      const params = { ...s.simParams, riderKg: m.riderKg, pulkKg: m.pulkKg, snow: m.snow };
      const stats = analyseTrack(pts, m, { ...kiteInput(m.kiteId, s), calib: 1 }, params);
      s.set({ calibTracks: [...s.calibTracks, { id: uid('trk'), meta: m, stats, points: downsample(pts), addedAt: new Date().toISOString() }] });
      s.log('kite', `La til kalibreringsspor ${m.name} (${stats.distanceKm.toFixed(1)} km)`);
      setMsg(`La til ${m.name}: ${stats.distanceKm.toFixed(1)} km, snitt i bevegelse ${stats.avgMovingKmh.toFixed(1)} km/t${stats.modelRatio ? `, målt/modell ${stats.modelRatio.toFixed(2)}` : ''}`);
    } catch (e) {
      setMsg(`Feil: ${(e as Error).message}`);
    }
  };
  return (
    <Card title="Kalibrering mot egne GPS-spor" className="wide" right={<Kind k="kartdata" />}>
      <p className="small">Importer tidligere snøkite-turer (GPX med tid). Appen regner bevegelsestid, stillstand, snittfart, 90-persentil og – hvis du oppgir vindretning – fart og VMG per kurs. Med vindstyrke sammenlignes målt bakkefart med modellen for samme forhold, og medianforholdet blir din personlige faktor per kite. GPS-fart sier ikke noe direkte om kitefart eller aerodynamikk. Produsentdata endres ikke.</p>
      <div className="form">
        <label>Navn<input id="cal-name" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} placeholder="f.eks. Hardangervidda 2025" /></label>
        <label>Dato<input id="cal-date" type="date" value={meta.date} onChange={(e) => setMeta({ ...meta, date: e.target.value })} /></label>
        <label>Kite<select id="cal-kite" value={meta.kiteId} onChange={(e) => setMeta({ ...meta, kiteId: e.target.value })}>{KITES.map((k) => <option key={k.id} value={k.id}>{k.name} {k.size}</option>)}</select></label>
        <label>Vind (m/s, anslag)<input id="cal-wind" type="number" step={0.5} value={meta.windSpeed ?? ''} onChange={(e) => setMeta({ ...meta, windSpeed: e.target.value === '' ? undefined : +e.target.value })} /></label>
        <label>Vind fra (°)<input id="cal-dir" type="number" value={meta.windDir ?? ''} onChange={(e) => setMeta({ ...meta, windDir: e.target.value === '' ? undefined : +e.target.value })} /></label>
        <label>Rytter kg<input id="cal-rider" type="number" value={meta.riderKg} onChange={(e) => setMeta({ ...meta, riderKg: +e.target.value })} /></label>
        <label>Pulk kg<input id="cal-pulk" type="number" value={meta.pulkKg} onChange={(e) => setMeta({ ...meta, pulkKg: +e.target.value })} /></label>
        <label>Snø<select id="cal-snow" value={meta.snow} onChange={(e) => setMeta({ ...meta, snow: e.target.value as Snow })}><option value="skare">Skare</option><option value="pakket">Pakket</option><option value="løs">Løs</option><option value="dyp">Dyp</option></select></label>
        <label>Kommentar<input id="cal-comment" value={meta.comment} onChange={(e) => setMeta({ ...meta, comment: e.target.value })} /></label>
      </div>
      <button className="btn" onClick={() => file.current?.click()}>Importer GPX-spor…</button>
      <input ref={file} type="file" accept=".gpx" hidden onChange={(e) => e.target.files?.[0] && add(e.target.files[0])} />
      {msg && <p className="small msg">{msg}</p>}
      {s.calibTracks.length > 0 && (
        <div className="tablewrap">
          <table className="tbl small">
            <thead><tr><th>Spor</th><th>Kite</th><th>Vind</th><th>Distanse</th><th>Bevegelse / stille</th><th>Snitt / P90</th><th>Netto fremdrift</th><th>Per kurs (fart / VMG)</th><th>Målt/modell</th><th /></tr></thead>
            <tbody>
              {s.calibTracks.map((t) => (
                <tr key={t.id}>
                  <td><b>{t.meta.name}</b><div className="muted">{t.meta.date} · {t.meta.comment}</div></td>
                  <td>{KITES.find((k) => k.id === t.meta.kiteId)?.name} {t.meta.kiteSize}</td>
                  <td>{t.meta.windSpeed ?? '–'} m/s fra {t.meta.windDir ?? '–'}°</td>
                  <td>{t.stats.distanceKm.toFixed(1)} km</td>
                  <td>{t.stats.movingH.toFixed(1)} t / {t.stats.stationaryH.toFixed(1)} t</td>
                  <td>{t.stats.avgMovingKmh.toFixed(1)} / {t.stats.p90Kmh.toFixed(1)} km/t</td>
                  <td>{t.stats.netProgressKmh.toFixed(1)} km/t</td>
                  <td>{t.stats.bins?.filter((b) => b.n).map((b) => <div key={b.label}>{b.label}: {b.kmh.toFixed(1)} / {b.vmgKmh.toFixed(1)} (n={b.n})</div>) ?? '– (oppgi vindretning)'}</td>
                  <td>{t.stats.modelRatio ? `${t.stats.modelRatio.toFixed(2)} (n=${t.stats.modelN})` : '–'}</td>
                  <td><button className="link danger" onClick={() => s.set({ calibTracks: s.calibTracks.filter((x) => x.id !== t.id) })}>slett</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small">Personlige faktorer: {KITES.map((k) => { const c = calibrationFor(k.id, s.calibTracks); return c ? `${k.name} ${k.size}: × ${c.factor.toFixed(2)} (${c.n})` : null; }).filter(Boolean).join(' · ') || 'ingen ennå'} · {s.simParams.usePersonalCalibration ? <b className="ok">brukes i simulatoren</b> : <span className="muted">slå på i parametrene over for å bruke</span>}</p>
      <p className="small muted">Pålitelighet: vindstyrke og -retning er ofte anslag – faktoren er bare så god som vinddataene. Bruk flere spor med ulike kurser.</p>
    </Card>
  );
}
