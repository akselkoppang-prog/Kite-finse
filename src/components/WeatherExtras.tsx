import { useState } from 'react';
import { useStore } from '../state/store';
import { useActiveRoute, useDayPlan } from '../state/derived';
import { forecast, windChill, frostClimate, type ClimateStat } from '../lib/api/met';
import { subgoals } from '../lib/subgoals';
import { addDays, daysBetween } from '../lib/sun';
import { DIRS8, cumulative, pointAt } from '../lib/geo';
import { Card, Kind, fmtTime } from './ui';

const KEY_POINTS = ['finse', 'kraekkja', 'stigstuv', 'rauhelleren', 'marbu', 'kalhovd', 'helberghytta', 'gvepseborg', 'rjukan'];
const HORIZON_DAYS = 9; // MET Locationforecast: ca. 9–10 døgn

export function WindMapControls() {
  const s = useStore();
  const route = useActiveRoute();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = async () => {
    setBusy(true);
    setErr('');
    const pts = [
      ...KEY_POINTS.map((k) => s.places[k]).filter(Boolean).map((p) => ({ label: p!.name, lat: p!.lat, lon: p!.lon })),
      ...subgoals(route).slice(1, -1).map((g) => ({ label: `Delmål ${g.idx}`, lat: g.lat, lon: g.lon })),
    ];
    if (!pts.length) {
      setErr('Ingen punkter: hent stedsnavn (Kart → steg 1) eller last en rute.');
      setBusy(false);
      return;
    }
    const out: typeof s.windPoints = [];
    for (const p of pts) {
      try {
        out.push({ ...p, fc: await forecast(p) });
      } catch (e) {
        setErr(`Noen punkter feilet: ${(e as Error).message}`);
      }
    }
    s.set({ windPoints: out, forecastHour: 0 });
    setBusy(false);
  };
  const rows = s.windPoints[0]?.fc.rows ?? [];
  const t = rows[Math.min(s.forecastHour, rows.length - 1)]?.time;
  return (
    <Card title="Vindpiler i kartet (MET-prognose)" right={<Kind k="kartdata" />}>
      <div className="row">
        <button className="btn small" onClick={load} disabled={busy}>{busy ? 'Henter…' : `Hent vind for ${KEY_POINTS.filter((k) => s.places[k]).length} steder + delmål`}</button>
        <label className="chk small"><input id="wa-on" type="checkbox" checked={s.layers.windArrows} onChange={(e) => s.setLayer('windArrows', e.target.checked)} /> Vis i kartet</label>
      </div>
      {rows.length > 0 && (
        <label className="small">Prognosetid: <b>{t ? new Date(t).toLocaleString('nb-NO', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–'}</b>
          <input id="wa-hour" type="range" min={0} max={rows.length - 1} value={s.forecastHour} onChange={(e) => s.set({ forecastHour: +e.target.value })} />
        </label>
      )}
      {err && <p className="err small">{err}</p>}
      <p className="small muted">Pilene viser MET-prognosen for hvert punkt (modellgitter ~2,5 km), med middelvind/kast i m/s. Ingenting er interpolert mellom punktene, og ingenting er målt. Prognosen gjelder dagens dato, ikke turdatoen, til avreise er innenfor ~{HORIZON_DAYS} døgn.</p>
    </Card>
  );
}

export function TripForecast() {
  const s = useStore();
  const route = useActiveRoute();
  const plan = useDayPlan(route);
  const [fc, setFc] = useState<Record<number, Awaited<ReturnType<typeof forecast>>>>({});
  const [err, setErr] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const until = daysBetween(today, s.tripDate);
  const lastDay = addDays(s.tripDate, s.tripDays - 1);
  const inHorizon = daysBetween(today, lastDay) <= HORIZON_DAYS && until >= -s.tripDays;
  const availableFrom = addDays(s.tripDate, -HORIZON_DAYS);
  const load = async () => {
    if (!route) return;
    setErr('');
    const cum = cumulative(route.waypoints);
    const out: typeof fc = {};
    for (const d of plan.days) {
      const p = pointAt(route.waypoints, cum, (d.d0 + d.d1) / 2);
      try {
        out[d.day] = await forecast({ ...p, label: `Dag ${d.day}` });
      } catch (e) {
        setErr((e as Error).message);
      }
    }
    setFc(out);
  };
  return (
    <Card title="Vær for turdagene" className="wide" right={inHorizon ? <button className="btn small" onClick={load}>Hent prognose for hver dag</button> : <Kind k="sjekk-selv" />}>
      {!inHorizon ? (
        <p className="small warn">
          Avreise {s.tripDate} er {until} dager frem. MET-prognosen dekker bare ~{HORIZON_DAYS} døgn, så det finnes <b>ingen prognose for turdagene ennå</b>. Den blir tilgjengelig rundt <b>{availableFrom}</b>. Bruk klimatologi (under) til planlegging. Ingen simulerte værdata vises.
        </p>
      ) : (
        <>
          {err && <p className="err small">{err}</p>}
          <div className="tablewrap">
            <table className="tbl small">
              <thead><tr><th>Dag</th><th>Dato</th><th>Vind (snitt 08–18)</th><th>Kast maks</th><th>Retning</th><th>Temp</th><th>Effektiv temp</th><th>Nedbør</th><th>Snø?</th><th>Sky / tåke</th><th>Usikkerhet P10–P90</th><th>Oppdatert</th></tr></thead>
              <tbody>
                {plan.days.map((d) => {
                  const f = fc[d.day];
                  const rows = f?.rows.filter((r) => { const h = new Date(r.time); return r.time.slice(0, 10) === d.date && h.getUTCHours() >= 7 && h.getUTCHours() <= 17; }) ?? [];
                  const avg = (k: 'windSpeed' | 'temp' | 'cloud' | 'fog') => { const v = rows.map((r) => r[k]).filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined; };
                  const gust = Math.max(...rows.map((r) => r.windGust ?? -1));
                  const prec = rows.reduce((a, r) => a + (r.precip ?? 0), 0);
                  const dirs = rows.map((r) => r.windFrom).filter((x): x is number => x != null);
                  const dir = dirs.length ? DIRS8[Math.round((Math.atan2(dirs.reduce((a, x) => a + Math.sin((x * Math.PI) / 180), 0), dirs.reduce((a, x) => a + Math.cos((x * Math.PI) / 180), 0)) * 180) / Math.PI / 45 + 8) % 8] : '–';
                  const w = avg('windSpeed'), tmp = avg('temp');
                  const p10 = Math.min(...rows.map((r) => r.windP10 ?? Infinity)), p90 = Math.max(...rows.map((r) => r.windP90 ?? -Infinity));
                  return (
                    <tr key={d.day}>
                      <td>{d.day}</td><td>{d.date}</td>
                      <td>{f ? (rows.length ? `${w?.toFixed(1)} m/s` : 'utenfor prognosen') : '–'}</td>
                      <td>{gust > 0 ? `${gust.toFixed(0)} m/s` : '–'}</td>
                      <td>{rows.length ? dir : '–'}</td>
                      <td>{tmp != null ? `${tmp.toFixed(0)}°` : '–'}</td>
                      <td>{tmp != null && w != null ? `${windChill(tmp, w)?.toFixed(0)}° (beregnet)` : '–'}</td>
                      <td>{rows.length ? `${prec.toFixed(1)} mm` : '–'}</td>
                      <td>{rows.length ? (prec > 0.2 && (tmp ?? 5) <= 0.5 ? 'sannsynlig snø (beregnet)' : prec > 0.2 ? 'mulig regn/sludd' : 'lite') : '–'}</td>
                      <td>{rows.length ? `${avg('cloud')?.toFixed(0) ?? '–'} % / ${avg('fog')?.toFixed(0) ?? '–'} %` : '–'}</td>
                      <td>{Number.isFinite(p10) && Number.isFinite(p90) ? `${p10.toFixed(0)}–${p90.toFixed(0)} m/s` : '–'}</td>
                      <td>{fmtTime(f?.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="small muted">Kilde: MET Locationforecast for punktet midt på hver dagsetappe. Sikt finnes ikke i API-et – tåkeandel vises i stedet. Effektiv temperatur og snø/regn er beregnet.</p>
        </>
      )}
    </Card>
  );
}

export function Climatology() {
  const s = useStore();
  const [res, setRes] = useState<(ClimateStat & { label: string })[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const month = Number(s.tripDate.slice(5, 7));
  const run = async () => {
    setBusy(true);
    setErr('');
    const pts = ['finse', 'rauhelleren', 'kalhovd', 'gvepseborg'].map((k) => s.places[k]).filter(Boolean);
    const out: typeof res = [];
    for (const p of pts) {
      try {
        out.push({ ...(await frostClimate(s.frostClientId, p!, month, month)), label: p!.name });
      } catch (e) {
        setErr((e as Error).message);
      }
    }
    setRes(out);
    setBusy(false);
  };
  return (
    <Card title={`Klimatologi for ${['', 'januar', 'februar', 'mars', 'april', 'mai'][month] ?? `måned ${month}`} (historiske observasjoner)`} className="wide" right={<Kind k="kartdata" />}>
      <p className="small">Dette er <b>historiske målinger</b> fra nærmeste MET-stasjoner, ikke en prognose. MET Frost krever en gratis klient-ID (<a href="https://frost.met.no/auth/requestCredentials.html" target="_blank" rel="noreferrer">registrer her</a>).</p>
      <div className="row">
        <input id="frost-id" placeholder="Frost klient-ID" value={s.frostClientId} onChange={(e) => s.set({ frostClientId: e.target.value.trim() })} />
        <button className="btn small" disabled={!s.frostClientId || busy || !Object.keys(s.places).length} onClick={run}>{busy ? 'Henter…' : 'Hent statistikk'}</button>
      </div>
      {!Object.keys(s.places).length && <p className="small muted">Hent stedsnavn først (Kart → steg 1).</p>}
      {err && <p className="err small">Feil: {err}</p>}
      {res.length > 0 && (
        <div className="tablewrap">
          <table className="tbl small">
            <thead><tr><th>Nær</th><th>Stasjon</th><th>År</th><th>Døgn</th><th>Snittvind</th><th>75-persentil</th><th>Snitt døgnmaks kast</th><th>Snitt temp</th><th>Laveste døgnsnitt</th></tr></thead>
            <tbody>
              {res.map((r) => (
                <tr key={r.stationId}><td>{r.label}</td><td>{r.station} ({r.stationId}{r.distKm != null ? `, ${r.distKm.toFixed(0)} km` : ''})</td><td>{r.years}</td><td>{r.n}</td><td>{r.meanWind?.toFixed(1) ?? '–'} m/s</td><td>{r.p75Wind?.toFixed(1) ?? '–'} m/s</td><td>{r.meanMaxGust?.toFixed(1) ?? '–'} m/s</td><td>{r.meanTemp?.toFixed(1) ?? '–'}°</td><td>{r.minTemp?.toFixed(1) ?? '–'}°</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">Stasjonene ligger ofte i daler eller ved veier og kan måle svakere vind enn på vidda.</p>
    </Card>
  );
}
