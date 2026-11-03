import { useStore } from '../state/store';
import { useAcceptance } from './SafetyPage';
import { Badge, Card, fmtTime } from '../components/ui';
import { sourceStatus } from '../lib/api/http';
import { SOURCES } from '../data/sources';

const PHASES: { id: string; when: string; items: string[] }[] = [
  { id: 'nov', when: 'November/desember 2026', items: ['Ferdigstille konseptuell rute', 'Kartlegge magasiner og barrierer (NVE)', 'Undersøke alternative korridorer', 'Dokumentere reguleringsstatus for alle vann ruten krysser'] },
  { id: 'jan', when: 'Januar 2027', items: ['Oppdatere terreng- og rutedata (DTM-analyse på endelig rute)', 'Kontrollere logistikk og utstyr', 'Planlegge nød- og avbruddspunkter', 'Teste telt og kites med full pulk'] },
  { id: 'feb', when: 'Februar 2027', items: ['Kontrollere vær- og snøforhold (sesongtrend)', 'Oppdatere rutealternativer', 'Gjennomgå utstyr', 'Bestille tog Finse og transport ut fra Rjukan'] },
  { id: 'pre', when: '1–2 uker før avreise', items: ['Oppdatere vær (MET)', 'Oppdatere skredvarsel (Varsom)', 'Kontrollere vindprognoser', 'Kontrollere regulerte vann og aktuelle barrierer (regulant)', 'Kontrollere transport og nedstigning (Krossobanen/Ryes vei)'] },
  { id: 'dag', when: 'Avreisedagen', items: ['Endelig go/no-go'] },
];

export default function TimelinePage() {
  const s = useStore();
  const { accepted, items } = useAcceptance();
  const daysLeft = Math.ceil((new Date(s.tripDate).getTime() - Date.now()) / 86400000);
  return (
    <div className="page">
      <Card title={`Planleggingskalender · ${daysLeft} dager til ${s.tripDate}`} className="wide">
        <div className="timeline">
          {PHASES.map((p) => (
            <div key={p.id} className="phase">
              <h4>{p.when}</h4>
              {p.items.map((it, i) => {
                const id = `${p.id}-${i}`;
                return (
                  <label key={id} className="chk">
                    <input type="checkbox" checked={!!s.timeline[id]} onChange={(e) => s.set({ timeline: { ...s.timeline, [id]: e.target.checked } })} />
                    {it}
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      </Card>
      <Card title="Go / no-go (avreisedagen)" right={<Badge s={accepted ? 'GUL' : 'RØD'}>{accepted ? 'Datakontroller OK' : 'NO-GO'}</Badge>}>
        <ul className="gate small">
          {items.map((i) => <li key={i.text}><Badge s={i.status} /> {i.text}</li>)}
          <li><Badge s={s.checklist['varsom'] ? 'GRØNN' : 'GRÅ'} /> Skredvarsel lest siste døgn</li>
          <li><Badge s={s.checklist['met'] ? 'GRØNN' : 'GRÅ'} /> Vind-/værprognose for alle dager</li>
          <li><Badge s={s.checklist['kom'] ? 'GRØNN' : 'GRÅ'} /> Satellittkommunikasjon testet</li>
        </ul>
        <p className="small muted">GO er alltid din egen vurdering. Verktøyet kan bare si NO-GO når kjente data mangler eller viser barrierer.</p>
      </Card>
      <Card title="Dataferskhet">
        <ul className="small">
          {Object.values(SOURCES).filter((x) => x.kind === 'REST-API').map((src) => {
            const st = sourceStatus[src.id];
            return (
              <li key={src.id}>
                <Badge s={st?.ok ? 'GRØNN' : st?.ok === false ? 'RØD' : 'GRÅ'}>{st?.ok ? 'OK' : st?.ok === false ? 'feil' : 'ikke brukt'}</Badge> {src.provider}: {src.name} – sist {fmtTime(st?.at)}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
