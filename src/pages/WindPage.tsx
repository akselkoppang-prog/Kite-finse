import { useState } from 'react';
import { useStore } from '../state/store';
import { useActiveRoute, useTerrain, useWind } from '../state/derived';
import { DIRS8, densify, fmtKm, type Dir8 } from '../lib/geo';
import { forecast, type Forecast } from '../lib/api/met';
import { scoreColor } from '../lib/analysis/wind';
import { Card, Kind, Stat, fmtTime } from '../components/ui';
import { useRouteMetrics } from '../components/CompareTable';
import { WindMapControls, TripForecast, Climatology } from '../components/WeatherExtras';

const DIR_TEXT: Record<Dir8, string> = {
  N: 'Nordavind: ruten går hovedsakelig sørøstover → mest slør/medvind. Kald luft, ofte god sikt etter frontpassasje. Lesider sør for rygger.',
  NØ: 'Nordøst: nær rett medvind på hovedretning SØ → sikk-sakk, lav fart med pulk. Kald og ofte stabil.',
  Ø: 'Østavind: slør på SØ-kurs, men motvind på de østgående etappene Rauhelleren–Mår. Ofte høytrykk, kald.',
  SØ: 'Sørøst: rett MOTVIND på hovedretningen – lite egnet med 110 kg. Vurder å vente.',
  S: 'Sønnavind: kryss mot vinden på SØ-kurs; Sonic 10 sin upwind kan avgjøre. Ofte mildere, fuktig, mulig dårlig sikt.',
  SV: 'Sørvest: typisk frontvær på Hardangervidda – halvvind på SØ-kurs, men sterk vind, kast, nedbør og whiteout er vanlig.',
  V: 'Vestavind: slør på hovedretningen, ofte sterk og byget. Lesider øst for rygger, fokk.',
  NV: 'Nordvest: medvind/bredslør på SØ-kurs – rask fremdrift; ofte etter frontpassasje med byger og kast.',
};

