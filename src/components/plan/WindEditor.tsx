import { useState } from 'react';
import type { DayPlan } from '../../lib/sim/expedition';
import { DIRS8, DIR_DEG, dirName } from '../../lib/geo';

const POS: Record<string, [number, number]> = { N: [50, 8], NØ: [80, 20], Ø: [92, 50], SØ: [80, 80], S: [50, 92], SV: [20, 80], V: [8, 50], NV: [20, 20] };

/** Vindvelger: kompass + glidere. «Vind fra» – pilen viser hvor vinden blåser. */
export default function WindEditor({ day, onChange, forecastAvailable }: { day: DayPlan; onChange: (p: Partial<DayPlan>) => void; forecastAvailable: boolean }) {
  const w = day.wind;
  const setW = (p: Partial<DayPlan['wind']>) => onChange({ wind: { ...w, ...p } });
  const [adv, setAdv] = useState(false);
  return (
    <div className="windeditor">
      <div className="seg modes">
        {(['manuell', 'prognose', 'blandet'] as const).map((m) => (
          <button key={m} className={`btn small ${day.windMode === m ? 'on' : ''}`} onClick={() => onChange({ windMode: m })} disabled={m !== 'manuell' && !forecastAvailable} title={m !== 'manuell' && !forecastAvailable ? 'Ingen MET-prognose for denne datoen ennå (bare ~9 døgn frem)' : ''}>
            {m === 'manuell' ? 'Mitt scenario' : m === 'prognose' ? 'Værmelding' : 'Værmelding + justering'}
          </button>
        ))}
      </div>
      {!forecastAvailable && <div className="small muted">Datoen er for langt frem for en ekte værmelding – du lager ditt eget scenario. Ingenting her er en prognose.</div>}
      {day.windMode === 'blandet' && (
        <div className="row small">
          <label>Vindstyrke ×{day.mix.speedFactor.toFixed(2)}<input type="range" min={0.3} max={2} step={0.05} value={day.mix.speedFactor} onChange={(e) => onChange({ mix: { ...day.mix, speedFactor: +e.target.value } })} /></label>
          <label>Drei vinden {day.mix.dirOffset > 0 ? '+' : ''}{day.mix.dirOffset}°<input type="range" min={-180} max={180} step={15} value={day.mix.dirOffset} onChange={(e) => onChange({ mix: { ...day.mix, dirOffset: +e.target.value } })} /></label>
        </div>
      )}
      {day.windMode !== 'prognose' || !forecastAvailable ? (
        <div className="windgrid">
          <div className="compass" role="group" aria-label="Vindretning (vind fra)">
            <div className="compass-arrow" style={{ transform: `rotate(${(w.dir + 180) % 360}deg)` }}>➜</div>
            {DIRS8.map((d) => (
              <button key={d} className={`cbtn ${dirName(w.dir) === d && w.dir === DIR_DEG[d] ? 'on' : ''}`} style={{ left: `${POS[d][0]}%`, top: `${POS[d][1]}%` }} onClick={() => setW({ dir: DIR_DEG[d] })} aria-label={`Vind fra ${d}`}>{d}</button>
            ))}
            <div className="compass-c">{w.avg} m/s<small>fra {w.dir}°</small></div>
          </div>
          <div className="windsliders">
            <label>Snittvind <b>{w.avg} m/s</b><input type="range" min={0} max={20} step={0.5} value={w.avg} onChange={(e) => { const v = +e.target.value; setW({ avg: v, min: Math.min(w.min, v), max: Math.max(w.max, v), gust: Math.max(w.gust, v) }); }} /></label>
            <label>Minimum – maksimum <b>{w.min}–{w.max} m/s</b>
              <span className="dual">
                <input type="range" min={0} max={20} step={0.5} value={w.min} onChange={(e) => setW({ min: Math.min(+e.target.value, w.avg) })} aria-label="Minimum" />
                <input type="range" min={0} max={25} step={0.5} value={w.max} onChange={(e) => setW({ max: Math.max(+e.target.value, w.avg) })} aria-label="Maksimum" />
              </span>
            </label>
            <label>Vindkast <b>{w.gust} m/s</b><input type="range" min={0} max={30} step={0.5} value={w.gust} onChange={(e) => setW({ gust: Math.max(+e.target.value, w.avg) })} /></label>
            <button className="link small" onClick={() => setAdv(!adv)}>{adv ? 'Færre valg' : 'Flere valg (retning i grader, variasjon, varighet)'}</button>
            {adv && (
              <>
                <label>Retning (vind fra) <b>{w.dir}°</b><input type="range" min={0} max={355} step={5} value={w.dir} onChange={(e) => setW({ dir: +e.target.value })} /></label>
                <label>Variasjon <b>{Math.round(w.variability * 100)} %</b><input type="range" min={0} max={0.6} step={0.05} value={w.variability} onChange={(e) => setW({ variability: +e.target.value })} /></label>
                <label>God vind varer <b>{w.favorableH >= 12 ? 'hele dagen' : `${w.favorableH} t`}</b> (så faller den til minimum)<input type="range" min={1} max={12} step={0.5} value={w.favorableH} onChange={(e) => setW({ favorableH: +e.target.value })} /></label>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="small">Bruker MET-prognosen time for time langs ruten.</div>
      )}
    </div>
  );
}
