import { useState } from 'react';
import { hhmm, type DayOutcome, type DayPlan } from '../../lib/sim/expedition';

const t1 = (h: number) => `${h.toFixed(1).replace('.', ',')} t`;
const CONF = { høy: 'conf-hi', middels: 'conf-mid', lav: 'conf-lo' } as const;

/** Estimatet for dagen, forklart: tre utfall, sikkerhet, krysninger og hvor tiden går. */
export default function DayExplain({ out, day }: { out: DayOutcome; day: DayPlan }) {
  const [open, setOpen] = useState(false);
  if (out.reason.startsWith('allerede')) return null;
  const b = out.breakdown;
  const parts: [string, number, string][] = [
    ['Kiting', b.kiteH, '#38bdf8'],
    ['Kryss/stagvending', b.tackH, '#a78bfa'],
    ['Ski uten kite', b.skiH, '#facc15'],
    ['Gåing (bratt/nedstigning)', b.walkH, '#f97316'],
    ['Oppskyting, pauser, navigasjon', b.overheadH, '#64748b'],
    ['Venting på vind', b.windWaitH, '#94a3b8'],
    ['Krysninger', b.crossingH, '#ef4444'],
  ];
  const total = parts.reduce((a, p) => a + p[1], 0) || 1;
  return (
    <div className="dayexplain">
      <div className="est3">
        <div><span>Beste tilfelle</span><b>{hhmm(out.rangeArrival[0])}</b><small>{out.rangeKm[1].toFixed(0)} km</small></div>
        <div className="mid"><span>Realistisk</span><b>{hhmm(out.arrival)}</b><small>{((out.endD - out.startD) / 1000).toFixed(0)} km</small></div>
        <div><span>Forsiktig</span><b>{hhmm(out.rangeArrival[1])}</b><small>{out.rangeKm[0].toFixed(0)} km</small></div>
        <div><span>Sikkerhet</span><b className={CONF[out.confidence]}>{out.confidence}</b></div>
      </div>
      {out.crossings.map((c) => (
        <div key={c.name} className={`small ${c.blocked ? 'warn' : ''}`}>⛴ {c.name}: ankomst {hhmm(c.arriveH)}{c.blocked ? ` – ${c.blocked}` : `, venter ${Math.round(c.waitH * 60)} min + ${Math.round(c.transferH * 60)} min overgang, videre ${hhmm(c.departH)}`}{c.unverified ? ' (ikke bekreftet)' : ''}</div>
      ))}
      <button className="link small" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Skjul beregningen' : 'Hvordan er dette regnet ut?'}</button>
      {open && (
        <div className="explain small">
          <div className="tbar" title="Hvor tiden går">{parts.filter((p) => p[1] > 0.01).map(([l, h, c]) => <i key={l} style={{ width: `${(100 * h) / total}%`, background: c }} title={`${l}: ${t1(h)}`} />)}</div>
          <ul className="legendlist">{parts.filter((p) => p[1] > 0.01).map(([l, h, c]) => <li key={l}><i style={{ background: c }} />{l}: {t1(h)}</li>)}</ul>
          <ul>
            <li>Rute: {((out.endD - out.startD) / 1000).toFixed(1)} km langs ruten, faktisk seilt {out.sailedKm.toFixed(1)} km (kryss og omveier).</li>
            <li>Vind: {out.windSource}. Motvind/kryss {Math.round(out.upwindShare * 100)} %, for lite vind {Math.round(out.underShare * 100)} %, for mye {Math.round(out.overShare * 100)} %.</li>
            <li>Last: {out.loadKg.toFixed(0)} kg per pulk{out.fatigueFactor < 1 ? ` · tretthet dag ${out.day}: fart ×${out.fatigueFactor.toFixed(2)}` : ''}{out.weatherFactor < 1 ? ` · vær: fart ×${out.weatherFactor.toFixed(2)} (${out.weatherReasons.join(', ')})` : ''}.</li>
            <li>Din plan: avreise {hhmm(day.departure)}, inntil {day.activeH} t aktiv kiting, {day.breakH} t pauser, komfortfart {day.speedKmh} km/t. Dagen slutter senest ved borgerlig skumring ({hhmm(out.civilDusk)}).</li>
            <li>Utfallene: «beste» = 15 % mer vind og litt høyere fart, «forsiktig» = 20 % mindre vind og 10 % lavere fart.</li>
          </ul>
          {out.uncertainties.length > 0 && <><b>Største usikkerheter</b><ul>{out.uncertainties.map((u) => <li key={u}>{u}</li>)}</ul></>}
        </div>
      )}
    </div>
  );
}
