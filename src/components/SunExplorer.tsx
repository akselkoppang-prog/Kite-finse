import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { useActiveRoute, useDayPlan, useProfile } from '../state/derived';
import { cumulative, pointAt, type LatLon } from '../lib/geo';
import { addDays, fmtClock, hourOf, sunDay, tzLabel } from '../lib/sun';
import { cachedElevation } from '../lib/api/kartverket';
import { DaylightBar, DaylightLegend } from './Trip';
import { Card, Kind } from './ui';

/** Interaktiv sol-simulator: per dag, per sted langs ruten, og mars–april-sammenligning. */
export default function SunExplorer() {
  const s = useStore();
  const route = useActiveRoute();
  const plan = useDayPlan(route);
  const { profile } = useProfile(route);
  const [locKey, setLocKey] = useState('start');
  const cum = useMemo(() => (route ? cumulative(route.waypoints) : []), [route]);
  if (!route || !plan.days.length) return null;
  const zAt = (p: LatLon & { d?: number }) => cachedElevation(p)?.z ?? (p.d != null ? profile.reduce((b, x) => (Math.abs(x.d - p.d!) < Math.abs(b.d - p.d!) ? x : b), profile[0])?.z : null) ?? 1100;
  /** Høyde over omgivelsene for horisontdukking: på vidda ~0–50 m; vi bruker 30 m som nøktern standard. */
  const horizonH = 30;
  const campFor = (night: number) => {
    const c = s.camps.find((x) => x.night === night && x.role === 'foretrukket') ?? s.camps.find((x) => x.night === night);
    if (c) return { ...c, label: `${c.name} (natt ${night})` };
    const d = plan.breaks[night - 1];
    return d != null ? { ...pointAt(route.waypoints, cum, d), d, label: `Slutt dag ${night} (${(d / 1000).toFixed(0)} km)` } : null;
  };
  const end = route.waypoints[route.waypoints.length - 1];
  const locs: { key: string; label: string; p: LatLon & { d?: number }; date: string }[] = [
    { key: 'start', label: `Start: ${route.waypoints[0].name ?? 'Finse'}`, p: { ...route.waypoints[0], d: 0 }, date: s.tripDate },
    ...[1, 2].map((n) => { const c = campFor(n); return c ? { key: `c${n}`, label: c.label, p: c, date: addDays(s.tripDate, n - 1) } : null; }).filter(Boolean) as { key: string; label: string; p: LatLon; date: string }[],
    ...(plan.days[2] ? [{ key: 'd3', label: 'Dag 3 midt på etappen', p: { ...pointAt(route.waypoints, cum, (plan.days[2].d0 + plan.days[2].d1) / 2), d: (plan.days[2].d0 + plan.days[2].d1) / 2 }, date: plan.days[2].date }] : []),
    { key: 'end', label: `Mål: ${end.name ?? 'Rjukan'}`, p: { ...end, d: plan.total }, date: plan.days[plan.days.length - 1].date },
  ];
  const loc = locs.find((l) => l.key === locKey) ?? locs[0];
  const y = Number(s.tripDate.slice(0, 4));
  const compare = [['03-01', 'Tidlig mars'], ['03-15', 'Midt mars'], ['03-28', 'Sen mars'], ['04-01', 'Tidlig april'], ['04-15', 'Midt april'], ['04-28', 'Sen april']] as const;
  const last = plan.days[plan.days.length - 1];
  const lastSun = sunDay(last.date, end, horizonH);
  const descent = plan.descent;
  const descentH = descent ? (descent.toD - descent.fromD) / 1000 / s.travel.walkSteepKmh : 0;
  const latestStart = (hourOf(lastSun.sunset) ?? 18) - s.sunCfg.descentMarginH - descentH;
  const hh = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

  return (
    <Card title="Sol og dagslys – simulator" className="wide" right={<Kind k="beregnet" />}>
      <DaylightLegend />
      <h4>Hver ekspedisjonsdag (sted = midt på dagsetappen)</h4>
      {plan.days.map((d) => (
        <DaylightBar key={d.day} sun={sunDay(d.date, d.sun.at, horizonH)} startH={d.startH} endH={d.endH} label={`Dag ${d.day} · ${d.date} · ${(sunDay(d.date, d.sun.at, horizonH).daylightH).toFixed(1)} t dagslys · ${tzLabel(d.sun.noon)}`} />
      ))}

      <h4>Steder langs ruten (faktiske koordinater og høyde)</h4>
      <div className="tablewrap">
        <table className="tbl small">
          <thead><tr><th>Sted</th><th>Dato</th><th>Koordinater / høyde</th><th>Astro.</th><th>Nautisk</th><th>Borgerlig</th><th>Sol opp</th><th>Sol ned</th><th>Borgerlig</th><th>Nautisk</th><th>Dagslys</th></tr></thead>
          <tbody>
            {locs.map((l) => {
              const sd = sunDay(l.date, l.p, horizonH);
              return (
                <tr key={l.key} className={`clickable ${l.key === loc.key ? 'sel' : ''}`} onClick={() => setLocKey(l.key)}>
                  <td><b>{l.label}</b></td>
                  <td>{l.date}</td>
                  <td className="mono">{l.p.lat.toFixed(3)}, {l.p.lon.toFixed(3)} · {Math.round(zAt(l.p) ?? 0)} moh</td>
                  <td>{fmtClock(sd.astroDawn)}</td><td>{fmtClock(sd.nauticalDawn)}</td><td>{fmtClock(sd.civilDawn)}</td>
                  <td><b>{fmtClock(sd.sunrise)}</b></td><td><b>{fmtClock(sd.sunset)}</b></td>
                  <td>{fmtClock(sd.civilDusk)}</td><td>{fmtClock(sd.nauticalDusk)}</td>
                  <td>{sd.daylightH.toFixed(2)} t</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {locs.map((l) => <DaylightBar key={l.key} sun={sunDay(l.date, l.p, horizonH)} label={`${l.label} · ${l.date}`} />)}

      <h4>Mars → april for «{loc.label}» ({y})</h4>
      {compare.map(([md, lab]) => {
        const date = `${y}-${md}`;
        const sd = sunDay(date, loc.p, horizonH);
        return (
          <div key={md} className="row">
            <div style={{ flex: 1, minWidth: 0 }}><DaylightBar sun={sd} label={`${lab} (${date}) · ${sd.daylightH.toFixed(1)} t dagslys · borgerlig lys ${sd.civilH.toFixed(1)} t`} /></div>
            <button className="btn small ghost" onClick={() => s.set({ tripDate: date })}>Bruk</button>
          </div>
        );
      })}

      <h4>Sluttnedstigning – sikkerhetsmargin</h4>
      <div className="row small">
        <label>Margin før solnedgang (timer)<input id="sun-margin" type="number" step={0.25} min={0} max={4} value={s.sunCfg.descentMarginH} onChange={(e) => s.set({ sunCfg: { ...s.sunCfg, descentMarginH: +e.target.value } })} /></label>
        <span>Siste dag {last.date}: sol ned {fmtClock(lastSun.sunset)} ved målet. Nedstigning {descent ? `${((descent.toD - descent.fromD) / 1000).toFixed(1)} km / ${Math.round(descent.drop)} m ≈ ${descentH.toFixed(1)} t til fots` : 'ikke funnet i ruten'} → <b>start nedstigningen senest kl. {hh(latestStart)}</b>.</span>
      </div>
      <p className="small muted">Beregnet med SunCalc for faktisk dato og koordinat, tidssone Europe/Oslo (sommertid fra 28.03.{y}). Horisontdukking for 30 m over omgivelsene er tatt med. Terrengskygge er ikke modellert: i Rjukan når sola ikke dalbunnen på deler av vinteren selv om den astronomisk er oppe.</p>
    </Card>
  );
}
