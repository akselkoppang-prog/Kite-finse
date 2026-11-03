import { useState } from 'react';
import { useStore } from '../state/store';
import { useActiveRoute, useBarrierCheck, useProfile, useTerrain } from '../state/derived';
import { SCENARIOS, runScenario } from '../lib/analysis/feasibility';
import { campCandidates, evaluateCamp } from '../lib/analysis/camps';
import { daylightHours, fmtCoord, fmtKm, nearestOnRoute, pointAt, cumulative, uid } from '../lib/geo';
import { Badge, Card, Kind } from '../components/ui';

export default function DayPlanPage() {
  const s = useStore();
  const route = useActiveRoute();
  const { stats } = useProfile(route);
  const terrain = useTerrain(route);
  const check = useBarrierCheck(route);
  const [scId, setScId] = useState<'A' | 'B' | 'C'>('B');
  const [nDays, setNDays] = useState<number | 'scenario'>(3);
  const date = new Date(s.tripDate);
  const lat = route?.waypoints[0]?.lat ?? 60.3;
  const km = stats.total / 1000;
  const results = SCENARIOS.map((sc) => runScenario(sc, km, date, lat));
  const res = results.find((r) => r.scenario.id === scId)!;
  const days = nDays === 'scenario' ? Math.max(1, Math.ceil(res.travelDays)) : nDays;
  const perDayM = stats.total / days;
  const places = Object.values(s.places);
  const wps = route?.waypoints ?? [];
  const cum = cumulative(wps);

  return (
    <div className="page">
      <Card title="Tre dager eller flere? – gjennomførbarhet" className="wide">
        <div className="form">
          <label>Avreisedato<input type="date" value={s.tripDate} onChange={(e) => s.set({ tripDate: e.target.value })} /></label>
          <div className="small">Dagslys ved {lat.toFixed(1)}°N: <b>{daylightHours(date, lat).toFixed(1)} t</b> <Kind k="beregnet" /></div>
          <div className="small">Rutelengde (aktiv): <b>{fmtKm(stats.total)}</b> (rette linjer)</div>
        </div>
        <div className="scen">
          {results.map((r) => (
            <button key={r.scenario.id} className={`scen-card ${scId === r.scenario.id ? 'on' : ''}`} onClick={() => setScId(r.scenario.id)}>
              <div className="scen-h">{r.scenario.id}. {r.scenario.name}</div>
              <div className="small">{r.scenario.text}</div>
              <div className="big">{r.totalDays} dager</div>
              <div className="small">
                {r.kmPerDay.toFixed(0)} km/dag · {Math.round(r.scenario.kiteShare * 100)} % kite · {r.distKm.toFixed(0)} km inkl. +{Math.round((r.scenario.detourFactor - 1) * 100)} % omveier · {r.scenario.weatherDays} liggedag(er)
              </div>
              <div className="small"><b>{r.verdict}</b></div>
            </button>
          ))}
        </div>
        <p className="small muted">
          <Kind k="beregnet" /> Antagelser (kite-fart inkl. kryss, ski 2,5–3,5 km/t med 40 kg pulk, 3 t/dag til leir/smelting) er grove og kan justeres i koden (feasibility.ts). Ikke optimalisert for maks distanse.
        </p>
        <div className="note small">
          <b>Konklusjon (faglig vurdering):</b> Tre dager krever i praksis scenario A – stabil, gunstig vind tre dager på rad, fast snø og god sikt. Planlegg for 4–5 dager med mat/brensel for 6, og fordel ruten slik at hver natt har en hytte eller veg innen rimelig avstand.
        </div>
      </Card>

      <Card
        title={`Dagsetapper – ${days} reisedager (${fmtKm(perDayM)}/dag)`}
        right={
          <select value={String(nDays)} onChange={(e) => setNDays(e.target.value === 'scenario' ? 'scenario' : +e.target.value)}>
            {[2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n} dager</option>)}
            <option value="scenario">Som scenario {res.scenario.id} ({Math.ceil(res.travelDays)})</option>
          </select>
        }
        className="wide"
      >
        <p className="small muted">Lik fordeling av distansen er et utgangspunkt – flytt teltplassene etter vind, terreng og hytter. {days <= 3 && res.totalDays > 3 && <span className="warn">Scenario {res.scenario.id} tilsier {res.totalDays} dager.</span>}</p>
        {!terrain && <p className="warn small">Kjør terrenganalyse (Kart → steg 4) for å få beregnede teltplass-kandidater.</p>}
        {Array.from({ length: days }, (_, i) => {
          const d0 = perDayM * i, d1 = perDayM * (i + 1);
          const p0 = pointAt(wps, cum, d0), p1 = pointAt(wps, cum, d1);
          const named = wps.filter((w, k) => w.name && cum[k] >= d0 - 1 && cum[k] <= d1 + 1).map((w) => w.name);
          const night = i + 1;
          const cands = terrain && i < days - 1 ? campCandidates(terrain.samples, d1, 5000, s.windFrom, check.barriers, places, 3) : [];
          const manual = s.camps.filter((c) => c.night === night);
          const cross = check.crossings.filter((c) => c.fromD < d1 && c.toD > d0);
          return (
            <div key={i} className="day">
              <h4>Dag {i + 1}: {fmtKm(d0)} → {fmtKm(d1)} ({fmtKm(d1 - d0)})</h4>
              <div className="small">Fra {fmtCoord(p0)} til {fmtCoord(p1)}{named.length ? ` · via ${named.join(', ')}` : ''}</div>
              {cross.length > 0 && <div className="small err">🚫 Krysser: {cross.map((c) => c.barrier.name).join(', ')} – etappen kan ikke aksepteres.</div>}
              {i < days - 1 && (
                <>
                  <div className="small"><b>Leir natt {night}</b> – beregnede kandidater (±5 km) for vind fra {s.windFrom}:</div>
                  <div className="camps">
                    {cands.map(({ s: c, ev }, k) => (
                      <div key={k} className="campcard">
                        <div>
                          <b>Kandidat {night}{String.fromCharCode(65 + k)}</b> <Badge s="GUL">beregnet – ikke befart</Badge>
                        </div>
                        <div className="mono small">{fmtCoord(c)} · {fmtKm(c.d)} · {ev.z != null ? `${Math.round(ev.z)} moh` : ''}</div>
                        <ul className="small">
                          <li>Helning: {ev.slope != null ? `${ev.slope.toFixed(1)}°` : '–'}</li>
                          <li>Vind: {ev.exposure}</li>
                          <li>Skred: {ev.avalanche.text}</li>
                          <li>Vann: {ev.waterText}. Snøsmelting: snø tilgjengelig (brensel er begrensningen).</li>
                          <li>Avbrudd: {ev.bail ? `${ev.bail.name} ${ev.bail.distKm.toFixed(1)} km luftlinje` : 'hent stedsnavn'}</li>
                          {ev.flags.map((f) => <li key={f} className="warn">{f}</li>)}
                        </ul>
                        <div className="btns">
                          <button className="btn small" onClick={() => s.focusOn(c.lat, c.lon, 14)}>Vis</button>
                          <button className="btn small" onClick={() => s.set({ camps: [...s.camps, { id: uid('camp'), lat: c.lat, lon: c.lon, name: `Leir ${night}${String.fromCharCode(65 + k)}`, night, source: 'beregnet kandidat' }] })}>Legg til i plan</button>
                        </div>
                      </div>
                    ))}
                    {terrain && cands.length < 2 && <div className="small warn">Færre enn to kandidater funnet med tilstrekkelig grunnlag i dette vinduet – vurder manuelt i kartet.</div>}
                  </div>
                  {manual.length > 0 && (
                    <div className="small">
                      <b>Dine teltplasser natt {night}:</b>
                      {manual.map((c) => {
                        const near = terrain?.samples.reduce((b, x) => (Math.abs(x.d - nearestOnRoute(wps, c).d) < Math.abs(b.d - nearestOnRoute(wps, c).d) ? x : b), terrain.samples[0]);
                        const off = nearestOnRoute(wps, c).dist;
                        const ev = evaluateCamp(c, off < 300 ? near : undefined, s.windFrom, check.barriers, places);
                        return (
                          <div key={c.id} className="campcard">
                            <b>{c.name}</b> ({c.source}) · {fmtCoord(c)} · {Math.round(off)} m fra ruten
                            <div>Vind: {ev.exposure} · Skred: {ev.avalanche.text} · Vann: {ev.waterText}</div>
                            {off >= 300 && <div className="muted">Terrengdata gjelder ruten – punktet ligger utenfor; vurder manuelt.</div>}
                            <div className="btns">
                              <select value={c.night} onChange={(e) => s.set({ camps: s.camps.map((x) => (x.id === c.id ? { ...x, night: +e.target.value } : x)) })}>
                                {Array.from({ length: days }, (_, n) => <option key={n} value={n + 1}>Natt {n + 1}</option>)}
                              </select>
                              <button className="btn small" onClick={() => s.focusOn(c.lat, c.lon, 14)}>Vis</button>
                              <button className="btn small danger" onClick={() => s.set({ camps: s.camps.filter((x) => x.id !== c.id) })}>Fjern</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </Card>

      <Card title="Plan B – forlenge eller avbryte" className="wide">
        <ul className="small">
          <li><b>Forlenge:</b> mat og brensel for 6 døgn. Ved dårlig vind: gå på ski mot nærmeste hytte og vent. Ikke press etapper i whiteout.</li>
          <li><b>Avbrudd dag 1:</b> tilbake til Finse eller nordøst mot Haugastøl (Bergensbanen/Rv7). Hytter: Krækkja, Stigstuv, Rauhelleren, Tuva.</li>
          <li><b>Avbrudd dag 2:</b> Rauhelleren/Mårbu/Kalhovd som venteplass. Ingen brøytet vei er kontrollert i dette området – avbrudd betyr trolig å vente eller fortsette.</li>
          <li><b>Avbrudd dag 3:</b> Helberghytta/Gvepseborg → Rjukan (Krossobanen stengt) eller vest mot Rjukan Fjellstue / fylkesvei.</li>
          <li><b>Absolutte stopp-kriterier (forslag):</b> faregrad 3+ og ruten går i/under skredterreng; whiteout + vind &gt; komfortvindu; skade/frostskade; utstyrssvikt på telt eller primærkite.</li>
        </ul>
        <p className="small muted"><Kind k="sjekk-selv" /> Vinterveier, brøyting og kollektivtilbud må kontrolleres for 2027.</p>
      </Card>
    </div>
  );
}
