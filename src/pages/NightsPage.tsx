import { Advanced, Empty, NextStep } from '../components/ux';
import { useState } from 'react';
import { useStore } from '../state/store';
import { useExpedition, useInsights, assignCamp } from '../state/expedition';
import { availableCamps } from '../lib/plan/insights';
import { hhmm } from '../lib/sim/expedition';
import { cumulative, pointAt, uid } from '../lib/geo';
import { CROSSING_TEXT, type Crossing, type CrossingKind } from '../lib/project/model';
import type { Camp } from '../types';
import { Card } from '../components/ui';

const KIND_TEXT: Record<NonNullable<Camp['kind']>, string> = { telt: '⛺ Telt', hytte: '🏠 Hytte', gapahuk: '🛖 Gapahuk/bu', leirplass: '🏕️ Leirplass', annet: 'Annet' };
const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' });

function CrossingEditor() {
  const crossings = useStore((s) => s.crossings);
  const set = useStore((s) => s.set);
  const { route, ctx } = useExpedition();
  const [km, setKm] = useState(10);
  const upd = (id: string, p: Partial<Crossing>) => set({ crossings: crossings.map((c) => (c.id === id ? { ...c, ...p } : c)) });
  const onRoute = new Map((ctx?.crossings ?? []).map((x) => [x.c.id, x.d]));
  return (
    <Card title={`Krysninger langs ruten (${crossings.length})`} className="wide">
      <p className="small muted">Ferjer, båt, broer, elver, vei og iskryssinger. Ventetid og overgangstid regnes inn i dagens tidsplan; med rutetabell venter dere på neste avgang, og etter siste avgang stopper dagen ved krysningen. Legg inn kilde (rutetabell/erfaring) – uten kilde vises tallene som usikre.</p>
      {crossings.map((c) => (
        <div key={c.id} className="crossrow">
          <div className="row">
            <input value={c.name} onChange={(e) => upd(c.id, { name: e.target.value })} aria-label="Navn" />
            <select value={c.kind} onChange={(e) => upd(c.id, { kind: e.target.value as CrossingKind })} aria-label="Type">{Object.entries(CROSSING_TEXT).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
            <span className="small muted">{onRoute.has(c.id) ? `ved km ${(onRoute.get(c.id)! / 1000).toFixed(1)}` : 'ikke på ruten (> 400 m unna)'}</span>
            <button className="link danger" onClick={() => confirm(`Slette krysningen «${c.name}»?`) && set({ crossings: crossings.filter((x) => x.id !== c.id) })}>slett</button>
          </div>
          <div className="row small">
            <label>Ventetid (min)<input type="number" min={0} value={c.waitMin} onChange={(e) => upd(c.id, { waitMin: +e.target.value })} style={{ width: 70 }} /></label>
            <label>Overgang (min)<input type="number" min={0} value={c.transferMin} onChange={(e) => upd(c.id, { transferMin: +e.target.value })} style={{ width: 70 }} /></label>
            <label>Avganger<input placeholder="08:00, 12:00, 16:00" value={c.schedule ?? ''} onChange={(e) => upd(c.id, { schedule: e.target.value })} /></label>
            <label>I drift fra–til (MM-DD)<span className="row"><input placeholder="05-15" value={c.seasonFrom ?? ''} onChange={(e) => upd(c.id, { seasonFrom: e.target.value || undefined })} style={{ width: 70 }} /><input placeholder="09-30" value={c.seasonTo ?? ''} onChange={(e) => upd(c.id, { seasonTo: e.target.value || undefined })} style={{ width: 70 }} /></span></label>
            <label>Kilde<input placeholder="rutetabell-lenke / egen erfaring" value={c.source ?? ''} onChange={(e) => upd(c.id, { source: e.target.value || undefined })} /></label>
          </div>
        </div>
      ))}
      {route && (
        <div className="row small">
          <span>Ny krysning ved km</span>
          <input type="number" min={0} value={km} onChange={(e) => setKm(+e.target.value)} style={{ width: 80 }} />
          <button className="btn small" onClick={() => {
            const cum = cumulative(route.waypoints);
            const p = pointAt(route.waypoints, cum, Math.min(km * 1000, cum[cum.length - 1]));
            set({ crossings: [...crossings, { id: uid('kryss'), name: `Krysning km ${km}`, kind: 'elv', lat: p.lat, lon: p.lon, waitMin: 0, transferMin: 15 }] });
          }}>+ Legg til</button>
          <span className="muted">eller klikk i kartet → «Krysning her»</span>
        </div>
      )}
    </Card>
  );
}

export default function NightsPage() {
  const st = useStore();
  const { plan, days } = useExpedition();
  const ins = useInsights();
  const camps = availableCamps(st, plan.id);
  const upd = (id: string, p: Partial<Camp>) => st.set({ camps: st.camps.map((c) => (c.id === id ? { ...c, ...p, updatedAt: new Date().toISOString() } : c)) });
  const cost = ins.nights.reduce((a, n) => a + (n.camp?.costPerPerson ?? 0) * ins.people, 0);
  return (
    <div className="page">
      <Card title={`Hvor dere sover – «${plan.name}»`} className="wide" right={<span className="small muted">{ins.people} person{ins.people > 1 ? 'er' : ''} · {ins.nights.length} netter{cost ? ` · ${cost.toLocaleString('nb-NO')} kr` : ''}</span>}>
        <p className="small muted">Overnattingen styrer dagsetappene: velger du et sted, slutter dagen der og neste dag starter derfra. Andre scenarioer påvirkes ikke.</p>
        <div className="nights">
          {ins.nights.map((n, i) => {
            const d = days[i];
            return (
              <div key={n.night} className={`night ${n.issues.length ? 'has-issue' : ''}`}>
                <div className="night-head"><b>Natt {n.night}</b> <span className="muted small">{fmtDate(n.date)}</span></div>
                <select id={`night-${n.night}`} value={n.camp?.id ?? ''} onChange={(e) => assignCamp(i, e.target.value || null)} aria-label={`Overnatting natt ${n.night}`}>
                  <option value="">{d?.reason.startsWith('allerede') ? 'Ikke nødvendig (i mål)' : 'Ikke valgt – dagen ender der modellen rekker'}</option>
                  {camps.map((c) => <option key={c.id} value={c.id}>{c.kind ? KIND_TEXT[c.kind] + ' · ' : ''}{c.name}</option>)}
                </select>
                <div className="kv small">
                  <span>Dagsetappe</span><b>{n.distFromPrevKm.toFixed(1)} km</b>
                  <span>Ankomst</span><b>{hhmm(n.arrival)} {d && <small className="muted">({hhmm(d.rangeArrival[0])}–{hhmm(d.rangeArrival[1])})</small>}</b>
                  {n.camp && <><span>Type / plass</span><b>{n.camp.kind ? KIND_TEXT[n.camp.kind] : 'ikke satt'}{n.camp.capacity != null ? ` · ${n.camp.capacity} plasser` : ''}</b></>}
                  {n.offRouteKm != null && n.offRouteKm > 0.3 && <><span>Fra ruten</span><b>{n.offRouteKm.toFixed(1)} km</b></>}
                  {n.camp?.resupply && <><span>Påfyll</span><b className="ok">mat/brensel fylles på</b></>}
                </div>
                {n.issues.map((t) => <div key={t} className="small warn">⚠️ {t}</div>)}
              </div>
            );
          })}
          {!ins.nights.length && <p className="small muted">Scenarioet er bare én dag – ingen overnatting.</p>}
        </div>
        {ins.nights.length > 0 && !camps.length && (
          <Empty icon="⛺" title="Ingen overnattingssteder lagt inn ennå" actions={<><button className="btn small primary" onClick={() => st.setTab('plan')}>Legg til fra dagplanen</button><button className="btn small" onClick={() => st.setTab('oversikt')}>Velg i kartet</button></>}>
            På hvert dagkort under Dag for dag kan du trykke «+ Teltplass ved sluttpunktet» eller la appen foreslå steder ut fra terrenget. Du kan også trykke i kartet.
          </Empty>
        )}
      </Card>

      <Advanced className="wide" title={`Rediger overnattingssteder (${st.camps.length})`} hint="type, antall plasser, påfyll, pris og hvilke scenarioer stedet gjelder">
      <Card title={`Overnattingssteder (${st.camps.length})`} className="wide">
        <p className="small muted">Legg til steder ved å klikke i kartet (Oversikt) eller med «+ Teltplass ved sluttpunktet» på dagkortene. Her setter du type, plass, påfyll og hvilke scenarioer stedet gjelder for.</p>
        <div className="tablewrap">
          <table className="cmptable">
            <thead><tr><th>Sted</th><th>Type</th><th>Plasser</th><th>Påfyll</th><th>kr/pers/natt</th><th>Scenarioer</th></tr></thead>
            <tbody>
              {st.camps.map((c) => (
                <tr key={c.id}>
                  <td><button className="link" onClick={() => st.set({ selectedCamp: c.id, tab: 'oversikt' })}>{c.name}</button></td>
                  <td><select value={c.kind ?? ''} onChange={(e) => upd(c.id, { kind: (e.target.value || undefined) as Camp['kind'] })} aria-label="Type"><option value="">–</option>{Object.entries(KIND_TEXT).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></td>
                  <td><input type="number" min={0} value={c.capacity ?? ''} onChange={(e) => upd(c.id, { capacity: e.target.value === '' ? undefined : +e.target.value })} style={{ width: 64 }} aria-label="Plasser" /></td>
                  <td><input type="checkbox" checked={!!c.resupply} onChange={(e) => upd(c.id, { resupply: e.target.checked })} aria-label="Påfyll" /></td>
                  <td><input type="number" min={0} value={c.costPerPerson ?? ''} onChange={(e) => upd(c.id, { costPerPerson: e.target.value === '' ? undefined : +e.target.value })} style={{ width: 80 }} aria-label="Pris" /></td>
                  <td className="small">
                    <label className="chk"><input type="checkbox" checked={!c.scenarioIds?.length} onChange={(e) => upd(c.id, { scenarioIds: e.target.checked ? undefined : [plan.id] })} /> alle</label>
                    {!!c.scenarioIds?.length && st.plans.map((p) => <label key={p.id} className="chk"><input type="checkbox" checked={c.scenarioIds!.includes(p.id)} onChange={(e) => upd(c.id, { scenarioIds: e.target.checked ? [...c.scenarioIds!, p.id] : c.scenarioIds!.filter((x) => x !== p.id) })} /> {p.name}</label>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!st.camps.length && <p className="small muted">Ingen steder ennå.</p>}
      </Card>
      </Advanced>

      <Advanced className="wide" title={`Krysninger langs ruten (${st.crossings.length})`} hint="ferje, båt, bro, elv og is – ventetid regnes inn i dagens tid">
        <CrossingEditor />
      </Advanced>
      <NextStep to="vaerkite">Velg kites</NextStep>
    </div>
  );
}
