import { Advanced } from '../components/ux';
import { useStore } from '../state/store';
import { useActiveRoute, useBarrierCheck } from '../state/derived';
import { overrideState, reviewPending } from '../lib/analysis/overrides';
import { OverrideRow, waterClass } from '../components/LakePanel';
import { Badge, Card, fmtTime } from '../components/ui';

export default function OverridesPage() {
  const s = useStore();
  const route = useActiveRoute();
  const check = useBarrierCheck(route);
  const groups = {
    aktiv: s.lakeOverrides.filter((o) => overrideState(o, s.tripDate) === 'aktiv'),
    andre: s.lakeOverrides.filter((o) => overrideState(o, s.tripDate) !== 'aktiv'),
  };
  const counts = check.barriers.reduce(
    (acc, b) => {
      const wc = waterClass(b, check.activeOverrideKeys.has(b.id));
      acc[wc.text] = (acc[wc.text] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  return (
    <div className="page">
      <Card title="Vann-overstyringer (whitelist)" className="wide" right={<Badge s="BRUKER">{groups.aktiv.length} aktive</Badge>}>
        <p className="small">
          En overstyring betyr at <b>du</b> har akseptert en kryssing i planen. Verktøyet har ikke kontrollert isen. NVE-status og opprinnelige advarsler vises fortsatt, og dammer, inntak og egne forbudte soner blokkerer uansett.
          Klikk et vann i kartet for å legge til en overstyring.
        </p>
        <h4>Aktive for turen {s.tripDate}</h4>
        {groups.aktiv.length === 0 && <p className="small muted">Ingen.</p>}
        {groups.aktiv.map((o) => <OverrideRow key={o.id} o={o} />)}
        <h4>Utløpt, utenfor periode eller deaktivert</h4>
        {groups.andre.length === 0 && <p className="small muted">Ingen.</p>}
        {groups.andre.map((o) => <OverrideRow key={o.id} o={o} />)}
        <p className="small warn">{s.lakeOverrides.filter(reviewPending).length} overstyring(er) krever gjennomgang før avreise. Disse vises som uløste advarsler i Turoversikt og go/no-go.</p>
      </Card>

      <Card title="Vannklasser på aktiv rute">
        <ul className="small legend-list">
          <li><Badge s="GRØNN">VERIFISERT</Badge> Automatisk verifisert uregulert vann – <i>ingen åpen kilde gir dette; vises derfor ikke</i></li>
          <li><Badge s="RØD">REGULERT</Badge> Regulert vann (NVE-magasin eller publisert kilde)</li>
          <li><Badge s="RØD">UVERIFISERT</Badge> Uverifisert vann – kryssing ikke tillatt i planen</li>
          <li><Badge s="GUL">DOKUMENTERT</Badge> Dokumentert uregulert av deg</li>
          <li><Badge s="BRUKER">USER OVERRIDE</Badge> Brukergodkjent (whitelist)</li>
          <li><Badge s="RØD">NO-GO</Badge> Forbudt sone (rød skravur) – kan ikke overstyres</li>
        </ul>
        <div className="kv small">
          {Object.entries(counts).flatMap(([k, v]) => [<span key={`k${k}`}>{k}</span>, <b key={`v${k}`}>{v}</b>])}
        </div>
        <p className="small muted">NVE-data hentet {fmtTime(check.hydroAt)} / {fmtTime(check.lakesAt)}.</p>
      </Card>

      <Advanced className="wide" title="Endringslogg" hint="alle endringer du har gjort">
      <Card title="Endringslogg">
        <div className="tablewrap" style={{ maxHeight: 360 }}>
          <table className="tbl small">
            <thead><tr><th>Tid</th><th>Type</th><th>Endring</th></tr></thead>
            <tbody>
              {s.history.slice(0, 150).map((h, i) => (
                <tr key={i}><td>{fmtTime(h.at)}</td><td>{h.kind}</td><td>{h.text}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        {s.history.length === 0 && <p className="small muted">Ingen endringer logget ennå.</p>}
      </Card>
      </Advanced>
    </div>
  );
}
