import { useMemo, useState } from 'react';
import { useStore, routeHash } from '../state/store';
import { useExpedition, updatePlan } from '../state/expedition';
import { PROVIDERS, providerById, windyEmbed, windyLink, latestObservations } from '../lib/weather/providers';
import { dayWeather, type DayWx } from '../lib/weather/analysis';
import { refreshWeather, findBestDepartures, type DepartureOption } from '../lib/weather/actions';
import { runPlan, summarize, forecastFor } from '../lib/plan/context';
import { hhmm, DAY_COLORS } from '../lib/sim/expedition';
import { addDays } from '../lib/sun';
import { cumulative, dirName, pointAt } from '../lib/geo';
import type { Observation } from '../lib/weather/types';
import { Card } from '../components/ui';

const fmtT = (iso?: string) => (iso ? new Date(iso).toLocaleString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');
const n0 = (v: number | null | undefined, u = '') => (v == null || !Number.isFinite(v) ? '–' : `${Math.round(v)}${u}`);
const n1 = (v: number | null | undefined, u = '') => (v == null || !Number.isFinite(v) ? '–' : `${v.toFixed(1).replace('.', ',')}${u}`);
const lvlClass = { viktig: 'lv-viktig', advarsel: 'lv-advarsel', info: 'lv-info' } as const;

function DayWeatherCard({ w, i, date, open }: { w: DayWx; i: number; date: string; open: boolean }) {
  const [show, setShow] = useState(open);
  return (
    <article className="wxday" style={{ borderLeftColor: DAY_COLORS[i % DAY_COLORS.length] }}>
      <header className="wx-head">
        <b>Dag {i + 1}</b> <span className="muted small">{new Date(`${date}T12:00:00`).toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'short' })}</span>
        <span className="wx-badges">{w.hazards.map((h, k) => <span key={k} className={`lv ${lvlClass[h.level]}`}>{h.text}</span>)}{w.covered && !w.hazards.length && <span className="lv lv-info">Ingen farlige forhold i prognosen</span>}</span>
      </header>
      {!w.covered ? (
        <p className="small muted">Utenfor prognosen for denne leverandøren – dagen beregnes med ditt eget vindscenario.</p>
      ) : (
        <>
          <div className="wx-sum">
            <div><span>Snittvind</span><b>{n1(w.avgWind, ' m/s')}</b></div>
            <div><span>Maks kast</span><b className={w.maxGust != null && w.maxGust >= 15 ? 'warn' : ''}>{n0(w.maxGust, ' m/s')}</b></div>
            <div><span>Min temp / følt</span><b>{n0(w.minTemp, '°')} / {n0(w.minChill, '°')}</b></div>
            <div><span>Nedbør / snø</span><b>{n1(w.precipMm, ' mm')} / {n1(w.snowCm, ' cm')}</b></div>
            <div><span>Dårligste sikt</span><b>{w.minVis == null ? 'ukjent' : w.minVis >= 10000 ? 'god' : `${n1(w.minVis / 1000, ' km')}`}</b></div>
            <div><span>Motvind</span><b>{Math.round(w.headShare * 100)} %</b></div>
          </div>
          <button className="link small" onClick={() => setShow(!show)}>{show ? 'Skjul time for time' : 'Vis time for time langs ruten'}</button>
          {show && (
            <div className="tablewrap">
              <table className="wxtable">
                <thead><tr><th>Kl.</th><th>Ved</th><th>Vind</th><th>Kast</th><th>For deg</th><th>Temp (følt)</th><th>Nedbør</th><th>Sikt</th><th>Sky</th></tr></thead>
                <tbody>
                  {w.hours.map((h, k) => (
                    <tr key={k} className={(h.row.windGust ?? 0) >= 15 || (h.row.visibility ?? 99999) < 1000 ? 'wx-bad' : ''}>
                      <td>{hhmm(h.hour)}</td>
                      <td>{(h.d / 1000).toFixed(0)} km</td>
                      <td><span className="arr" style={{ display: 'inline-block', transform: `rotate(${((h.row.windFrom ?? 0) + 180) % 360}deg)` }}>➜</span> {dirName(h.row.windFrom ?? 0)} {n1(h.row.windSpeed)}</td>
                      <td>{n0(h.row.windGust)}</td>
                      <td className={`rel-${h.rel}`}>{h.rel}</td>
                      <td>{n0(h.row.temp, '°')} ({n0(h.chill, '°')})</td>
                      <td>{h.row.snow ? `${n1(h.row.snow)} cm` : n1(h.row.precip, ' mm')}</td>
                      <td>{h.row.visibility == null ? '–' : h.row.visibility >= 10000 ? '>10 km' : `${n1(h.row.visibility / 1000)} km`}</td>
                      <td>{n0(h.row.cloud, ' %')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </article>
  );
}

export default function VaerPage() {
  const st = useStore();
  const { plan, days, route } = useExpedition();
  const [sel, setSel] = useState<string[]>(() => PROVIDERS.map((p) => p.id));
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<string[]>([]);
  const [obs, setObs] = useState<Observation[] | null>(null);
  const [obsErr, setObsErr] = useState('');
  const [windy, setWindy] = useState(false);
  const [best, setBest] = useState<DepartureOption[] | null>(null);
  const source = plan.weatherSource ?? 'met';
  const key = route ? routeHash(route) : '';
  const fc = route ? forecastFor(st, route, plan) : { points: null, provider: source };
  const wx = useMemo(() => days.map((d) => dayWeather(d, fc.points)), [days, fc.points]);
  const date0 = plan.tripDate ?? st.tripDate;

  // sammenligning: kjør scenarioet med hver leverandørs prognose
  const compare = useMemo(() => {
    if (!route) return [];
    return PROVIDERS.filter((p) => st.weather[p.id]?.routeKey === key && st.weather[p.id].points.length).map((p) => {
      const alt = { ...plan, weatherSource: p.id, days: plan.days.map((d) => ({ ...d, windMode: 'prognose' as const })) };
      const run = runPlan(st, alt);
      const pts = st.weather[p.id].points;
      return { p, sm: summarize(run), wx: run.days.map((d) => dayWeather(d, pts)) };
    });
  }, [st.weather, plan, route, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const cumR = route ? cumulative(route.waypoints) : [];
  const mid = route ? pointAt(route.waypoints, cumR, cumR[cumR.length - 1] / 2) : null;
  const fetchAll = async () => {
    if (!route) return;
    setBusy('Henter …');
    setMsg([]);
    try {
      const errs = await refreshWeather(route, sel, (m) => setBusy(m));
      setMsg(errs.length ? errs : ['Værdata hentet langs hele ruten.']);
    } finally {
      setBusy('');
    }
  };
  const useForecastAllDays = () => updatePlan((p) => ({ ...p, days: p.days.map((d) => ({ ...d, windMode: 'prognose' })) }));
  const anyForecastDay = plan.days.some((d) => d.windMode !== 'manuell');

  return (
    <div className="page vaerpage">
      <Card title="Vær langs ruten" className="wide" right={<span className="small muted">Scenario «{plan.name}» · avreise {new Date(`${date0}T12:00:00`).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}>
        <p className="small muted">Prognoser hentes for punkter hver ~12 km langs ruten. Appen bruker været der og når simuleringen sier at dere er på ruten – ikke bare ved start.</p>
        <div className="provgrid">
          {PROVIDERS.map((p) => {
            const w = st.weather[p.id];
            const fresh = w && w.routeKey === key;
            return (
              <label key={p.id} className={`prov ${source === p.id ? 'cur' : ''}`}>
                <span className="row"><input type="checkbox" checked={sel.includes(p.id)} onChange={(e) => setSel(e.target.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))} /> <b>{p.label}</b></span>
                <small className="muted">{p.horizonDays} døgn frem · {p.attribution}</small>
                <small>{fresh ? <>Prognose: <b>{fmtT(w.updatedAt ?? w.fetchedAt)}</b>{w.updatedAt ? ' (laget)' : ' (hentet)'} · {w.points.length} punkter{w.errors.length ? <span className="warn"> · {w.errors.length} feil</span> : ''}</> : w ? <span className="warn">Hentet for en annen rute – hent på nytt</span> : <span className="muted">Ikke hentet</span>}</small>
                {fresh && <button className={`btn small ${source === p.id ? 'on' : 'ghost'}`} onClick={(e) => { e.preventDefault(); updatePlan((x) => ({ ...x, weatherSource: p.id })); }}>{source === p.id ? 'Brukes i scenarioet' : 'Bruk i scenarioet'}</button>}
              </label>
            );
          })}
        </div>
        <div className="btns">
          <button id="wx-fetch" className="btn primary" onClick={fetchAll} disabled={!!busy || !route || !sel.length}>{busy || 'Hent værdata langs ruten'}</button>
          {!anyForecastDay && fc.points && <button className="btn" onClick={useForecastAllDays}>Bruk prognosen alle dager i scenarioet</button>}
          {mid && <a className="btn ghost" href={providerById(source).link?.(mid)} target="_blank" rel="noreferrer">Åpne i {providerById(source).short}</a>}
        </div>
        {msg.map((m, i) => <p key={i} className={`small ${/feil|ingen data|:/.test(m) && !/hentet langs/.test(m) ? 'warn' : 'ok'}`}>{m}</p>)}
        <p className="small muted">Prognose ≠ observasjon. Tidene over er når prognosen ble laget (eller hentet). Uten nett vises sist hentede data.</p>
      </Card>

      {st.weatherAlerts && (
        <Card title={`Farevarsler fra MET (${st.weatherAlerts.alerts.length})`} className="wide" right={<span className="small muted">hentet {fmtT(st.weatherAlerts.fetchedAt)}</span>}>
          {st.weatherAlerts.error && <p className="small warn">Kunne ikke hente farevarsler: {st.weatherAlerts.error}</p>}
          {!st.weatherAlerts.error && !st.weatherAlerts.alerts.length && <p className="small ok">Ingen gjeldende farevarsler for punkter langs ruten.</p>}
          {st.weatherAlerts.alerts.map((a) => (
            <div key={a.id} className={`warn-row lv-${a.level === 'rød' || a.level === 'oransje' ? 'viktig' : 'advarsel'}`}>
              <div className="warn-head"><span className={`lv lv-${a.level === 'gul' ? 'advarsel' : 'viktig'}`}>{a.level.toUpperCase()}</span> {a.title}</div>
              <div className="small">{a.description}</div>
              {a.instruction && <div className="small muted">{a.instruction}</div>}
              <div className="small muted">{a.onset && `Fra ${fmtT(a.onset)}`}{a.ends && ` til ${fmtT(a.ends)}`} · ved {a.at}</div>
            </div>
          ))}
        </Card>
      )}

      <Card title={`Været du møter, dag for dag (${providerById(source).short})`} className="wide">
        {!fc.points ? <p className="small muted">Ingen prognose fra {providerById(source).short} for denne ruten ennå. Trykk «Hent værdata langs ruten» (krever nett, turen må være innenfor {providerById(source).horizonDays} døgn).</p> : null}
        {plan.days.some((d) => d.windMode === 'manuell') && fc.points && <p className="small warn">Noen dager bruker fortsatt ditt eget vindscenario i beregningen. <button className="link" onClick={useForecastAllDays}>Bruk prognosen alle dager</button></p>}
        <div className="wxdays">{wx.map((w, i) => <DayWeatherCard key={i} w={w} i={i} date={addDays(date0, i)} open={i === 0} />)}</div>
      </Card>

      {compare.length > 0 && (
        <Card title="Sammenlign leverandører" className="wide">
          <p className="small muted">Samme scenario regnet ut med hver leverandørs prognose. Store forskjeller = usikker prognose.</p>
          <div className="tablewrap">
            <table className="cmptable">
              <thead><tr><th>Leverandør</th><th>Ankomst</th>{plan.days.map((_, i) => <th key={i}>Dag {i + 1}: vind / kast / min °C</th>)}</tr></thead>
              <tbody>
                {compare.map((c) => (
                  <tr key={c.p.id}>
                    <th>{c.p.short}<br /><small className="muted">{fmtT(st.weather[c.p.id].updatedAt ?? st.weather[c.p.id].fetchedAt)}</small></th>
                    <td>{c.sm.doneDay ? `Dag ${c.sm.doneDay.day} ${hhmm(c.sm.doneDay.arrival)}` : `${c.sm.remainingKm.toFixed(0)} km igjen`}</td>
                    {c.wx.map((w, i) => <td key={i}>{w.covered ? `${n1(w.avgWind)} / ${n0(w.maxGust)} m/s / ${n0(w.minTemp)}°` : 'utenfor'}{w.hazards.some((h) => h.level === 'viktig') && <span className="lv lv-viktig"> !</span>}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="Når er det best å reise?" className="wide">
        <p className="small muted">Prøver hver avreisedato innenfor prognosen med dette scenarioet (samme dager, kites og mål) og rangerer etter ankomst, farlige forhold og dagslys. Datoer etter prognosens slutt merkes – der brukes ditt vindscenario.</p>
        <div className="btns">
          <button id="wx-best" className="btn" disabled={!!busy || !route} onClick={async () => {
            const today = new Date().toISOString().slice(0, 10);
            const dates = Array.from({ length: 14 }, (_, k) => addDays(today, k));
            setBusy('Prøver datoer …');
            try { setBest(await findBestDepartures(plan, dates, (i, n) => setBusy(`Prøver dato ${i}/${n} …`))); } finally { setBusy(''); }
          }}>Finn beste avreise de neste 14 dagene</button>
        </div>
        {best && (
          <div className="tablewrap">
            <table className="cmptable" id="best-dep">
              <thead><tr><th>#</th><th>Avreise</th><th>Resultat</th><th>Kitetid</th><th>Farlig / krevende</th><th>Minste dagslysmargin</th><th>Grunnlag</th><th /></tr></thead>
              <tbody>{best.map((b, k) => (
                <tr key={b.date} className={k === 0 ? 'best' : ''}>
                  <td>{k + 1}</td>
                  <td>{new Date(`${b.date}T12:00:00`).toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                  <td className={b.reached ? 'ok' : 'warn'}>{b.summary}</td>
                  <td>{n1(b.movingH, ' t')}</td>
                  <td>{b.important ? <span className="lv lv-viktig">{b.important} viktige</span> : null} {b.warnings ? <span className="lv lv-advarsel">{b.warnings} advarsler</span> : !b.important ? '–' : null}</td>
                  <td>{n1(b.minDaylightH, ' t')}</td>
                  <td>{b.covered ? 'prognose' : <span className="muted">delvis eget scenario</span>}</td>
                  <td><button className="link" onClick={() => useStore.getState().set({ tripDate: b.date })}>bruk</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Siste observasjoner (målt)">
        <p className="small muted">Målinger fra MET sine stasjoner nær ruten (Frost API). Krever gratis klient-ID fra frost.met.no – legges inn under Værmelding.</p>
        <button className="btn small" disabled={!st.frostClientId || !route} onClick={async () => {
          setObsErr('');
          try {
            const cum = cumulative(route!.waypoints);
            const pts = [0, 0.5, 1].map((f) => pointAt(route!.waypoints, cum, cum[cum.length - 1] * f));
            const all: Observation[] = [];
            for (const p of pts) for (const o of await latestObservations(st.frostClientId!, p, 2)) if (!all.some((x) => x.station === o.station)) all.push(o);
            setObs(all);
          } catch (e) { setObsErr((e as Error).message); }
        }}>{st.frostClientId ? 'Hent observasjoner' : 'Mangler Frost-klient-ID'}</button>
        {obsErr && <p className="small warn">{obsErr}</p>}
        {obs && (obs.length ? (
          <ul className="small list">{obs.map((o) => <li key={o.station}><b>{o.station}</b>{o.distanceKm != null && ` (${n1(o.distanceKm)} km)`} · målt {fmtT(o.time)}: vind {n1(o.windSpeed)} m/s{o.windFrom != null && ` fra ${dirName(o.windFrom)}`}, kast {n0(o.windGust)} m/s, {n1(o.temp, ' °C')}{o.snowDepthCm != null && `, snødybde ${n0(o.snowDepthCm)} cm`}</li>)}</ul>
        ) : <p className="small muted">Ingen ferske observasjoner fra stasjonene nærmest ruten.</p>)}
      </Card>

      <Card title="Windy">
        <p className="small muted">Interaktivt vindkart fra Windy (ECMWF m.fl.). Windy sitt data-API krever betalt nøkkel som ikke kan skjules på en statisk nettside, så vi viser deres offisielle kart.</p>
        {mid && <div className="btns"><button className="btn small" onClick={() => setWindy(!windy)}>{windy ? 'Skjul Windy-kart' : 'Vis Windy-kart'}</button><a className="btn small ghost" href={windyLink(mid)} target="_blank" rel="noreferrer">Åpne windy.com</a></div>}
        {windy && mid && <iframe className="windy" title="Windy vindkart" src={windyEmbed(mid)} loading="lazy" />}
      </Card>
    </div>
  );
}
