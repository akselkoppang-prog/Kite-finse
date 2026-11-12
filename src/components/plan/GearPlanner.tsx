import { Advanced } from '../ux';
import { useUiPrefs } from '../../state/uiprefs';
import { useState } from 'react';
import { useStore } from '../../state/store';
import { useExpedition, useInsights, updatePlan } from '../../state/expedition';
import { gearListOf, runPlan, summarize } from '../../lib/plan/context';
import { GEAR_CATS, assumedKg, autoTags, type GearItem, type GearList } from '../../lib/project/model';
import { uid } from '../../lib/geo';
import { hhmm } from '../../lib/sim/expedition';
import { Card } from '../ui';

const kg1 = (v: number) => `${v.toFixed(1).replace('.', ',')} kg`;
const LEVEL_TEXT = { mangler: 'Mangler', uegnet: 'Uegnet', unødvendig: 'Kanskje unødvendig', tips: 'Tips' } as const;

/** Utstyrsliste for aktivt scenario, med vekt, eierskap, anbefalinger og effekt på fremdriften. */
export default function GearPlanner() {
  const st = useStore();
  const { plan } = useExpedition();
  const ins = useInsights();
  const list = gearListOf(st, plan);
  const [newItem, setNewItem] = useState({ name: '', cat: 'Sikkerhet', kg: '' });
  const [effect, setEffect] = useState<string | null>(null);
  const usedBy = st.plans.filter((p) => (p.gearListId ?? st.gearLists[0]?.id) === list?.id).map((p) => p.name);
  const setList = (fn: (l: GearList) => GearList) => list && st.set({ gearLists: st.gearLists.map((l) => (l.id === list.id ? { ...fn(l), updatedAt: new Date().toISOString() } : l)) });
  const upd = (id: string, p: Partial<GearItem>) => setList((l) => ({ ...l, items: l.items.map((g) => (g.id === id ? { ...g, ...p } : g)) }));
  const add = (name: string, cat: string, kg?: number, extra: Partial<GearItem> = {}) => setList((l) => ({ ...l, items: [...l.items, { id: uid('gear'), name, cat, kg, qty: 1, owner: 'felles', carry: cat === 'Klær' ? 'kropp' : 'pulk', packed: false, tags: autoTags(name), ...extra }] }));
  const t = ins.gear;
  const detailed = useUiPrefs((p) => p.detailed);
  const cats = [...new Set([...GEAR_CATS, ...(list?.items.map((g) => g.cat) ?? [])])].filter((c) => list?.items.some((g) => g.cat === c));
  const owners = [{ id: 'felles', name: 'Felles' }, ...st.team.map((m) => ({ id: m.id, name: m.name }))];

  const measure = () => {
    // samme scenario med 5 kg mer i pulken: hvor mye senere kommer dere frem?
    const base = summarize(runPlan(st, plan));
    const heavier = { ...st, gearLists: st.gearLists.map((l) => (l.id === list?.id ? { ...l, items: [...l.items, { id: 'x', name: 'test', cat: 'x', kg: 5 * ins.people, qty: 1, carry: 'pulk' as const, packed: false }] } : l)), pulkKg: st.pulkKg + 5 };
    const hv = summarize(runPlan(heavier, plan));
    const at = (s: typeof base) => (s.doneDay ? (s.doneDay.day - 1) * 24 + s.doneDay.arrival : null);
    const a = at(base), b = at(hv);
    setEffect(a != null && b != null ? `+5 kg per pulk ≈ ${Math.round((b - a) * 60)} min senere ankomst (${hhmm(base.doneDay!.arrival)} → ${hhmm(hv.doneDay!.arrival)} dag ${hv.doneDay!.day}) · kitetid ${base.movingH.toFixed(1)} → ${hv.movingH.toFixed(1)} t` : `+5 kg per pulk: ${base.remainingKm.toFixed(0)} → ${hv.remainingKm.toFixed(0)} km igjen etter siste dag`);
  };

  if (!list) return null;
  return (
    <Card title={`Pakkeliste – «${plan.name}»`} className={`wide gearplanner ${detailed ? '' : 'gear-simple'}`}>
      <div className="row gear-summary">
        <span className="gs-pct"><b>{Math.round(t.packedPct * 100)} %</b> pakket</span>
        <span className="guide-bar" aria-hidden="true"><i style={{ width: `${Math.round(t.packedPct * 100)}%` }} /></span>
        <span className="small muted">{t.count} ting · {kg1(t.pulkKg)} i pulkene · liste «{list.name}»</span>
      </div>
      <Advanced title="Utstyrslister" hint="bytt, kopier eller gi listen nytt navn">
      <div className="pt-row">
        <label className="pt-field">Utstyrsliste for scenarioet
          <select id="gear-list" value={list.id} onChange={(e) => updatePlan((p) => ({ ...p, gearListId: e.target.value }))}>
            {st.gearLists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.items.length})</option>)}
          </select>
        </label>
        <label className="pt-field">Navn<input value={list.name} onChange={(e) => setList((l) => ({ ...l, name: e.target.value }))} /></label>
        <div className="pt-field">&nbsp;
          <div className="btns">
            <button className="btn small" onClick={() => { const id = uid('gear'); st.set({ gearLists: [...st.gearLists, { ...structuredClone(list), id, name: `${list.name} (kopi)` }] }); updatePlan((p) => ({ ...p, gearListId: id })); }}>Kopier til egen liste</button>
            <button className="btn small ghost" onClick={() => { const id = uid('gear'); st.set({ gearLists: [...st.gearLists, { id, name: 'Ny liste', items: [] }] }); updatePlan((p) => ({ ...p, gearListId: id })); }}>Ny tom liste</button>
          </div>
        </div>
      </div>
      <p className="small muted">Listen brukes av: {usedBy.join(', ') || '–'}. {usedBy.length > 1 ? 'Endringer gjelder alle disse – lag en kopi for å endre bare dette scenarioet.' : ''}</p>
      </Advanced>
      <Advanced title="Vekt og effekt på fremdriften" hint="kg i pulk og på kropp, og hvor mye vekten forsinker dere">
      <div className="ov-grid gear-tiles">
        <div><span>I pulkene</span><b>{kg1(t.pulkKg)}</b><small>{ins.people > 1 ? `${kg1(t.pulkKg / ins.people)} per pulk` : 'felles + personlig'}</small></div>
        <div><span>På kroppen</span><b>{kg1(t.bodyKg)}</b></div>
        <div><span>Mat + brensel (start)</span><b>{kg1((ins.food.remainingKgByDay[0] ?? 0) + ins.food.fuelL * 0.75)}</b></div>
        <div><span>Pakket</span><b>{Math.round(t.packedPct * 100)} %</b><small>{t.count} ting</small></div>
      </div>
      <p className="small">
        {ins.load.source === 'utstyrsliste'
          ? <>Beregningen bruker <b>{kg1(ins.load.dayLoad(0))}</b> per pulk dag 1 (utstyr + mat + brensel) – lettere for hver dag dere spiser{t.assumedKg > 0 ? `; ${kg1(t.assumedKg)} er antatt vekt` : ''}.</>
          : <>Ingen vekter i listen ennå – beregningen bruker din manuelle pulkvekt ({st.pulkKg} kg). Legg inn vekter for å regne med utstyr og mat.</>}
        {' '}<button className="link" onClick={measure}>Hva betyr 5 kg mer?</button>
      </p>
      {effect && <p className="small msg">{effect}</p>}
      </Advanced>

      {ins.advice.length > 0 && (
        <div className="advice">
          <h4>Anbefalinger for dette scenarioet</h4>
          {!detailed && ins.advice.filter((a) => a.level === 'mangler' || a.level === 'uegnet').length === 0 && <p className="small ok">Ingenting mangler for forholdene i planen.</p>}
          <p className="small muted">Basert på {ins.nights.length} netter ({[...new Set(ins.gearCtx.nightKinds.map((k) => k ?? 'ikke valgt'))].join(', ') || '–'}), ned mot {Math.round(ins.minTempC)} °C{ins.maxGust != null ? `, kast opptil ${Math.round(ins.maxGust)} m/s` : ''}, {ins.people} person(er){ins.gearCtx.steepTerrain ? ', bratt terreng' : ''}{ins.gearCtx.waterCrossings ? `, ${ins.gearCtx.waterCrossings} vannkryssinger` : ''}.</p>
          {ins.advice.filter((a) => detailed || a.level === 'mangler' || a.level === 'uegnet').map((a) => (
            <div key={a.key} className={`adv adv-${a.level}`}>
              <span className={`lv ${a.level === 'mangler' ? 'lv-viktig' : a.level === 'uegnet' ? 'lv-advarsel' : 'lv-info'}`}>{LEVEL_TEXT[a.level]}</span>
              <b>{a.text}</b> <span className="small muted">– {a.why}</span>
              {a.level === 'mangler' && a.cat && <button className="link small" onClick={() => add(a.text.replace(/\s*\(.*\)$/, ''), a.cat!, undefined, { tags: a.tag ? [a.tag] : undefined })}>legg til</button>}
            </div>
          ))}
        </div>
      )}

      <div className="packgrid">
        {cats.map((c) => (
          <div key={c} className="packcat">
            <h4>{c} <small className="muted">{kg1(list.items.filter((g) => g.cat === c).reduce((a, g) => a + (assumedKg(g) ?? 0) * g.qty, 0))}</small></h4>
            {list.items.filter((g) => g.cat === c).map((g) => (
              <div key={g.id} className="gearrow">
                <label className="chk"><input type="checkbox" checked={g.packed} onChange={(e) => upd(g.id, { packed: e.target.checked })} aria-label="Pakket" /></label>
                <input className="gname" value={g.name} onChange={(e) => upd(g.id, { name: e.target.value })} aria-label="Navn" />
                <input className="qty" type="number" min={0} value={g.qty} onChange={(e) => upd(g.id, { qty: +e.target.value })} aria-label="Antall" title="Antall" />
                <input className="kg" type="number" step="0.05" min={0} placeholder={assumedKg(g) != null ? `≈${assumedKg(g)}` : 'kg'} value={g.kg ?? ''} onChange={(e) => upd(g.id, { kg: e.target.value === '' ? undefined : +e.target.value })} aria-label="Vekt kg per stk" title="Vekt per stk (kg)" />
                <select value={g.carry} onChange={(e) => upd(g.id, { carry: e.target.value as GearItem['carry'] })} aria-label="Bæres i"><option value="pulk">pulk</option><option value="kropp">kropp</option></select>
                {owners.length > 1 && <select value={g.owner ?? 'felles'} onChange={(e) => upd(g.id, { owner: e.target.value })} aria-label="Eier">{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
                {/sovepose/i.test(g.name) && <input className="qty" type="number" value={g.ratingC ?? ''} placeholder="°C" onChange={(e) => upd(g.id, { ratingC: e.target.value === '' ? undefined : +e.target.value })} aria-label="Komforttemperatur" title="Komforttemperatur °C" />}
                {/\btelt\b|stormtelt/i.test(g.name) && <input className="qty" type="number" min={1} value={g.capacity ?? ''} placeholder="pers" onChange={(e) => upd(g.id, { capacity: e.target.value === '' ? undefined : +e.target.value })} aria-label="Personer" title="Plass til (personer)" />}
                <button className="link danger" onClick={() => confirm(`Fjerne «${g.name}» fra pakkelisten?`) && setList((l) => ({ ...l, items: l.items.filter((x) => x.id !== g.id) }))} aria-label={`Fjern ${g.name}`} title="Fjern fra listen">✕</button>
              </div>
            ))}
          </div>
        ))}
      </div>
      {!detailed && <p className="small muted">Antall, vekt, eier og bæremåte vises i <b>Detaljert</b> visning (knapp øverst).</p>}
      <div className="row">
        <select id="gear-new-cat" value={newItem.cat} onChange={(e) => setNewItem({ ...newItem, cat: e.target.value })} aria-label="Kategori">{GEAR_CATS.map((c) => <option key={c}>{c}</option>)}</select>
        <input id="gear-new-name" placeholder="Nytt utstyr" value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} />
        <input id="gear-new-kg" type="number" step="0.05" placeholder="kg" value={newItem.kg} onChange={(e) => setNewItem({ ...newItem, kg: e.target.value })} style={{ width: 80 }} />
        <button className="btn small" disabled={!newItem.name} onClick={() => { add(newItem.name, newItem.cat, newItem.kg === '' ? undefined : +newItem.kg); setNewItem({ ...newItem, name: '', kg: '' }); }}>Legg til</button>
        <button className="btn small ghost" onClick={() => confirm('Fjerne alle avkryssinger for «pakket»? Selve listen beholdes.') && setList((l) => ({ ...l, items: l.items.map((g) => ({ ...g, packed: false })) }))}>Nullstill pakket</button>
      </div>
      {st.team.length > 1 && (
        <p className="small muted">Per person: {owners.slice(1).map((o) => `${o.name} ${kg1(t.perOwner[o.id] ?? 0)}`).join(' · ')} · felles {kg1(t.perOwner.felles ?? 0)}</p>
      )}
    </Card>
  );
}
