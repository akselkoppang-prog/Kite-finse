import { useEffect, useState } from 'react';
import { readErrors, onErrors, clearErrors } from '../lib/errlog';
import { APP_VERSION, BUILD, versionLine } from '../lib/version';
import { useStore } from '../state/store';
import { SOURCES } from '../data/sources';
import { onSourceStatus, sourceStatus } from '../lib/api/http';
import { wmsLayers, type WmsLayer } from '../lib/api/nve';
import { Badge, Card, fmtTime } from '../components/ui';
import { runDiagnostics, type DiagResult } from '../lib/diagnostics';
import { useSave } from '../storage/persistence';
import { download } from '../lib/gpx';
import { elevCacheWarning } from '../lib/api/kartverket';

/** Versjon, byggeinformasjon og feillogg – det du trenger når noe skal feilsøkes. */
function AboutCard() {
  const [errs, setErrs] = useState(readErrors);
  const [copied, setCopied] = useState(false);
  useEffect(() => onErrors(() => setErrs(readErrors())), []);
  const report = () => [`Versjon: ${versionLine()} (${BUILD.channel})`, `Nettleser: ${navigator.userAgent}`, `Lagring: ${useSave.getState().state}${useSave.getState().error ? ` – ${useSave.getState().error}` : ''}`, `Tid: ${new Date().toISOString()}`, '', ...errs.map((e) => `${e.at} [${e.version}] ${e.where}: ${e.message}${e.stack ? `\n${e.stack}` : ''}`)].join('\n');
  return (
    <Card title="Om appen" className="wide" right={<span className="pill" id="about-version">Versjon {APP_VERSION}</span>}>
      <div className="kv small">
        <span>Versjon</span><b className="mono">{BUILD.version}</b>
        <span>Bygget</span><b>{new Date(BUILD.builtAt).toLocaleString('nb-NO', { dateStyle: 'medium', timeStyle: 'short' })} ({BUILD.builtAt.slice(0, 16).replace('T', ' ')} UTC)</b>
        <span>Kode</span><b className="mono">{BUILD.commit}{BUILD.dirty ? ' + lokale endringer' : ''}</b>
        <span>Type bygg</span><b>{BUILD.channel === 'publisert' ? 'Publisert (nummer reservert i byggeløypa)' : BUILD.channel === 'dev' ? 'Utviklingsserver' : BUILD.channel === 'lokal' ? 'Lokalt bygg (ikke publisert)' : BUILD.channel}</b>
      </div>
      <p className="small muted">Versjonen er datoen (UTC) pluss løpenummer for bygget den dagen. Den står også i alle eksporterte filer og er uavhengig av prosjektdataene dine.</p>
      <h4>Feillogg ({errs.length})</h4>
      {errs.length === 0 ? <p className="small muted">Ingen feil registrert i denne nettleseren.</p> : (
        <ul className="small list errlog">{errs.slice(0, 10).map((e, i) => <li key={i}><span className="muted">{new Date(e.at).toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'medium' })} · {e.version} · {e.where}</span><br />{e.message}</li>)}</ul>
      )}
      <div className="btns">
        <button className="btn small" onClick={async () => { try { await navigator.clipboard.writeText(report()); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { download('feilrapport.txt', report(), 'text/plain'); } }}>{copied ? 'Kopiert ✓' : 'Kopier feilrapport'}</button>
        {errs.length > 0 && <button className="btn small ghost" onClick={() => clearErrors()}>Tøm feilloggen</button>}
      </div>
      <p className="small muted">Feilrapporten inneholder versjon, nettleser og feilmeldinger – ingen prosjektdata.</p>
    </Card>
  );
}

function Diagnostics() {
  const frost = useStore((s) => s.frostClientId);
  const [res, setRes] = useState<DiagResult[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('kite.diag') || '[]');
    } catch {
      return [];
    }
  });
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const acc: DiagResult[] = [];
    await runDiagnostics(frost, (r) => {
      acc.push(r);
      setRes([...acc]);
    });
    try {
      localStorage.setItem('kite.diag', JSON.stringify(acc));
    } catch {
      /* */
    }
    setBusy(false);
  };
  return (
    <Card title="Live-diagnose av alle integrasjoner" className="wide" right={<button className="btn" onClick={run} disabled={busy}>{busy ? 'Tester…' : 'Kjør alle tester nå'}</button>}>
      <p className="small">Kjører <b>ekte</b> kall fra denne nettleseren mot Kartverket, NVE, MET og Varsom og kontrollerer svarformatet (feltnavn, koordinatrekkefølge, plausible verdier). Ingen testdata. Resultatet gjelder der du åpner appen – utviklingsmiljøet hadde ikke nettilgang til disse tjenestene.</p>
      {useSave.getState().error && <p className="err small">{useSave.getState().error}</p>}
      {elevCacheWarning && <p className="warn small">{elevCacheWarning}</p>}
      {res.length === 0 && <p className="small muted">Ikke kjørt ennå.</p>}
      <div className="diag">
        {res.map((r) => (
          <div key={r.id} className="diagrow">
            <div><Badge s={r.ok ? 'GRØNN' : r.checks.length && r.checks[0].text.startsWith('Hoppet') ? 'GRÅ' : 'RØD'}>{r.ok ? 'OK' : r.checks[0]?.text.startsWith('Hoppet') ? 'HOPPET OVER' : 'FEIL'}</Badge> <b>{r.name}</b> <span className="muted small">{Math.round(r.ms)} ms · {fmtTime(r.at)}</span></div>
            <ul className="small">
              {r.checks.map((c, i) => <li key={i} className={c.ok ? '' : 'err'}>{c.ok ? '✓' : '✗'} {c.text}</li>)}
              {r.error && <li className="err">✗ {r.error}</li>}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

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
      <AboutCard />
      <Diagnostics />
      <Card title="Datakilder og status" className="wide">
        <p className="small">
          Alle kall går direkte fra nettleseren din til offentlige tjenester. Ingen data er simulert. Hvis en tjeneste feiler, vises den som feil/GRÅ – og analysene som avhenger av den blir blokkert eller markert.
          Ingen av tjenestene krever API-nøkkel per nov. 2026.
        </p>
        <div className="tablewrap">
          <table className="tbl small">
            <thead><tr><th>Kilde</th><th>Type</th><th>Brukes til</th><th>Status nå</th><th>Siste OK</th><th>Datatid / art</th><th>Lisens</th><th>Notat fra research</th></tr></thead>
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
                      <div>sist kalt {fmtTime(st?.at)}</div>
                      {st?.ok === false && st?.message && <div className="err">{st.message}</div>}
                      {src.needsKey && <div className="warn">Krever nøkkel</div>}
                    </td>
                    <td>{fmtTime(st?.lastOkAt)}{st?.lastErrorAt && <div className="muted">siste feil {fmtTime(st.lastErrorAt)}</div>}</td>
                    <td>{st?.dataTime ? fmtTime(st.dataTime) : '–'}<div className="muted">{st?.nature ?? (src.kind === 'kartfliser' || src.kind === 'WMS' ? 'kartdata' : src.kind === 'brukerdata' ? 'manuell' : '–')}</div></td>
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
