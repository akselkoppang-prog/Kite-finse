import { Advanced, NextStep } from '../components/ux';
import { useStore } from '../state/store';
import { kiteInput } from '../state/sim';
import { useExpedition, updateDay } from '../state/expedition';
import { KITES } from '../data/kites';
import { KITE_SPECS } from '../data/kiteSpecs';
import { airDensity, physWindow } from '../lib/sim/physics';
import { DAY_COLORS } from '../lib/sim/expedition';
import { dirName } from '../lib/geo';
import KiteChips, { kiteFit, kiteShort } from '../components/plan/KiteChips';
import { Card } from '../components/ui';

const SCALE = 22; // m/s

/** Enkel side: hvilke kites tar jeg med, og hvilken passer hver dag? (én kite om gangen) */
export default function WeatherKitePage() {
  const s = useStore();
  const { plan, days } = useExpedition();
  const q = s.quivers.find((x) => x.id === s.activeQuiverId) ?? s.quivers[0];
  const p = { ...s.simParams, riderKg: s.riderKg, pulkKg: s.pulkKg, snow: s.snow };
  const rho = airDensity(p.tempC, 1150);
  const toggle = (id: string) => {
    const has = q.kiteIds.includes(id);
    s.set({ quivers: s.quivers.map((x) => (x.id === q.id ? { ...x, kiteIds: has ? x.kiteIds.filter((k) => k !== id) : [...x.kiteIds, id] } : x)) });
    s.log('kite', `${has ? 'Tar ikke med' : 'Tar med'} ${kiteShort(id)}`);
  };
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / SCALE) * 100))}%`;

  return (
    <div className="page">
      <Card title="Kites jeg tar med" className="wide">
        <p className="small">Du bruker <b>én kite om gangen</b>. Kitene er alternativer: blir det for mye vind, bytter du til en mindre; for lite vind, en større. Velg fritt – appen tvinger ingen kombinasjon.</p>
        <div className="kitepick2">
          {KITES.map((k) => {
            const on = q.kiteIds.includes(k.id);
            return (
              <button key={k.id} className={`kitecard ${on ? 'on' : ''}`} onClick={() => toggle(k.id)} aria-pressed={on}>
                <span className="kc-size">{k.size}<small>m²</small></span>
                <span className="kc-name">{k.name}</span>
                <span className="kc-type">{k.type}</span>
                <span className="kc-check">{on ? '✓ Med' : 'Ikke med'}</span>
              </button>
            );
          })}
        </div>
        <p className="small muted">Valgt: {q.kiteIds.map(kiteShort).join(', ') || 'ingen'} · last {s.riderKg} kg + pulk {s.pulkKg} kg (endres under Utstyr & planlegging)</p>
      </Card>

      <Card title="Vindområde per kite – og dagenes vind" className="wide">
        <div className="windscale">
          <div className="ws-axis">{[0, 4, 8, 12, 16, 20].map((v) => <span key={v} style={{ left: pct(v) }}>{v}</span>)}</div>
          {q.kiteIds.map((id) => {
            const k = kiteInput(id, s);
            const w = k.personal ?? physWindow(k, p, rho);
            return (
              <div key={id} className="ws-row">
                <span className="ws-name">{kiteShort(id)}</span>
                <div className="ws-track">
                  <div className="ws-range" style={{ left: pct(w.low), width: `calc(${pct(w.high)} - ${pct(w.low)})` }} title={`${w.low.toFixed(1)}–${w.high.toFixed(1)} m/s ${k.personal ? '(ditt eget vindu)' : '(beregnet for din last)'}`} />
                  {days.map((_d, i) => (
                    <span key={i} className="ws-day" style={{ left: pct(plan.days[i].wind.avg), background: DAY_COLORS[i % DAY_COLORS.length] }} title={`Dag ${i + 1}: ${plan.days[i].wind.avg} m/s`}>{i + 1}</span>
                  ))}
                </div>
                <span className="ws-val small">{w.low.toFixed(0)}–{w.high.toFixed(0)} m/s</span>
              </div>
            );
          })}
        </div>
        <p className="small muted">Grønn stripe = vind der kiten gir nok trekk uten å bli for kraftig, beregnet for din vekt og pulk (eller ditt eget vindu). Tallene i sirklene er snittvinden for hver dag. Produsentens vindområder (vann, ~75 kg uten pulk) står i kitedatabasen. Dette er råd – ikke sikkerhetsgrenser.</p>
      </Card>

      <Card title="Kite for hver dag" className="wide">
        <div className="daykites">
          {plan.days.map((d, i) => (
            <div key={d.id} className="daykite" style={{ borderLeftColor: DAY_COLORS[i % DAY_COLORS.length] }}>
              <div><b>Dag {i + 1}</b> · vind fra {dirName(d.wind.dir)} {d.wind.avg} m/s ({d.wind.min}–{d.wind.max}, kast {d.wind.gust}) <button className="link" onClick={() => s.setTab('plan')}>endre</button></div>
              <KiteChips value={d.kiteId} wind={d.wind} autoPick={days[i]?.kiteId} onPick={(id) => updateDay(i, { kiteId: id })} />
              <div className="small muted">
                {q.kiteIds.map((id) => `${kiteShort(id)}: ${kiteFit(id, d.wind, s).text}`).join(' · ')}
              </div>
              {days[i] && <div className="small">Valgt: <b>{kiteShort(days[i].kiteId)}</b>{days[i].kiteAuto ? ' (auto – best fremdrift)' : ''} → {days[i].progressKm.toFixed(0)} km denne dagen</div>}
            </div>
          ))}
        </div>
        <div className="legendmini small"><span><i style={{ background: '#22c55e' }} />passer</span><span><i style={{ background: '#eab308' }} />på grensen</span><span><i style={{ background: '#94a3b8' }} />for liten</span><span><i style={{ background: '#ef4444' }} />for stor</span></div>
      </Card>

      <Advanced className="wide" title="Dine egne vindgrenser" hint="overstyr vindområdet for en kite">
      <Card title="Dine egne vindgrenser" >
        <p className="small muted">Erfaring slår modellen. Legg inn hva du selv mener kiten tåler med pulk – det brukes i all planlegging.</p>
        {q.kiteIds.map((id) => {
          const o = s.kiteOverrides[id];
          return (
            <div key={id} className="row small">
              <b style={{ minWidth: 110 }}>{kiteShort(id)}</b>
              <label>fra <input type="number" step={0.5} style={{ width: 60 }} value={o?.low ?? ''} placeholder="auto" onChange={(e) => s.set({ kiteOverrides: { ...s.kiteOverrides, [id]: { low: +e.target.value, high: o?.high ?? 15 } } })} /></label>
              <label>til <input type="number" step={0.5} style={{ width: 60 }} value={o?.high ?? ''} placeholder="auto" onChange={(e) => s.set({ kiteOverrides: { ...s.kiteOverrides, [id]: { low: o?.low ?? 4, high: +e.target.value } } })} /></label>
              <span className="muted">m/s</span>
              {o && <button className="link" onClick={() => { const x = { ...s.kiteOverrides }; delete x[id]; s.set({ kiteOverrides: x }); }}>bruk modellen</button>}
              <span className="muted">{String(KITE_SPECS[id]?.windRangeKn?.v ?? '')}{KITE_SPECS[id]?.windRangeKn?.v ? ' kn (produsent, vann)' : ''}</span>
            </div>
          );
        })}
      </Card>
      </Advanced>
      <NextStep to="utstyr">Pakkelisten</NextStep>
    </div>
  );
}
