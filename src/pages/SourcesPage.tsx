import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { SOURCES } from '../data/sources';
import { onSourceStatus, sourceStatus } from '../lib/api/http';
import { wmsLayers, type WmsLayer } from '../lib/api/nve';
import { Badge, Card, fmtTime } from '../components/ui';

function WmsConfigurator({ which, label, candidates }: { which: 'nve' | 'skred'; label: string; candidates: string[] }) {
  const s = useStore();
  const cfg = s.wms[which];
  const [layers, setLayers] = useState<WmsLayer[]>([]);
  const [err, setErr] = useState('');
  const [url, setUrl] = useState(cfg.url);
  const fetchCaps = async (u: string) => {
    setErr('');
    setLayers([]);
    try {
      const l = await wmsLayers(which === 'nve' ? 'nve-vannkraft-wms' : 'nve-skred-wms', u);
      setLayers(l);
      s.set({ wms: { ...s.wms, [which]: { url: u, layers: cfg.url === u ? cfg.layers : '' } } });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="wmscfg">
      <b>{label}</b>
      <div className="row">
        <input value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn small" onClick={() => fetchCaps(url)}>Hent lag</button>
      </div>
      <div className="small muted">Kandidater: {candidates.map((c) => <button key={c} className="link" onClick={() => { setUrl(c); fetchCaps(c); }}>{c.split('/services/')[1] ?? c}</button>)}</div>
      {err && <div className="err small">Feil: {err} – prøv en annen kandidat eller lim inn URL fra kartkatalog.nve.no</div>}
      {layers.length > 0 && (
        <select multiple size={Math.min(8, layers.length)} value={cfg.layers.split(',').filter(Boolean)} onChange={(e) => s.set({ wms: { ...s.wms, [which]: { url: cfg.url, layers: Array.from(e.target.selectedOptions).map((o) => o.value).join(',') } } })}>
          {layers.map((l) => <option key={l.name} value={l.name}>{l.title} ({l.name})</option>)}
        </select>
      )}
      <div className="small">Valgt: {cfg.layers || <i>ingen</i>}</div>
    </div>
  );
}

export default function SourcesPage() {
  const [, force] = useState(0);
  useEffect(() => onSourceStatus(() => force((x) => x + 1)) as unknown as () => void, []);
  const [vk, setVk] = useState(() => localStorage.getItem('kite.nveBase.vk') ?? '');
  const [lake, setLake] = useState(() => localStorage.getItem('kite.nveBase.lake') ?? '');
  return (
    <div className="page">
      <Card title="Datakilder og status" className="wide">
        <p className="small">
          Alle kall går direkte fra nettleseren din til offentlige tjenester. Ingen data er simulert. Hvis en tjeneste feiler, vises den som feil/GRÅ – og analysene som avhenger av den blir blokkert eller markert.
          Ingen av tjenestene krever API-nøkkel per nov. 2026.
        </p>
        <div className="tablewrap">
          <table className="tbl small">
            <thead><tr><th>Kilde</th><th>Type</th><th>Brukes til</th><th>Status</th><th>Lisens</th><th>Notat fra research</th></tr></thead>
            <tbody>
              {Object.values(SOURCES).map((src) => {
                const st = sourceStatus[src.id];
                return (
                  <tr key={src.id}>
                    <td><b>{src.provider}</b><br />{src.name}<div className="mono muted">{src.urls[0]}</div></td>
                    <td>{src.kind}</td>
                    <td>{src.usedFor}</td>
                    <td>
                      <Badge s={st?.ok ? 'GRØNN' : st?.ok === false ? 'RØD' : 'GRÅ'}>{st?.ok ? 'OK' : st?.ok === false ? 'Feil' : 'Ikke kalt'}</Badge>
                      <div>{fmtTime(st?.at)}</div>
                      {st?.message && <div className="err">{st.message}</div>}
                    </td>
                    <td>{src.license}</td>
                    <td>{src.researchNote}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Konfigurer NVE-tjenester">
        <WmsConfigurator which="nve" label="NVE Vannkraft WMS (kartlag)" candidates={SOURCES['nve-vannkraft-wms'].urls} />
        <WmsConfigurator which="skred" label="NVE Bratthet / snøskred WMS (kartlag)" candidates={SOURCES['nve-skred-wms'].urls} />
        <div className="wmscfg">
          <b>Overstyr ArcGIS REST-base (valgfritt)</b>
          <label className="small">Vannkraft MapServer<input value={vk} placeholder={SOURCES['nve-vannkraft-rest'].urls[0]} onChange={(e) => { setVk(e.target.value); e.target.value ? localStorage.setItem('kite.nveBase.vk', e.target.value) : localStorage.removeItem('kite.nveBase.vk'); }} /></label>
          <label className="small">Innsjødatabase MapServer<input value={lake} placeholder={SOURCES['nve-innsjo-rest'].urls[0]} onChange={(e) => { setLake(e.target.value); e.target.value ? localStorage.setItem('kite.nveBase.lake', e.target.value) : localStorage.removeItem('kite.nveBase.lake'); }} /></label>
        </div>
      </Card>
      <Card title="Ikke integrert (mangler åpent API / ikke funnet)">
        <ul className="small">
          <li><b>DNT / UT.no</b> – hytteinfo og åpningstider. Lenke: <a href="https://ut.no" target="_blank" rel="noreferrer">ut.no</a>. Plassholder: hytter hentes som stedsnavn fra Kartverket.</li>
          <li><b>NVE Atlas</b> (visuell kontroll av magasiner/HRV/LRV): <a href="https://atlas.nve.no" target="_blank" rel="noreferrer">atlas.nve.no</a></li>
          <li><b>Varsom Xgeo</b> (bratthet, skredhendelser, snødata): <a href="https://www.xgeo.no" target="_blank" rel="noreferrer">xgeo.no</a></li>
          <li><b>seNorge snødybde</b>: <a href="https://www.senorge.no" target="_blank" rel="noreferrer">senorge.no</a> – ikke integrert.</li>
          <li><b>Mobildekning</b>: operatørenes dekningskart – ikke integrert.</li>
        </ul>
      </Card>
      <Card title="Kategorier i appen">
        <ol className="small">
          <li><b>Kartdata</b>: Kartverket/NVE/MET slik tjenesten returnerer det.</li>
          <li><b>Forslag</b>: ruter og punkter (din GPX, rutekjeder, manuelle punkter).</li>
          <li><b>Beregnet</b>: distanser, profil-stats, helning, le, kite-vindu, scenarioer, auto-omveier.</li>
          <li><b>Uverifisert</b>: alt som ikke er kontrollert mot en kilde.</li>
          <li><b>Sjekk selv</b>: forhold du må kontrollere (åpningstider, brøyting, Krossobanen, produsentdata).</li>
        </ol>
      </Card>
    </div>
  );
}
