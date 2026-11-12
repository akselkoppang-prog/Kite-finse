import { useMemo, useState } from 'react';
import { strToU8 } from 'fflate';
import { useStore } from '../state/store';
import { useSave } from '../storage/persistence';
import { usePlanRuns, scenarioFile } from '../state/expedition';
import { routeOf } from '../lib/plan/context';
import { PRESETS, slug, type ExportPreset, type ExportPrefs } from '../lib/project/meta';
import { saveBeforeExport, takeSnapshot, type ExportSnapshot } from '../lib/export/snapshot';
import { download } from '../lib/gpx';
import { Card } from '../components/ui';

type Busy = { what: string; msg?: string } | null;

const INCLUDE: [keyof ExportPrefs, string][] = [
  ['maps', 'Kart'],
  ['profile', 'Høydeprofil'],
  ['weather', 'Vær og vind per dag'],
  ['kites', 'Kites og utstyr'],
  ['camps', 'Teltplasser'],
  ['waypoints', 'Punktbeskrivelser'],
  ['safety', 'Sikkerhet og varsler'],
  ['photos', 'Bilder'],
  ['assumptions', 'Modellforutsetninger'],
];

export default function ExportPage() {
  const plans = useStore((s) => s.plans);
  const mainId = useStore((s) => s.mainPlanId);
  const routes = useStore((s) => s.routes);
  const compareIds = useStore((s) => s.compareIds);
  const activeId = useStore((s) => s.activePlanId);
  const prefs = useStore((s) => s.exportPrefs);
  const project = useStore((s) => s.project);
  const set = useStore((s) => s.set);
  const saveState = useSave((s) => s.state);
  const projectId = useSave((s) => s.projectId);
  const [planId, setPlanId] = useState(mainId);
  const plan = plans.find((p) => p.id === planId) ?? plans[0];
  const scenRoute = useStore((s) => routeOf(s, plan));
  const [routeId, setRouteId] = useState<string>('');
  const [scope, setScope] = useState<'alle' | 'dag' | 'sammenligning'>('alle');
  const [day, setDay] = useState(1);
  const [gpx, setGpx] = useState<{ kind: 'hele' | 'dag' | 'alternativ' | 'segment'; day: number; alt: string; from: number; to: number; camps: boolean; wps: boolean; markers: boolean }>({ kind: 'hele', day: 1, alt: '', from: 0, to: 20, camps: true, wps: true, markers: true });
  const [gj, setGj] = useState({ alternatives: true, days: true, markers: true, camps: true, zones: true });
  const [withExports, setWithExports] = useState(true);
  const [busy, setBusy] = useState<Busy>(null);
  const [log, setLog] = useState<string[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const cmpIds = useMemo(() => [...new Set([activeId, ...compareIds])].filter((id) => plans.some((p) => p.id === id)), [activeId, compareIds, plans]);
  const runs = usePlanRuns([plan.id]);
  const days = runs[0]?.days ?? [];

  const upd = (p: Partial<ExportPrefs>) => set({ exportPrefs: { ...prefs, ...p } });
  const pickPreset = (k: ExportPreset) => upd({ preset: k, ...PRESETS[k].prefs });
  const base = `${slug(project.name)}_${slug(plan.name)}_${new Date().toISOString().slice(0, 10)}`;
  const effRouteId = routeId || scenRoute?.id;

  /** Lagre → ta øyeblikksbilde → bygg. Advarer hvis lagring ikke kunne bekreftes. */
  const run = async (what: string, fn: (snap: ExportSnapshot) => Promise<string>) => {
    setBusy({ what });
    try {
      const ok = await saveBeforeExport();
      if (!ok && !confirm('Siste endringer kunne ikke bekreftes lagret. Eksportere likevel? (Filen viser det du ser nå.)')) return;
      const snap = takeSnapshot({ planId: plan.id, routeId: effRouteId, prefs }, ok);
      const res = await fn(snap);
      setLog((l) => [`✓ ${res}`, ...l].slice(0, 8));
      useStore.getState().log('annet', `Eksport: ${res}`);
    } catch (e) {
      setLog((l) => [`❌ ${what}: ${(e as Error).message}`, ...l].slice(0, 8));
    } finally {
      setBusy(null);
    }
  };

  const makePdf = async (snap: ExportSnapshot, sc = scope) => {
    const { buildPdf } = await import('../lib/export/pdf');
    return buildPdf(snap, { scope: sc === 'dag' ? { kind: 'dag', day } : sc === 'sammenligning' ? { kind: 'sammenligning', ids: cmpIds } : { kind: 'alle' }, onProgress: (m) => setBusy({ what: 'PDF', msg: m }) });
  };

  const doPdf = () =>
    run('PDF', async (snap) => {
      const blob = await makePdf(snap);
      const name = `${base}${scope === 'dag' ? `_dag-${day}` : scope === 'sammenligning' ? '_sammenligning' : `_${prefs.preset}`}.pdf`;
      download(name, blob, 'application/pdf');
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(blob));
      return `${name} (${(blob.size / 1024).toFixed(0)} kB)`;
    });

  const doGpx = () =>
    run('GPX', async (snap) => {
      const { exportGpx } = await import('../lib/export/gpx');
      const r = exportGpx(snap, { kind: gpx.kind, day: gpx.day, routeId: gpx.alt, fromKm: gpx.from, toKm: gpx.to, withCamps: gpx.camps, withWaypoints: gpx.wps, withMarkers: gpx.markers });
      const name = `${base}_${slug(r.name)}.gpx`;
      download(name, r.xml, 'application/gpx+xml');
      return name;
    });

  const doGeo = () =>
    run('GeoJSON', async (snap) => {
      const { exportGeoJson } = await import('../lib/export/geojson');
      const name = `${base}.geojson`;
      download(name, JSON.stringify(exportGeoJson(snap, gj), null, 1), 'application/geo+json');
      return name;
    });

  const doXlsx = () =>
    run('Excel', async (snap) => {
      const { workbook } = await import('../lib/export/sheets');
      const { toXlsx } = await import('../lib/export/table');
      const data = toXlsx(workbook(snap, cmpIds.length > 1 ? cmpIds : []), { title: project.name });
      const name = `${base}.xlsx`;
      download(name, new Blob([data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      return `${name} (13 ark${cmpIds.length > 1 ? ' + sammenligning' : ''})`;
    });

  const doCsv = (which: 'rute' | 'dager' | 'vind' | 'punkter') =>
    run('CSV', async (snap) => {
      const S = await import('../lib/export/sheets');
      const { toCsv } = await import('../lib/export/table');
      const sh = which === 'rute' ? S.routeCoordSheet(snap) : which === 'dager' ? S.itinerarySheet(snap) : which === 'vind' ? S.windSheet(snap) : S.waypointSheet(snap, true);
      const name = `${base}_${slug(sh.name)}.csv`;
      download(name, toCsv(sh, prefs.csvLocale), 'text/csv;charset=utf-8');
      return name;
    });

  const doZip = () =>
    run('ZIP', async (snap) => {
      const { exportZip } = await import('../storage/archive');
      const extra: Record<string, Uint8Array> = {};
      let skipped = '';
      if (withExports) {
        // sikkerhetskopien skal ALLTID kunne lages – feiler de ferdige eksportene (f.eks. ingen rute), tas de bare ikke med
        try {
        setBusy({ what: 'ZIP', msg: 'Lager eksporter …' });
        const [{ exportGeoJson }, S, { toXlsx, toCsv }, { exportGpx }] = await Promise.all([import('../lib/export/geojson'), import('../lib/export/sheets'), import('../lib/export/table'), import('../lib/export/gpx')]);
        extra['rute.geojson'] = strToU8(JSON.stringify(exportGeoJson(snap, { alternatives: true, days: true, markers: true, camps: true, zones: true })));
        extra['ekspedisjon.xlsx'] = toXlsx(S.workbook(snap), { title: project.name });
        extra['dagsplan.csv'] = strToU8(toCsv(S.itinerarySheet(snap), prefs.csvLocale));
        extra['rutepunkter.csv'] = strToU8(toCsv(S.waypointSheet(snap, true), prefs.csvLocale));
        snap.run.days.forEach((d) => { if (!d.reason.startsWith('allerede')) extra[`dag-${d.day}.gpx`] = strToU8(exportGpx(snap, { kind: 'dag', day: d.day, withCamps: true, withWaypoints: true, withMarkers: false }).xml); });
        setBusy({ what: 'ZIP', msg: 'Lager PDF …' });
        extra['ekspedisjonsplan.pdf'] = new Uint8Array(await (await makePdf(snap, 'alle')).arrayBuffer());
        } catch (e) {
          skipped = ` (uten ferdige eksporter: ${(e as Error).message})`;
          for (const k of Object.keys(extra)) delete extra[k];
        }
      }
      setBusy({ what: 'ZIP', msg: 'Pakker prosjektet …' });
      const z = await exportZip(projectId, project.name, false, extra);
      const name = `${slug(project.name)}_prosjekt_${new Date().toISOString().slice(0, 10)}.zip`;
      download(name, z, 'application/zip');
      return `${name} (${(z.size / 1024 / 1024).toFixed(1)} MB) – kan importeres i en annen nettleser${skipped}`;
    });

  const doScenario = () =>
    run('Scenario', async () => {
      const name = `${slug(project.name)}_scenario_${slug(plan.name)}.json`;
      download(name, JSON.stringify(scenarioFile(plan.id), null, 2), 'application/json');
      return name;
    });

  const travelDays = days.filter((d) => !d.reason.startsWith('allerede'));
  return (
    <div className="page exportpage">
      <Card title="Hva skal eksporteres?" className="wide">
        <div className="pt-row">
          <label className="pt-field">Scenario
            <select id="exp-plan" value={plan.id} onChange={(e) => { setPlanId(e.target.value); setRouteId(''); }}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.id === mainId ? '★ ' : ''}{p.name}</option>)}
            </select>
          </label>
          <label className="pt-field">Rute
            <select id="exp-route" value={effRouteId ?? ''} onChange={(e) => setRouteId(e.target.value)}>
              {routes.map((r) => <option key={r.id} value={r.id}>{r.id === scenRoute?.id ? '(scenarioets) ' : ''}{r.name}</option>)}
            </select>
          </label>
        </div>
        <p className="small muted">Alle filer lages fra det lagrede scenarioet akkurat nå – regnet ut på nytt. Eksport endrer aldri prosjektet. {saveState === 'unsaved' || saveState === 'saving' ? <b className="warn">Ulagrede endringer lagres først.</b> : saveState === 'failed' ? <b className="err">Lagring feilet – du får spørsmål før eksport.</b> : <span className="ok">Alt er lagret.</span>}</p>
        {routeId && routeId !== scenRoute?.id && <p className="small warn">Du eksporterer scenarioet med en annen rute enn det bruker. Bare filen påvirkes.</p>}
      </Card>

      <Card title="📄 PDF – ekspedisjonsplan" className="wide">
        <div className="presets">
          {(Object.keys(PRESETS) as ExportPreset[]).map((k) => (
            <button key={k} className={`preset ${prefs.preset === k ? 'on' : ''}`} onClick={() => pickPreset(k)}>
              <b>{PRESETS[k].label}</b>
              <small>{PRESETS[k].text}</small>
            </button>
          ))}
        </div>
        <details className="small">
          <summary>Tilpass innhold ({INCLUDE.filter(([k]) => prefs[k]).length} av {INCLUDE.length} valgt)</summary>
          <div className="incgrid">
            {INCLUDE.map(([k, l]) => <label key={k} className="chk"><input type="checkbox" checked={!!prefs[k]} onChange={(e) => upd({ [k]: e.target.checked } as Partial<ExportPrefs>)} /> {l}</label>)}
            <label className="chk"><input type="checkbox" checked={prefs.landscapeMap} onChange={(e) => upd({ landscapeMap: e.target.checked })} /> Rutekart i liggende format</label>
          </div>
        </details>
        <div className="seg">
          <button className={`btn small ${scope === 'alle' ? 'on' : ''}`} onClick={() => setScope('alle')}>Hele turen</button>
          <button className={`btn small ${scope === 'dag' ? 'on' : ''}`} onClick={() => setScope('dag')}>Én dag</button>
          <button className={`btn small ${scope === 'sammenligning' ? 'on' : ''}`} onClick={() => setScope('sammenligning')} disabled={cmpIds.length < 2} title={cmpIds.length < 2 ? 'Velg scenarioer å sammenligne under Dagplan → Scenarioer' : undefined}>Sammenligning ({cmpIds.length})</button>
          {scope === 'dag' && <select id="exp-day" value={day} onChange={(e) => setDay(+e.target.value)}>{travelDays.map((d) => <option key={d.day} value={d.day}>Dag {d.day}</option>)}</select>}
        </div>
        <div className="btns">
          <button id="exp-pdf" className="btn primary big" onClick={doPdf} disabled={!!busy}>{busy?.what === 'PDF' ? `Lager PDF … ${busy.msg ?? ''}` : 'Lag PDF'}</button>
          {preview && <a className="btn ghost" href={preview} target="_blank" rel="noreferrer">Åpne siste PDF</a>}
        </div>
        <p className="small muted">Kartene hentes fra Kartverket når PDF-en lages. Uten nett tegnes ruten på et koordinatnett (aldri et oppdiktet terrengkart). Forhåndslast kartfliser under Oversikt for bruk offline.</p>
      </Card>

      <Card title="🧭 GPX – til Garmin og GPS">
        <div className="seg">
          {(['hele', 'dag', 'alternativ', 'segment'] as const).map((k) => <button key={k} className={`btn small ${gpx.kind === k ? 'on' : ''}`} onClick={() => setGpx({ ...gpx, kind: k, alt: gpx.alt || routes.find((r) => r.id !== scenRoute?.id)?.id || '' })} disabled={k === 'alternativ' && routes.length < 2}>{k === 'hele' ? 'Hele ruten' : k === 'dag' ? 'Én dag' : k === 'alternativ' ? 'Alternativ rute' : 'Del av ruten'}</button>)}
        </div>
        {gpx.kind === 'dag' && <select id="gpx-day" value={gpx.day} onChange={(e) => setGpx({ ...gpx, day: +e.target.value })}>{travelDays.map((d) => <option key={d.day} value={d.day}>Dag {d.day}: {((d.endD - d.startD) / 1000).toFixed(0)} km</option>)}</select>}
        {gpx.kind === 'alternativ' && <select value={gpx.alt} onChange={(e) => setGpx({ ...gpx, alt: e.target.value })}>{routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}
        {gpx.kind === 'segment' && <div className="row small">Fra km <input type="number" min={0} value={gpx.from} onChange={(e) => setGpx({ ...gpx, from: +e.target.value })} style={{ width: 80 }} /> til km <input type="number" min={0} value={gpx.to} onChange={(e) => setGpx({ ...gpx, to: +e.target.value })} style={{ width: 80 }} /></div>}
        <div className="incgrid small">
          <label className="chk"><input type="checkbox" checked={gpx.wps} onChange={(e) => setGpx({ ...gpx, wps: e.target.checked })} /> Rutepunkter med beskrivelser</label>
          <label className="chk"><input type="checkbox" checked={gpx.camps} onChange={(e) => setGpx({ ...gpx, camps: e.target.checked })} /> Teltplasser</label>
          <label className="chk"><input type="checkbox" checked={gpx.markers} onChange={(e) => setGpx({ ...gpx, markers: e.target.checked })} /> Egne markører</label>
        </div>
        <button id="exp-gpx" className="btn" onClick={doGpx} disabled={!!busy}>Last ned GPX</button>
        <p className="small muted">GPX 1.1 med full koordinatpresisjon og høyde der den finnes. Statuser, bilder og scenarioer kan ikke lagres i GPX – de ligger i prosjekt-ZIP-en.</p>
      </Card>

      <Card title="🗺️ GeoJSON – til GIS og kartapper">
        <div className="incgrid small">
          <label className="chk"><input type="checkbox" checked={gj.alternatives} onChange={(e) => setGj({ ...gj, alternatives: e.target.checked })} /> Alternative ruter</label>
          <label className="chk"><input type="checkbox" checked={gj.days} onChange={(e) => setGj({ ...gj, days: e.target.checked })} /> Dagsetapper</label>
          <label className="chk"><input type="checkbox" checked={gj.camps} onChange={(e) => setGj({ ...gj, camps: e.target.checked })} /> Teltplasser</label>
          <label className="chk"><input type="checkbox" checked={gj.markers} onChange={(e) => setGj({ ...gj, markers: e.target.checked })} /> Egne markører</label>
          <label className="chk"><input type="checkbox" checked={gj.zones} onChange={(e) => setGj({ ...gj, zones: e.target.checked })} /> Egne soner</label>
        </div>
        <button id="exp-geojson" className="btn" onClick={doGeo} disabled={!!busy}>Last ned GeoJSON</button>
        <p className="small muted">Standard GeoJSON (RFC 7946): WGS 84, [lengdegrad, breddegrad, høyde].</p>
      </Card>

      <Card title="📊 Excel og CSV">
        <button id="exp-xlsx" className="btn" onClick={doXlsx} disabled={!!busy}>Last ned Excel (.xlsx)</button>
        <p className="small muted">Ark: Oversikt · Dagsplan · Netter · Sjekkpunkter · Rutepunkter · Teltplasser · Vindscenarioer · Kites · Utstyr · Mat · Handleliste · Oppgaver · Forutsetninger{cmpIds.length > 1 ? ' · Sammenligning' : ''}.</p>
        <div className="btns">
          <button className="btn small ghost" onClick={() => doCsv('rute')} disabled={!!busy}>CSV: rutekoordinater</button>
          <button id="exp-csv-days" className="btn small ghost" onClick={() => doCsv('dager')} disabled={!!busy}>CSV: dagsplan</button>
          <button className="btn small ghost" onClick={() => doCsv('vind')} disabled={!!busy}>CSV: vindscenarioer</button>
          <button className="btn small ghost" onClick={() => doCsv('punkter')} disabled={!!busy}>CSV: rutepunkter</button>
        </div>
        <div className="seg small">
          <button className={`btn small ${prefs.csvLocale === 'no' ? 'on' : ''}`} onClick={() => upd({ csvLocale: 'no' })}>Norsk Excel (; og ,)</button>
          <button className={`btn small ${prefs.csvLocale === 'int' ? 'on' : ''}`} onClick={() => upd({ csvLocale: 'int' })}>Internasjonal (, og .)</button>
        </div>
      </Card>

      <Card title="📦 Komplett prosjekt (ZIP)">
        <p className="small">Alt i én fil: ruter (GPX), scenarioer, dagplaner, teltplasser, punkter, godkjenninger, notater, bilder og vedlegg. Kan åpnes i en annen nettleser eller på iPad via <b>Prosjekt → Importer</b>.</p>
        <label className="chk small"><input type="checkbox" checked={withExports} onChange={(e) => setWithExports(e.target.checked)} /> Ta med ferdige eksporter (PDF, GPX per dag, GeoJSON, Excel, CSV)</label>
        <button id="exp-zip" className="btn primary" onClick={doZip} disabled={!!busy}>{busy?.what === 'ZIP' ? `${busy.msg ?? 'Pakker …'}` : 'Last ned prosjekt-ZIP'}</button>
      </Card>

      <Card title="🤝 Del et scenario">
        <p className="small">Gi «{plan.name}» til en turvenn: én liten fil med scenarioet, ruten og teltplassene. Mottakeren importerer den som et nytt scenario uten at noe hos dem overskrives.</p>
        <button className="btn" onClick={doScenario} disabled={!!busy}>Last ned scenariofil</button>
        <p className="small muted">Vil du heller sende noe å lese? Lag en PDF med «{plan.name}» valgt øverst.</p>
      </Card>

      {log.length > 0 && (
        <Card title="Siste eksporter" className="wide">
          <ul className="small list" id="exp-log">{log.map((l, i) => <li key={i} className={l.startsWith('❌') ? 'err' : ''}>{l}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}
