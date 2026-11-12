import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { searchPlace, elevations, type PlaceCandidate } from '../lib/api/kartverket';
import { densify, haversine, type LatLon } from '../lib/geo';
import { buildWaypoints, lengthM, parseCoords, validateDraft, type DraftPt, type RouteDraft, type Step } from '../lib/route/draft';
import * as B from '../lib/route/builder';
import { download, routeProblem, toGpx } from '../lib/gpx';
import { slug } from '../lib/project/meta';

/**
 * Ruteveiviseren: 1 Start · 2 Mål · 3 Mellompunkter · 4 Linje · 5 Lagre · 6 Eksporter.
 * Ligger over kartet, så kartet alltid er synlig og kan trykkes i.
 */
const STEPS: [Step, string][] = [[1, 'Start'], [2, 'Mål'], [3, 'Punkter'], [4, 'Linje'], [5, 'Lagre'], [6, 'GPX']];
const fmtKm = (m: number) => `${(m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',')} km`;
const fmtLL = (p: LatLon) => `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;

/** Tre måter å velge et punkt på: trykk i kartet, søk på stedsnavn, eller skriv koordinater. */
function PointPicker({ label, onPick, mapHint }: { label: string; onPick: (p: LatLon, src: 'søk' | 'koordinater', name?: string) => void; mapHint: string }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<PlaceCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [coord, setCoord] = useState('');
  const [cmsg, setCmsg] = useState<{ ok: boolean; text: string } | null>(null);
  const search = async () => {
    if (q.trim().length < 2) { setErr('Skriv minst to bokstaver.'); return; }
    setBusy(true); setErr(''); setRes(null);
    try {
      const r = await searchPlace(q.trim());
      setRes(r);
      if (!r.length) setErr(`Fant ingen steder som heter «${q.trim()}». Prøv et annet navn, eller trykk i kartet.`);
    } catch (e) {
      setErr(`Søket feilet: ${(e as Error).message}. Stedsnavnsøk krever nett – du kan fortsatt trykke i kartet eller skrive koordinater.`);
    } finally { setBusy(false); }
  };
  const applyCoord = () => {
    const r = parseCoords(coord);
    if ('error' in r) { setCmsg({ ok: false, text: r.error }); return; }
    setCmsg({ ok: true, text: r.note ?? `Satt til ${fmtLL(r)}.` });
    onPick(r, 'koordinater');
    setCoord('');
  };
  return (
    <div className="picker">
      <p className="rb-hint">👆 {mapHint}</p>
      <div className="pk-row">
        <input className="pk-q" value={q} placeholder="Søk stedsnavn, f.eks. Finse" aria-label={`Søk etter ${label}`} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
        <button className="btn small" onClick={search} disabled={busy}>{busy ? 'Søker …' : 'Søk'}</button>
      </div>
      {err && <p className="small warn">{err}</p>}
      {res && res.length > 0 && (
        <ul className="pk-res" aria-label="Søkeresultater">
          {res.slice(0, 8).map((c, i) => (
            <li key={i}><button className="link" onClick={() => { onPick(c, 'søk', c.name); setRes(null); setQ(''); }}>{c.name} <span className="muted small">{c.type}{c.kommune ? ` · ${c.kommune}` : ''}</span></button></li>
          ))}
        </ul>
      )}
      <div className="pk-row">
        <input className="pk-c" value={coord} placeholder="Koordinater: 60.6012, 7.5034" aria-label={`Koordinater for ${label}`} onChange={(e) => setCoord(e.target.value)} onKeyDown={(e) => e.key === "Enter" && applyCoord()} />
        <button className="btn small" onClick={applyCoord} disabled={!coord.trim()}>Bruk</button>
      </div>
      {cmsg && <p className={`small ${cmsg.ok ? 'ok' : 'warn'}`}>{cmsg.text}</p>}
    </div>
  );
}

function PointCard({ p, kind, onClear }: { p?: DraftPt; kind: 'start' | 'finish'; onClear: () => void }) {
  const focusOn = useStore((s) => s.focusOn);
  if (!p) return <div className={`ptcard empty ${kind}`}><span className={`dpin ${kind === 'start' ? 'dp-start' : 'dp-finish'} mini`}>{kind === 'start' ? 'S' : 'M'}</span><span className="muted">{kind === 'start' ? 'Ingen start valgt ennå' : 'Ikke valgt mål ennå'}</span></div>;
  return (
    <div className={`ptcard ${kind}`}>
      <span className={`dpin ${kind === 'start' ? 'dp-start' : 'dp-finish'} mini`}>{kind === 'start' ? 'S' : 'M'}</span>
      <div className="ptc-main">
        <input className="ptc-name" value={p.name ?? ''} placeholder={kind === 'start' ? 'Navn på start (valgfritt)' : 'Navn på mål (valgfritt)'} aria-label={kind === 'start' ? 'Navn på start' : 'Navn på mål'} onChange={(e) => B.renamePoint(p.id, e.target.value)} />
        <small className="muted">{fmtLL(p)} · {({ kart: 'valgt i kartet', søk: 'fra søk', koordinater: 'skrevet inn', rute: 'fra ruten' } as const)[p.src]}</small>
      </div>
      <button className="iconbtn" title="Vis i kartet" onClick={() => focusOn(p.lat, p.lon, 13)}>🔍</button>
      <button className="iconbtn" title={kind === 'start' ? 'Fjern start' : 'Fjern mål'} aria-label={kind === 'start' ? 'Fjern start' : 'Fjern mål'} onClick={onClear}>✕</button>
    </div>
  );
}

function useElevation(pts: LatLon[]) {
  const [st, setSt] = useState<{ up: number; down: number; min: number; max: number } | 'laster' | string | null>(null);
  const key = pts.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(';');
  useEffect(() => {
    if (pts.length < 2) { setSt(null); return; }
    let dead = false;
    const t = setTimeout(async () => {
      setSt('laster');
      try {
        const len = lengthM(pts);
        const samples = densify(pts, Math.max(250, len / 300));
        const z = (await elevations(samples)).map((e) => e.z).filter((v): v is number => v != null);
        if (dead) return;
        if (z.length < 2) { setSt('Høydedata mangler for dette området.'); return; }
        let up = 0, down = 0;
        for (let i = 1; i < z.length; i++) { const d = z[i] - z[i - 1]; if (d > 0) up += d; else down -= d; }
        setSt({ up, down, min: Math.min(...z), max: Math.max(...z) });
      } catch (e) {
        if (!dead) setSt(`Høyde kunne ikke hentes (${(e as Error).message}). Krever nett – ruten kan lagres likevel.`);
      }
    }, 600);
    return () => { dead = true; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return st;
}

export default function RouteBuilder() {
  const d = useStore((s) => s.routeDraft) as RouteDraft | null;
  const routes = useStore((s) => s.routes);
  const plan = useStore((s) => s.plans.find((p) => p.id === s.activePlanId) ?? s.plans[0]);
  const camps = useStore((s) => s.camps);
  const [err, setErr] = useState('');
  const [min, setMin] = useState(false);
  const ref = d && d.geometry !== 'rett' ? routes.find((r) => r.id === d.geometry) : undefined;
  const preview = useMemo(() => (d ? buildWaypoints(d, ref) : []), [d, ref]);
  const elev = useElevation(d && d.step >= 4 ? preview : []);
  if (!d) return null;
  const errs = validateDraft(d);
  const len = lengthM(preview);
  const speed = plan?.days[0]?.speedKmh ?? 20;
  const others = routes.filter((r) => r.id !== d.editId && r.waypoints.length > 1);
  const followed = ref && preview.length > 0 ? preview.filter((w) => w.source.startsWith('Fulgt linjen')).length : 0;
  const saved = d.editId ? routes.find((r) => r.id === d.editId) : undefined;
  const canNext = d.step === 1 ? !!d.start : d.step === 2 ? !!d.finish : true;

  const save = () => {
    setErr('');
    try { B.saveDraft(); } catch (e) { setErr((e as Error).message); }
  };
  const exportGpx = () => {
    setErr('');
    if (!saved) return;
    const p = routeProblem(saved);
    if (p) { setErr(p); return; }
    try { download(`${slug(saved.name) || 'rute'}.gpx`, toGpx([saved], camps, [])); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <aside className={`rbuilder ${min ? 'min' : ''}`} id="route-builder" aria-label="Ruteveiviser">
      <header className="rb-head">
        <b>{d.editId && !d.savedAt ? `Rediger rute` : d.savedAt ? 'Rute lagret' : 'Ny rute'}</b>
        <span className="rb-tools">
          <button className="iconbtn" onClick={B.undo} disabled={!d.past.length} title="Angre (siste endring av punkter)" aria-label="Angre">↶</button>
          <button className="iconbtn" onClick={B.redo} disabled={!d.future.length} title="Gjør om" aria-label="Gjør om">↷</button>
          <button className="iconbtn" onClick={() => setMin(!min)} title={min ? 'Vis veiviseren' : 'Minimer – se mer av kartet'} aria-label={min ? 'Vis veiviseren' : 'Minimer'}>{min ? '▴' : '▾'}</button>
          <button className="iconbtn" onClick={() => { if (d.savedAt || (!d.past.length && !d.editId) || confirm('Lukke veiviseren? Endringer som ikke er lagret, forsvinner.')) B.cancelDraft(); }} title="Lukk" aria-label="Lukk veiviseren">✕</button>
        </span>
      </header>
      {!min && (
        <>
          <ol className="rb-steps" aria-label="Steg">
            {STEPS.map(([n, l]) => {
              const done = n === 1 ? !!d.start : n === 2 ? !!d.finish : n === 5 ? !!d.savedAt : n === 6 ? false : n < d.step;
              return (
                <li key={n}>
                  <button className={`rbs ${d.step === n ? 'on' : ''} ${done ? 'done' : ''}`} disabled={n === 6 && !d.savedAt} aria-current={d.step === n ? 'step' : undefined} onClick={() => B.setStep(n)}>
                    <span>{done && d.step !== n ? '✓' : n}</span>{l}
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="rb-body">
            {d.step === 1 && (
              <>
                <h4>Hvor starter dere?</h4>
                <PointCard p={d.start} kind="start" onClear={B.clearStart} />
                <PointPicker label="start" mapHint={d.start ? 'Trykk i kartet for å flytte starten hit, eller dra START-merket.' : 'Trykk i kartet der dere starter.'} onPick={(p, src, name) => B.setStart(p, src, name)} />
              </>
            )}
            {d.step === 2 && (
              <>
                <h4>Hvor er målet?</h4>
                <PointCard p={d.finish} kind="finish" onClear={B.clearFinish} />
                <PointPicker label="mål" mapHint={d.finish ? 'Trykk i kartet for å flytte målet hit, eller dra MÅL-merket.' : 'Trykk i kartet der turen slutter.'} onPick={(p, src, name) => B.setFinish(p, src, name)} />
                {d.start && d.finish && <button className="link small" onClick={B.swapEnds}>⇅ Bytt om start og mål</button>}
              </>
            )}
            {d.step === 3 && (
              <>
                <h4>Hvordan vil dere komme dit?</h4>
                <p className="small muted">Legg inn punkter ruten skal innom – eller hopp over for en rett linje fra start til mål. Nye punkter settes inn der de gir minst omvei; bruk pilene for å endre rekkefølgen.</p>
                <ol className="rb-seq">
                  <li className="seq-end"><span className="dpin dp-start mini">S</span> {d.start ? d.start.name ?? fmtLL(d.start) : <button className="link" onClick={() => B.setStep(1)}>Velg start</button>}</li>
                  {d.kept && (
                    <li className="seq-kept">
                      <span className="muted">↧ {d.kept.length} detaljerte punkter fra den lagrede ruten beholdes</span>
                      <button className="link small" onClick={() => confirm(`Erstatte de ${d.kept!.length} detaljerte punktene med egne mellompunkter? (Kan angres.)`) && B.dropKept()}>Erstatt med egne punkter</button>
                    </li>
                  )}
                  {d.via.map((v, i) => (
                    <li key={v.id} className="seq-via">
                      <span className="dpin dp-via mini">{i + 1}</span>
                      <input value={v.name ?? ''} placeholder={fmtLL(v)} aria-label={`Navn på punkt ${i + 1}`} onChange={(e) => B.renamePoint(v.id, e.target.value)} />
                      <button className="iconbtn" disabled={i === 0} onClick={() => B.moveVia(v.id, -1)} aria-label={`Flytt punkt ${i + 1} opp`} title="Tidligere i ruten">↑</button>
                      <button className="iconbtn" disabled={i === d.via.length - 1} onClick={() => B.moveVia(v.id, 1)} aria-label={`Flytt punkt ${i + 1} ned`} title="Senere i ruten">↓</button>
                      <button className="iconbtn danger" onClick={() => B.removeVia(v.id)} aria-label={`Slett punkt ${i + 1}`} title="Slett (kan angres med ↶)">✕</button>
                    </li>
                  ))}
                  <li className="seq-end"><span className="dpin dp-finish mini">M</span> {d.finish ? d.finish.name ?? fmtLL(d.finish) : <button className="link" onClick={() => B.setStep(2)}>Velg mål</button>}</li>
                </ol>
                {!d.via.length && !d.kept && <p className="small muted">Ingen mellompunkter – ruten går rett fra start til mål. Helt greit.</p>}
                <PointPicker label="mellompunkt" mapHint="Trykk i kartet for å legge til et punkt. Dra punktene for å flytte dem." onPick={(p, _src, name) => B.addVia(p, 'søk', name)} />
              </>
            )}
            {d.step === 4 && (
              <>
                <h4>Linjen mellom punktene</h4>
                <label className="rb-opt"><input type="radio" name="geom" checked={d.geometry === 'rett'} onChange={() => B.setDraft({ geometry: 'rett' })} /> <span><b>Rette linjer</b> mellom punktene (tegnet av deg)<small>På snø over fjellet finnes ingen veier å rute etter, så appen bruker ingen rutetjeneste. Legg til flere punkter for å følge terrenget tettere.</small></span></label>
                <label className="rb-opt"><input type="radio" name="geom" checked={d.geometry !== 'rett'} disabled={!others.length} onChange={() => others[0] && B.setDraft({ geometry: others[0].id })} /> <span><b>Følg linjen i en eksisterende rute</b> der punktene ligger nær den (innen 3 km)
                  {d.geometry !== 'rett' && <select aria-label="Rute å følge" value={d.geometry} onChange={(e) => B.setDraft({ geometry: e.target.value })}>{others.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}
                  {ref && <small>{followed ? `${followed} punkter hentet fra «${ref.name}».` : 'Punktene ligger for langt fra ruten – linjen blir rett.'}</small>}
                  {!others.length && <small>Ingen andre ruter i prosjektet.</small>}
                </span></label>
                <Summary d={d} len={len} n={preview.length} elev={elev} speed={speed} />
                <p className="small muted">Juster ruten ved å dra punktene i kartet, eller gå tilbake til steg 3.</p>
              </>
            )}
            {d.step === 5 && (
              <>
                <h4>Se over og lagre</h4>
                <label className="rb-field">Navn på ruten<input id="rb-name" value={d.name} onChange={(e) => B.setDraft({ name: e.target.value })} /></label>
                <Summary d={d} len={len} n={preview.length} elev={elev} speed={speed} />
                <label className="chk small"><input type="checkbox" checked={d.useInScenario} onChange={(e) => B.setDraft({ useInScenario: e.target.checked })} /> Bruk ruten i scenarioet «{plan?.name}» (dagsetapper, vær, overnatting)</label>
                {errs.length > 0 && (
                  <ul className="rb-errs" role="alert">{errs.map((e, i) => <li key={i}>{e.text} <button className="link" onClick={() => B.setStep(e.step)}>Gå til steg {e.step}</button></li>)}</ul>
                )}
                {d.savedAt && <p className="small ok">Lagret {new Date(d.savedAt).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}. Endringer lagres når du trykker «Lagre» igjen.</p>}
              </>
            )}
            {d.step === 6 && saved && (
              <>
                <h4>✓ «{saved.name}» er lagret</h4>
                <p className="small"><b>{saved.waypoints[0].name ?? 'Start'}</b> → <b>{saved.waypoints[saved.waypoints.length - 1].name ?? 'Mål'}</b> · {fmtKm(lengthM(saved.waypoints))} · {saved.waypoints.length} punkter. {d.useInScenario ? `Brukes i scenarioet «${plan?.name}».` : ''}</p>
                <button className="btn primary" id="rb-gpx" onClick={exportGpx}>⬇ Last ned GPX</button>
                <p className="small muted">GPX 1.1 med spor (hele linjen), rute (start → punkter → mål, for GPS-navigasjon) og START/MÅL-punkter. Åpnes i Garmin, Gaia, Locus, OsmAnd, Norgeskart m.fl.</p>
                <div className="btns"><button className="btn small" onClick={() => B.setStep(3)}>Rediger punkter</button><button className="btn small ghost" onClick={B.cancelDraft}>Ferdig</button></div>
              </>
            )}
            {err && <p className="small err" role="alert">❌ {err}</p>}
          </div>

          <footer className="rb-foot">
            {d.step > 1 && d.step < 6 && <button className="btn small ghost" onClick={() => B.setStep((d.step - 1) as Step)}>← Tilbake</button>}
            {d.step < 5 && <button className="btn small primary" id="rb-next" disabled={!canNext} onClick={() => B.setStep((d.step + 1) as Step)}>{d.step === 3 && !d.via.length && !d.kept ? 'Hopp over →' : 'Neste →'}</button>}
            {d.step === 5 && <button className="btn primary" id="rb-save" onClick={save} disabled={errs.length > 0}>{d.editId ? 'Lagre endringer' : 'Lagre rute'}</button>}
          </footer>
        </>
      )}
    </aside>
  );
}

function Summary({ d, len, n, elev, speed }: { d: RouteDraft; len: number; n: number; elev: ReturnType<typeof useElevation>; speed: number }) {
  const direct = d.start && d.finish ? haversine(d.start, d.finish) : 0;
  return (
    <div className="rb-sum" id="rb-summary">
      <div><span>Distanse</span><b>{len ? fmtKm(len) : '–'}</b><small>{direct && len ? `luftlinje ${fmtKm(direct)}` : ''}</small></div>
      <div><span>Stigning / fall</span><b>{typeof elev === 'object' && elev ? `${Math.round(elev.up)} / ${Math.round(elev.down)} m` : elev === 'laster' ? 'henter …' : '–'}</b><small>{typeof elev === 'object' && elev ? `${Math.round(elev.min)}–${Math.round(elev.max)} moh (DTM)` : typeof elev === 'string' && elev !== 'laster' ? elev : ''}</small></div>
      <div><span>Kitetid (grovt)</span><b>{len ? `${(len / 1000 / speed).toFixed(1).replace('.', ',')} t` : '–'}</b><small>ved {speed} km/t; dagplanen regner med vind, kryssing og pauser</small></div>
      <div><span>Punkter</span><b>{n}</b><small>{d.via.length ? `${d.via.length} mellompunkter` : d.kept ? `${d.kept.length} beholdt` : 'start og mål'} · {d.geometry === 'rett' ? 'rette linjer' : 'følger rute'}</small></div>
    </div>
  );
}
