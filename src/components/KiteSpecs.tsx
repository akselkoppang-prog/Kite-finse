import { useState } from 'react';
import { useStore } from '../state/store';
import { KITES } from '../data/kites';
import { KITE_SPECS, REFS, SPEC_FIELDS, type SpecKind, type SpecValue } from '../data/kiteSpecs';
import { Card } from './ui';

const KIND_STYLE: Record<SpecKind, { label: string; cls: string }> = {
  produsent: { label: 'produsent', cls: 'k-kartdata' },
  forhandler: { label: 'forhandler', cls: 'k-kartdata' },
  test: { label: 'test', cls: 'k-kartdata' },
  beregnet: { label: 'beregnet', cls: 'k-beregnet' },
  antakelse: { label: 'vurdering', cls: 'k-sjekk-selv' },
  ukjent: { label: 'ikke funnet', cls: 'k-uverifisert' },
  manuell: { label: 'manuell', cls: 'k-forslag' },
};

export function specOf(edits: Record<string, Record<string, SpecValue>>, kiteId: string, field: string): SpecValue {
  return edits[kiteId]?.[field] ?? KITE_SPECS[kiteId]?.[field] ?? { v: null, kind: 'ukjent' };
}

/** Kitedatabase: hver verdi med kildeart og lenke. Klikk en celle for å rette eller legge inn egne data. */
export default function KiteSpecs() {
  const s = useStore();
  const [edit, setEdit] = useState<{ k: string; f: string; v: string } | null>(null);
  const save = () => {
    if (!edit) return;
    const num = Number(edit.v.replace(',', '.'));
    const v: SpecValue = { v: edit.v.trim() === '' ? null : Number.isFinite(num) && /^[\d.,]+$/.test(edit.v.trim()) ? num : edit.v.trim(), kind: 'manuell', note: `Rettet ${new Date().toISOString().slice(0, 10)}` };
    s.set({ kiteSpecEdits: { ...s.kiteSpecEdits, [edit.k]: { ...(s.kiteSpecEdits[edit.k] ?? {}), [edit.f]: v } } });
    s.log('kite', `Rettet ${edit.f} for ${edit.k}: ${edit.v}`);
    setEdit(null);
  };
  return (
    <Card title="Kitedatabase – spesifikasjoner med kilder" className="wide">
      <p className="small">Verdiene er hentet fra produsent- og forhandlersider (websøk 2026-11-04) og merket med kildeart. <b>Produsentenes vindområder gjelder normalt vann og ~75–80 kg uten pulk</b>, og brukes bare som referanse i simulatoren. «Vurdering» = faglig vurdering, ikke data. Klikk en celle for å rette eller legge inn egne opplysninger (merkes «manuell»).</p>
      <div className="tablewrap">
        <table className="tbl small specs">
          <thead>
            <tr>
              <th>Felt</th>
              {KITES.map((k) => <th key={k.id}>{k.name.replace(/^(Flysurfer|Ozone|Naish) /, '')} {k.size}</th>)}
            </tr>
          </thead>
          <tbody>
            {SPEC_FIELDS.map(([f, label]) => (
              <tr key={f}>
                <td><b>{label}</b></td>
                {KITES.map((k) => {
                  const sv = specOf(s.kiteSpecEdits, k.id, f);
                  const st = KIND_STYLE[sv.kind];
                  const isEdit = edit?.k === k.id && edit.f === f;
                  return (
                    <td key={k.id} className="clickable" onClick={() => !isEdit && setEdit({ k: k.id, f, v: sv.v == null ? '' : String(sv.v) })}>
                      {isEdit ? (
                        <div className="row" onClick={(e) => e.stopPropagation()}>
                          <input autoFocus value={edit.v} onChange={(e) => setEdit({ ...edit, v: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && save()} />
                          <button className="btn small" onClick={save}>OK</button>
                          <button className="btn small ghost" onClick={() => setEdit(null)}>×</button>
                          {s.kiteSpecEdits[k.id]?.[f] && <button className="link" onClick={() => { const x = { ...(s.kiteSpecEdits[k.id] ?? {}) }; delete x[f]; s.set({ kiteSpecEdits: { ...s.kiteSpecEdits, [k.id]: x } }); setEdit(null); }}>tilbakestill</button>}
                        </div>
                      ) : (
                        <>
                          <div>{sv.v == null ? <span className="muted">–</span> : String(sv.v)}</div>
                          <span className={`kind ${st.cls}`}>{st.label}</span>
                          {sv.src && REFS[sv.src] && <a href={REFS[sv.src].url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={REFS[sv.src].name}> kilde</a>}
                          {sv.note && <div className="muted">{sv.note}</div>}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="small">
        <summary>Kildeliste ({Object.keys(REFS).length})</summary>
        <ul>{Object.entries(REFS).map(([id, r]) => <li key={id}><a href={r.url} target="_blank" rel="noreferrer">{r.name}</a></li>)}</ul>
      </details>
    </Card>
  );
}
