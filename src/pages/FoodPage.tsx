import { useState } from 'react';
import { useStore } from '../state/store';
import { useExpedition, useInsights, updatePlan } from '../state/expedition';
import { SLOTS, SLOT_TEXT, ACTIVITY_KCAL, newFoodPlan, defaultDay, dayNutrition, mealNutrition, type Activity, type FoodPlan, type MealSlot, type FoodItem } from '../lib/project/model';
import { addDays } from '../lib/sun';
import { uid } from '../lib/geo';
import { Card } from '../components/ui';

const n0 = (v: number) => Math.round(v).toLocaleString('nb-NO');
const n1 = (v: number) => v.toFixed(1).replace('.', ',');

export default function FoodPage() {
  const st = useStore();
  const { plan } = useExpedition();
  const ins = useInsights();
  const f = ins.food;
  const fp: FoodPlan = plan.food ?? newFoodPlan(plan.days.length);
  const setFp = (fn: (x: FoodPlan) => FoodPlan) => updatePlan((p) => ({ ...p, food: fn(p.food ?? newFoodPlan(p.days.length)) }));
  const setMeal = (i: number, slot: MealSlot, id: string) => setFp((x) => {
    const days = [...x.days];
    while (days.length <= i) days.push(defaultDay());
    days[i] = { meals: { ...days[i].meals, [slot]: id || undefined } };
    return { ...x, days };
  });
  const date0 = plan.tripDate ?? st.tripDate;
  const [nf, setNf] = useState({ name: '', kcal: '', protein: '', fat: '', carbs: '', ml: '', packG: '' });
  const [tplEdit, setTplEdit] = useState<string | null>(null);
  const maxKg = Math.max(1, ...f.remainingKgByDay);

  return (
    <div className="page">
      <Card title={`Mat og vann – «${plan.name}»`} className="wide">
        <div className="pt-row">
          <label className="pt-field">Aktivitet
            <select id="food-activity" value={fp.activity} onChange={(e) => setFp((x) => ({ ...x, activity: e.target.value as Activity }))}>
              {(Object.keys(ACTIVITY_KCAL) as Activity[]).map((a) => <option key={a} value={a}>{a} ({ACTIVITY_KCAL[a]} kcal grunnbehov)</option>)}
            </select>
          </label>
          <label className="pt-field">Reservedøgn<input type="number" min={0} value={fp.reserveDays} onChange={(e) => setFp((x) => ({ ...x, reserveDays: +e.target.value }))} style={{ width: 80 }} /></label>
          <label className="pt-field">Vann l/person/dag<input type="number" step={0.5} min={1} value={fp.waterLPerPersonDay} onChange={(e) => setFp((x) => ({ ...x, waterLPerPersonDay: +e.target.value }))} style={{ width: 80 }} /></label>
          <label className="pt-field">Brensel l/person/dag<input type="number" step={0.05} min={0} value={fp.fuelLPerPersonDay} onChange={(e) => setFp((x) => ({ ...x, fuelLPerPersonDay: +e.target.value }))} style={{ width: 80 }} /></label>
          <div className="pt-field">Personer<b>{f.people}</b><small className="muted">{st.team.length ? 'fra teamet' : <button className="link" onClick={() => st.setTab('oppgaver')}>legg til team</button>}</small></div>
        </div>
        <div className="ov-grid food-tiles">
          <div><span>Behov per person/dag</span><b id="food-target">{n0(f.target)} kcal</b><small>{fp.activity}, ned mot {Math.round(ins.minTempC)} °C</small></div>
          <div><span>Matvekt totalt</span><b id="food-kg">{n1(f.totalKg)} kg</b><small>{f.totalDays} døgn × {f.people} pers.</small></div>
          <div><span>Volum</span><b>{n1(f.totalL)} l</b></div>
          <div><span>Vann per dag</span><b>{n1(f.waterLPerDay * f.people)} l</b><small>smeltes av snø</small></div>
          <div><span>Brensel</span><b>{n1(f.fuelL)} l</b><small>≈ {n1(f.fuelL * 0.75)} kg</small></div>
          <div><span>Mat ved start</span><b>{n1(f.remainingKgByDay[0] ?? 0)} kg</b><small>{ins.load.source === 'utstyrsliste' ? 'regnes med i pulkvekten' : 'legg inn utstyrsvekter for å regne med i pulken'}</small></div>
        </div>
        {f.shortDays.length > 0 && <p className="small warn">⚠️ Under 85 % av energibehovet: dag {f.shortDays.join(', ')}. Legg til mer energitett mat (nøtter, smør, sjokolade).</p>}
      </Card>

      <Card title="Måltider dag for dag (per person)" className="wide">
        <div className="tablewrap">
          <table className="foodtable">
            <thead><tr><th>Dag</th>{SLOTS.map((s) => <th key={s}>{SLOT_TEXT[s]}</th>)}<th>kcal</th><th>Protein</th><th>Vekt</th></tr></thead>
            <tbody>
              {Array.from({ length: f.totalDays }, (_, i) => {
                const day = fp.days[i] ?? fp.days[fp.days.length - 1] ?? defaultDay();
                const n = dayNutrition(day, st.meals, st.foods);
                const reserve = i >= plan.days.length;
                const night = ins.nights[i];
                return (
                  <tr key={i} className={reserve ? 'reserve' : ''}>
                    <th>{reserve ? `Reserve ${i - plan.days.length + 1}` : `Dag ${i + 1}`}<br /><small className="muted">{reserve ? '' : new Date(`${addDays(date0, i)}T12:00:00`).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}{night?.camp?.resupply ? ' · påfyll etterpå' : ''}</small></th>
                    {SLOTS.map((s) => (
                      <td key={s}>
                        <select value={day.meals[s] ?? ''} onChange={(e) => setMeal(i, s, e.target.value)} aria-label={`${SLOT_TEXT[s]} dag ${i + 1}`}>
                          <option value="">–</option>
                          {st.meals.filter((m) => m.slot === s).map((m) => <option key={m.id} value={m.id}>{m.name} ({n0(mealNutrition(m, st.foods).kcal)})</option>)}
                        </select>
                      </td>
                    ))}
                    <td><div className="kbar"><i style={{ width: `${Math.min(100, (100 * n.kcal) / f.target)}%`, background: n.kcal < f.target * 0.85 ? 'var(--yellow)' : 'var(--green)' }} /><span>{n0(n.kcal)}</span></div></td>
                    <td>{n0(n.protein)} g</td>
                    <td>{n0(n.g)} g</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted">Mål: {n0(f.target)} kcal per person per dag (aktivitet × kulde: +5 % per 10 °C under null, justert for kroppsvekt). Endringer gjelder bare dette scenarioet.</p>
      </Card>

      <Card title="Mat igjen underveis">
        <div className="remain">
          {f.remainingKgByDay.map((kg, i) => (
            <div key={i} className="rbar"><span>Dag {i + 1}</span><i style={{ width: `${(100 * kg) / maxKg}%` }} /><b>{n1(kg)} kg</b></div>
          ))}
        </div>
        <p className="small muted">Ved start av hver dag (hele gruppen). Påfyll ved overnattinger merket «påfyll» under Dagplan → Overnatting.</p>
      </Card>

      <Card title="Handleliste">
        <table className="cmptable" id="shopping">
          <thead><tr><th>Vare</th><th>Mengde</th><th>Pakker</th></tr></thead>
          <tbody>{f.shopping.map((x) => <tr key={x.food.id}><td>{x.food.name}</td><td>{x.g >= 1000 ? `${n1(x.g / 1000)} kg` : `${n0(x.g)} g`}</td><td>{x.packs != null ? `${x.packs} × ${x.food.packG} g` : '–'}</td></tr>)}</tbody>
        </table>
        <p className="small muted">Inkluderer reservedøgn og alle personer.</p>
      </Card>

      <Card title="Måltidsmaler og matvarer" className="wide">
        <p className="small muted">Malene og matvarene deles av alle scenarioer i prosjektet.</p>
        <div className="tplgrid">
          {st.meals.map((m) => {
            const n = mealNutrition(m, st.foods);
            return (
              <div key={m.id} className="tpl">
                <div className="row"><b>{m.name}</b> <span className="pill">{SLOT_TEXT[m.slot]}</span> <span className="small muted">{n0(n.kcal)} kcal · {n0(n.protein)} g protein · {n0(n.g)} g</span> <button className="link small" onClick={() => setTplEdit(tplEdit === m.id ? null : m.id)}>{tplEdit === m.id ? 'ferdig' : 'endre'}</button></div>
                {tplEdit === m.id && (
                  <div className="small">
                    <input value={m.name} onChange={(e) => st.set({ meals: st.meals.map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x)) })} aria-label="Navn på mal" />
                    {m.items.map((it, k) => (
                      <div key={k} className="row">
                        <select value={it.foodId} onChange={(e) => st.set({ meals: st.meals.map((x) => (x.id === m.id ? { ...x, items: x.items.map((y, j) => (j === k ? { ...y, foodId: e.target.value } : y)) } : x)) })}>{st.foods.map((fd) => <option key={fd.id} value={fd.id}>{fd.name}</option>)}</select>
                        <input type="number" min={0} value={it.g} onChange={(e) => st.set({ meals: st.meals.map((x) => (x.id === m.id ? { ...x, items: x.items.map((y, j) => (j === k ? { ...y, g: +e.target.value } : y)) } : x)) })} style={{ width: 70 }} /> g
                        <button className="link danger" onClick={() => st.set({ meals: st.meals.map((x) => (x.id === m.id ? { ...x, items: x.items.filter((_, j) => j !== k) } : x)) })}>✕</button>
                      </div>
                    ))}
                    <button className="link" onClick={() => st.set({ meals: st.meals.map((x) => (x.id === m.id ? { ...x, items: [...x.items, { foodId: st.foods[0].id, g: 50 }] } : x)) })}>+ matvare</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="btns">
          {SLOTS.map((s) => <button key={s} className="btn small ghost" onClick={() => { const id = uid('meal'); st.set({ meals: [...st.meals, { id, name: `Ny ${SLOT_TEXT[s].toLowerCase()}`, slot: s, items: [] }] }); setTplEdit(id); }}>+ {SLOT_TEXT[s].toLowerCase()}</button>)}
        </div>
        <h4>Ny matvare (per 100 g)</h4>
        <div className="row small">
          <input placeholder="Navn" value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} />
          {(['kcal', 'protein', 'fat', 'carbs', 'ml', 'packG'] as const).map((k) => <input key={k} type="number" placeholder={{ kcal: 'kcal', protein: 'protein g', fat: 'fett g', carbs: 'karb. g', ml: 'ml', packG: 'g/pakke' }[k]} value={nf[k]} onChange={(e) => setNf({ ...nf, [k]: e.target.value })} style={{ width: 82 }} />)}
          <button className="btn small" disabled={!nf.name || !nf.kcal} onClick={() => { const it: FoodItem = { id: uid('food'), name: nf.name, kcal: +nf.kcal, protein: +nf.protein || 0, fat: +nf.fat || 0, carbs: +nf.carbs || 0, ml: +nf.ml || 150, packG: nf.packG ? +nf.packG : undefined }; st.set({ foods: [...st.foods, it] }); setNf({ name: '', kcal: '', protein: '', fat: '', carbs: '', ml: '', packG: '' }); }}>Legg til</button>
        </div>
      </Card>
    </div>
  );
}