export default function WindPage() {
  const s = useStore();
  const route = useActiveRoute();
  const terrain = useTerrain(route);
  const { legs, summary } = useWind(route);
  const metrics = useRouteMetrics();
  const [fc, setFc] = useState<Forecast[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const loadForecast = async () => {
    if (!route) return;
    setLoading(true);
    setErr('');
    const ds = densify(route.waypoints, 1000);
    const total = ds[ds.length - 1].d;
    const pts = [0, 0.33, 0.66, 1].map((f) => {
      const p = ds.reduce((b, x) => (Math.abs(x.d - f * total) < Math.abs(b.d - f * total) ? x : b), ds[0]);
      return { lat: p.lat, lon: p.lon, label: `${fmtKm(p.d)} langs ruten` };
    });
    try {
      setFc(await Promise.all(pts.map(forecast)));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const ranked = [...metrics].filter((m) => m.waterChecked && m.red === 0).sort((a, b) => b.windByDir[s.windFrom] - a.windByDir[s.windFrom]);

  return (
    <div className="page">
      <Card title="Velg vindretning (vind FRA)">
        <div className="seg">
          {DIRS8.map((d) => (
            <button key={d} className={`btn ${s.windFrom === d ? 'on' : ''}`} onClick={() => s.set({ windFrom: d })}>
              {d}
            </button>
          ))}
        </div>
        <p className="small">{DIR_TEXT[s.windFrom]}</p>
        <p className="muted small"><Kind k="sjekk-selv" /> Tekst over er faglig vurdering av typiske mønstre, ikke prognose.</p>
      </Card>

      <WindMapControls />
      <TripForecast />
      <Climatology />

      <div className="grid4">
        <Stat label="Gunstig kurs" value={`${Math.round(summary.good * 100)} %`} sub="av distansen (slør/bredslør)" />
        <Stat label="Motvind" value={`${Math.round(summary.upwind * 100)} %`} sub="< 45° mot vinden" />
        <Stat label="Le / turbulens" value={terrain ? `${Math.round(summary.lee * 100)} %` : '–'} sub={terrain ? 'DTM: terreng oppvind høyere' : 'kjør terrenganalyse'} />
        <Stat label="Eksponerte rygger" value={terrain ? `${Math.round(summary.exposed * 100)} %` : '–'} sub="sterkere vind/kast" />
      </div>

      <Card title={`Etapper for ${route?.name ?? '–'} med vind fra ${s.windFrom}`} right={<Kind k="beregnet" />} className="wide">
        <div className="windstrip">
          {legs.map((l, i) => (
            <div key={i} title={`${fmtKm(l.d0)}–${fmtKm(l.d1)}: ${l.courseText}. ${l.notes.join(' ')}`} style={{ flex: l.d1 - l.d0, background: scoreColor(l.score) }} onClick={() => s.focusOn(l.from.lat, l.from.lon, 13)} />
          ))}
        </div>
        <div className="tablewrap" style={{ maxHeight: 320 }}>
          <table className="tbl small">
            <thead>
              <tr>
                <th>Km</th>
                <th>Kurs</th>
                <th>Vinkel mot vind</th>
                <th>Vurdering</th>
                <th>Terreng (DTM)</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {legs.map((l, i) => (
                <tr key={i} className="clickable" onClick={() => s.focusOn(l.from.lat, l.from.lon, 13)}>
                  <td>{(l.d0 / 1000).toFixed(0)}–{(l.d1 / 1000).toFixed(0)}</td>
                  <td>{Math.round(l.heading)}°</td>
                  <td>{Math.round(l.angle)}°</td>
                  <td>{l.courseText}</td>
                  <td>{l.notes.join('; ') || (terrain ? '–' : 'ikke analysert')}</td>
                  <td>
                    <span className="dot" style={{ background: scoreColor(l.score) }}>{Math.round(l.score * 100)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Metode: kursvinkel fra rutegeometri; le = terreng 35–80 m (delvis le) eller &gt;80 m (vindskygge/rotor) høyere 0,6–1,5 km oppvind (Kartverket DTM). Ingen strømningsmodell – kanalisering i daler og akselerasjon over rygger er bare grovt indikert.
        </p>
      </Card>

      <Card title={`Ruter rangert for vind fra ${s.windFrom}`} right={<Kind k="beregnet" />}>
        {ranked.length === 0 && <p className="warn small">Ingen ruter er vannkontrollert uten røde kryssinger ennå. Alternative ruter kan ikke anbefales før vann er kontrollert (Kart → Hent ekte data).</p>}
        <ol>
          {ranked.map((m) => (
            <li key={m.route.id}>
              <button className="link" onClick={() => s.set({ activeRouteId: m.route.id })}>{m.route.name}</button> – {Math.round(m.windByDir[s.windFrom] * 100)} / 100
            </li>
          ))}
        </ol>
        <p className="muted small">En gunstig vindretning gjør ikke en rute trygg. Se Sikkerhet.</p>
      </Card>

      <Card title="Prognose i dag langs ruten (MET Locationforecast)" right={<button className="btn small" onClick={loadForecast} disabled={loading || !route}>{loading ? 'Henter…' : 'Hent prognose nå'}</button>} className="wide">
        <p className="small warn">
          Dette er dagens prognose (~9 døgn frem), IKKE for turen i mars/april 2027. Brukes til å teste verktøyet og i ukene før avreise. Vindkast og percentiler (P10/P90) viser prognoseusikkerhet.
        </p>
        {err && <p className="err small">Feil: {err}</p>}
        {fc.map((f) => (
          <div key={f.point.label} className="fc">
            <h4>
              {f.point.label} · {f.point.lat.toFixed(3)}, {f.point.lon.toFixed(3)} <span className="muted small">modell oppdatert {fmtTime(f.updatedAt)} · hentet {fmtTime(f.fetchedAt)}</span>
            </h4>
            <div className="tablewrap">
              <table className="tbl small">
                <thead>
                  <tr>
                    <th>Tid</th>
                    <th>Vind m/s</th>
                    <th>Kast</th>
                    <th>P10–P90</th>
                    <th>Fra</th>
                    <th>Temp</th>
                    <th>Nedbør mm (min–maks)</th>
                    <th>Skydekke</th>
                  </tr>
                </thead>
                <tbody>
                  {f.rows.filter((_, i) => i < 48 && i % 3 === 0).map((r) => (
                    <tr key={r.time}>
                      <td>{new Date(r.time).toLocaleString('nb-NO', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                      <td>{r.windSpeed?.toFixed(1) ?? '–'}</td>
                      <td>{r.windGust?.toFixed(1) ?? '–'}</td>
                      <td>{r.windP10 != null ? `${r.windP10.toFixed(1)}–${r.windP90?.toFixed(1)}` : '–'}</td>
                      <td>{r.windFrom != null ? `${Math.round(r.windFrom)}° (${DIRS8[Math.round(r.windFrom / 45) % 8]})` : '–'}</td>
                      <td>{r.temp?.toFixed(1) ?? '–'}°</td>
                      <td>{r.precip != null ? `${r.precip} (${r.precipMin ?? '–'}–${r.precipMax ?? '–'})` : '–'}</td>
                      <td>{r.cloud != null ? `${Math.round(r.cloud)} %` : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        <p className="muted small">Kilde: api.met.no Locationforecast 2.0 complete, CC BY 4.0. Kategori: <Kind k="kartdata" /> prognose (ikke observasjon).</p>
      </Card>
    </div>
  );
}
