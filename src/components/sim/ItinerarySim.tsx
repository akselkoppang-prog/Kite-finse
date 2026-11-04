import { useMemo } from 'react';
import { useStore } from '../../state/store';
import { useSimSetup } from '../../state/sim';
import { cumulative, pointAt, uid } from '../../lib/geo';
import { addDays, fmtClock, hourOf, sunDay } from '../../lib/sun';
import { Card, Kind } from '../ui';
import { hm } from '../../pages/SimulatorPage';

/** Sammenlign flere dagsplaner (km per dag; siste dag = resten). Konsekvenser vises – planen endres ikke selv. */
export default function ItinerarySim() {
  const s = useStore();
  const setup = useSimSetup();
  const route = setup.route;
  const total = setup.total;
  const cum = useMemo(() => (route ? cumulative(route.waypoints) : []), [route]);
  const plans = s.itineraries;
  const results = useMemo(
    () =>
      plans.map((pl) => {
        let start = 0;
        const days = [...pl.dayKm, Math.max(0, total / 1000 - pl.dayKm.reduce((a, b) => a + b, 0))].map((km, i) => {
          const from = start;
          const to = Math.min(total, from + km * 1000);
          start = to;
          const r = setup.run({ fromD: from, toD: to, startDate: addDays(s.tripDate, i), startHour: s.sim.startHour, maxDays: 1 });
          const end = route ? pointAt(route.waypoints, cum, r?.reachedD ?? to) : { lat: 0, lon: 0 };
          const sun = sunDay(addDays(s.tripDate, i), end);
          const arr = r ? hourOf(new Date(r.end)) ?? 0 : 0;
          const left = (hourOf(sun.sunset) ?? 18) - arr;
          return { i, from, to, km, r, short: r ? to - r.reachedD : 0, arr, left };
        });
        return { pl, days };
      }),
    [plans, setup, total, s.tripDate, s.sim.startHour, route, cum],
  );
  const setPlan = (id: string, dayKm: number[]) => s.set({ itineraries: plans.map((p) => (p.id === id ? { ...p, dayKm } : p)) });
  return (
    <Card title="Reiseplan-simulator – sammenlign dagsplaner" className="wide" right={<Kind k="beregnet" />}>
      <p className="small muted">Hver plan simuleres dag for dag med vinden og kitene fra simulatoren. Siste dag tar resten. Røde tall viser konsekvensen hvis en dag blir for lang – planen endres ikke automatisk.</p>
      <div className="itins">
        {results.map(({ pl, days }) => {
          const fail = days.some((d) => d.short > 50);
          const minLeft = Math.min(...days.map((d) => d.left));
          return (
            <div key={pl.id} className="itin">
              <div className="row">
                <input value={pl.name} onChange={(e) => s.set({ itineraries: plans.map((p) => (p.id === pl.id ? { ...p, name: e.target.value } : p)) })} aria-label="Navn på plan" />
                <button className="link danger" onClick={() => s.set({ itineraries: plans.filter((p) => p.id !== pl.id) })}>slett</button>
              </div>
              {pl.dayKm.map((km, i) => (
                <label key={i} className="small">Dag {i + 1}: {km} km
                  <input type="range" min={5} max={100} value={km} onChange={(e) => setPlan(pl.id, pl.dayKm.map((x, j) => (j === i ? +e.target.value : x)))} />
                </label>
              ))}
              <div className="btns">
                <button className="btn small ghost" onClick={() => setPlan(pl.id, [...pl.dayKm, 30])}>+ dag</button>
                {pl.dayKm.length > 1 && <button className="btn small ghost" onClick={() => setPlan(pl.id, pl.dayKm.slice(0, -1))}>− dag</button>}
              </div>
              <table className="tbl small">
                <thead><tr><th>Dag</th><th>Km</th><th>Tid</th><th>Ankomst</th><th>Dagslys igjen</th></tr></thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.i}>
                      <td>{d.i + 1}</td>
                      <td>{d.km.toFixed(0)}{d.short > 50 && <div className="err">mangler {(d.short / 1000).toFixed(1)} km</div>}</td>
                      <td>{d.r ? hm((d.r.end - d.r.start) / 3600000) : '–'}</td>
                      <td>{d.r ? fmtClock(new Date(d.r.end)) : '–'}</td>
                      <td className={d.left < s.sunCfg.descentMarginH ? 'err' : ''}>{d.left.toFixed(1)} t</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="small">{fail ? <span className="err">Ikke gjennomførbar i denne vinden (en dag rekker ikke målet før mørket)</span> : minLeft < s.sunCfg.descentMarginH ? <span className="warn">Gjennomførbar, men liten dagslysmargin</span> : <span className="ok">Gjennomførbar i denne vinden (etter modellen)</span>}</div>
              <button className="btn small" onClick={() => {
                if (!route) return;
                let acc = 0;
                const br = pl.dayKm.map((k) => (acc += k * 1000)).filter((x) => x < total);
                s.set({ tripDays: br.length + 1 });
                s.setDayBreaks(route.id, br);
                s.log('rute', `Brukte reiseplan «${pl.name}» som dagsplan`);
              }}>Bruk som dagsplan</button>
            </div>
          );
        })}
      </div>
      <button className="btn small" onClick={() => s.set({ itineraries: [...plans, { id: uid('it'), name: `Plan ${plans.length + 1}`, dayKm: [40, 40] }] })}>+ Ny plan</button>
    </Card>
  );
}
