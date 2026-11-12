import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { useSave, flush, switchProject } from '../storage/persistence';
import { listProjects, createProject, duplicateProject, updateProjectMeta, deleteProject, restoreDeletedProject } from '../storage/projects';
import { importProject } from '../storage/archive';
import { getDB, type ProjectRec } from '../storage/db';
import { putImage, useBlobUrl } from '../storage/blobs';
import { releaseImage } from '../storage/backup';
import { PROJECT_ICONS, STATUS_TEXT, type ProjectStatus } from '../lib/project/meta';
import { addDays } from '../lib/sun';
import { Card, fmtTime } from '../components/ui';
import { useUiPrefs } from '../state/uiprefs';

const fmtD = (d?: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');

function Cover({ id, icon, big = false }: { id?: string; icon: string; big?: boolean }) {
  const url = useBlobUrl(id);
  return <div className={`pcover ${big ? 'big' : ''}`}>{url ? <img src={url} alt="" /> : <span>{icon || '🪁'}</span>}</div>;
}

/** Prosjektopplysninger for det åpne prosjektet – alt lagres automatisk. */
function ProjectDetails() {
  const p = useStore((s) => s.project);
  const tripDate = useStore((s) => s.tripDate);
  const days = useStore((s) => s.plans.find((x) => x.id === s.mainPlanId)?.days.length ?? s.tripDays);
  const set = useStore((s) => s.set);
  const pid = useSave((s) => s.projectId);
  const [err, setErr] = useState('');
  const upd = (patch: Partial<typeof p>) => set({ project: { ...useStore.getState().project, ...patch } });
  const autoEnd = addDays(tripDate, days - 1);
  const detailed = useUiPrefs((x) => x.detailed);
  return (
    <Card title="Dette prosjektet" className={`wide projdetails ${detailed ? '' : 'pd-simple'}`} right={!detailed ? <span className="small muted">Bilde, ikon, status og notater: <b>Detaljert</b> visning</span> : undefined}>
      <div className="pd-grid">
        <div className="pd-cover">
          <Cover id={p.coverBlobId} icon={p.icon} big />
          <div className="btns">
            <label className="btn small filebtn">{p.coverBlobId ? 'Bytt forsidebilde' : '+ Forsidebilde'}<input id="proj-cover" type="file" accept="image/*" onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const old = p.coverBlobId;
                const img = await putImage(f, f.name, pid);
                upd({ coverBlobId: img.blobId, coverThumbId: img.thumbId });
                await flush();
                if (old && old !== img.blobId) void releaseImage(old);
              } catch (er) { setErr(`Kunne ikke lagre bildet: ${(er as Error).message}`); }
            }} /></label>
            {p.coverBlobId && <button className="btn small ghost" onClick={async () => { const old = p.coverBlobId!; upd({ coverBlobId: undefined, coverThumbId: undefined }); await flush(); void releaseImage(old); }}>Fjern bilde</button>}
          </div>
          <div className="iconpick" role="group" aria-label="Prosjektikon">
            {PROJECT_ICONS.map((ic) => <button key={ic} className={p.icon === ic ? 'on' : ''} onClick={() => upd({ icon: ic })} aria-label={`Ikon ${ic}`}>{ic}</button>)}
          </div>
          {err && <p className="small err">{err}</p>}
        </div>
        <div className="form1">
          <label>Prosjektnavn<input id="proj-title" className="big" value={p.name} onChange={(e) => upd({ name: e.target.value })} onBlur={(e) => !e.target.value.trim() && upd({ name: 'Uten navn' })} /></label>
          <label>Kort beskrivelse<textarea id="proj-desc" rows={2} value={p.description} onChange={(e) => upd({ description: e.target.value })} /></label>
          <div className="row2">
            <label>Fra<input id="proj-origin" value={p.origin} onChange={(e) => upd({ origin: e.target.value })} /></label>
            <label>Til (mål)<input id="proj-dest" value={p.destination} onChange={(e) => upd({ destination: e.target.value })} /></label>
          </div>
          <div className="row2">
            <label>Startdato<input id="proj-start" type="date" value={tripDate} onChange={(e) => e.target.value && set({ tripDate: e.target.value })} /></label>
            <label>Sluttdato<input id="proj-end" type="date" value={p.endDate ?? autoEnd} min={tripDate} onChange={(e) => upd({ endDate: e.target.value || undefined })} /><small className="muted">{p.endDate ? <button className="link" onClick={() => upd({ endDate: undefined })}>følg hovedplanen ({fmtD(autoEnd)})</button> : 'følger hovedplanen'}</small></label>
          </div>
          {detailed && <><label>Status
            <div className="seg">{(Object.keys(STATUS_TEXT) as ProjectStatus[]).map((k) => <button key={k} className={`btn small ${p.status === k ? 'on' : ''}`} onClick={() => upd({ status: k })}>{STATUS_TEXT[k]}</button>)}</div>
          </label>
          <label>Personlige notater<textarea id="proj-notes" rows={4} value={p.notes} onChange={(e) => upd({ notes: e.target.value })} placeholder="Tanker, avtaler, ting å huske …" /></label></>}
          <label>Kontakter og nødinformasjon (kommer med i PDF-en)<textarea id="proj-contacts" rows={3} value={p.contacts} onChange={(e) => upd({ contacts: e.target.value })} /></label>
        </div>
      </div>
    </Card>
  );
}

function ProjectCard({ p, active, onOpen, onAction }: { p: ProjectRec; active: boolean; onOpen: () => void; onAction: (a: 'rename' | 'dup' | 'archive' | 'delete') => void }) {
  return (
    <article className={`pcard ${active ? 'cur' : ''} ${p.archived ? 'arch' : ''}`}>
      <button className="pcard-main" onClick={onOpen} disabled={active} aria-label={`Åpne ${p.name}`}>
        <Cover id={p.coverThumbId} icon={p.icon ?? '🪁'} />
        <div className="pcard-txt">
          <b>{p.name}</b>
          <small>{p.status ? STATUS_TEXT[p.status as ProjectStatus] ?? p.status : 'Planlegging'}{p.tripDate ? ` · ${fmtD(p.tripDate)}` : ''}{p.days ? ` · ${p.days} dager` : ''}</small>
          {p.description && <small className="muted clamp2">{p.description}</small>}
          <small className="muted">Endret {fmtTime(p.updatedAt)}</small>
        </div>
        {active && <span className="pill edit">Åpent nå</span>}
        {p.archived && <span className="pill">Arkivert</span>}
      </button>
      <div className="btns">
        {!active && <button className="btn small" onClick={onOpen}>Åpne</button>}
        <button className="btn small ghost" onClick={() => onAction('rename')}>Gi nytt navn</button>
        <button className="btn small ghost" onClick={() => onAction('dup')}>Dupliser</button>
        <button className="btn small ghost" onClick={() => onAction('archive')}>{p.archived ? 'Hent fra arkiv' : 'Arkiver'}</button>
        {!active && <button className="btn small danger" onClick={() => onAction('delete')}>Slett</button>}
      </div>
    </article>
  );
}

export default function ProjectsPage() {
  const pid = useSave((s) => s.projectId);
  const savedName = useSave((s) => s.projectName);
  const [list, setList] = useState<ProjectRec[]>([]);
  const [deleted, setDeleted] = useState<{ id: string; name: string; at: string; backupId: string }[]>([]);
  const [showArch, setShowArch] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [nw, setNw] = useState<{ open: boolean; name: string; template: 'tom' | 'finse'; desc: string }>({ open: false, name: '', template: 'tom', desc: '' });
  const refresh = async () => {
    setList(await listProjects());
    const db = await getDB();
    const metas = (await db.getAll('meta')).filter((m) => m.key.startsWith('deletedProject:'));
    const projIds = new Set((await db.getAll('projects')).map((x) => x.id));
    setDeleted(metas.map((m) => ({ id: m.key.slice(15), ...(m.value as { name: string; at: string; backupId: string }) })).filter((d) => !projIds.has(d.id) && !(d as { restored?: boolean }).restored));
  };
  useEffect(() => { void refresh(); }, [pid, savedName]);
  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setMsg('');
    try { setMsg(await fn()); } catch (e) { setMsg(`❌ ${label}: ${(e as Error).message}`); } finally { setBusy(''); void refresh(); }
  };
  const act = (p: ProjectRec, a: 'rename' | 'dup' | 'archive' | 'delete') => {
    if (a === 'rename') {
      const n = prompt('Nytt navn på prosjektet', p.name);
      if (n && n.trim()) void run('Gi nytt navn', async () => { await updateProjectMeta(p.id, { name: n.trim() }); return `Prosjektet heter nå «${n.trim()}».`; });
    } else if (a === 'dup') {
      void run('Dupliser', async () => { await duplicateProject(p.id); return `Kopi av «${p.name}» laget. Originalen er uendret.`; });
    } else if (a === 'archive') {
      void run('Arkiver', async () => { await updateProjectMeta(p.id, { archived: !p.archived }); return p.archived ? `«${p.name}» er hentet fra arkivet.` : `«${p.name}» er arkivert (skjult i listen, ingenting slettet).`; });
    } else if (a === 'delete') {
      if (confirm(`Slette prosjektet «${p.name}» med ruter, scenarioer, teltplasser, notater og bilder?\n\nEn beskyttet sikkerhetskopi tas først, så du kan angre under «Nylig slettet».`)) void run('Slett', async () => { await deleteProject(p.id); return `«${p.name}» er slettet. Du kan gjenopprette det nederst på siden.`; });
    }
  };
  const visible = list.filter((p) => showArch || !p.archived || p.id === pid);
  const archived = list.filter((p) => p.archived).length;
  return (
    <div className="page">
      <ProjectDetails />
      <Card title={`Alle prosjekter (${list.length})`} className="wide" right={archived > 0 ? <label className="chk small"><input type="checkbox" checked={showArch} onChange={(e) => setShowArch(e.target.checked)} /> Vis arkiverte ({archived})</label> : undefined}>
        <p className="small muted">Hvert prosjekt har egne ruter, GPX, scenarioer, vind, kites, teltplasser, punkter, vann-godkjenninger, notater og eksportvalg. Å åpne et annet prosjekt lagrer det du har åpent først.</p>
        <div className="pgrid">
          {visible.map((p) => <ProjectCard key={p.id} p={p} active={p.id === pid} onOpen={() => void run('Åpne', async () => { await switchProject(p.id); useStore.getState().set({ tab: 'status' }); return `Åpnet «${p.name}».`; })} onAction={(a) => act(p, a)} />)}
        </div>
        {!nw.open ? (
          <div className="btns">
            <button className="btn" onClick={() => setNw({ ...nw, open: true, name: '' })}>+ Nytt prosjekt</button>
            <label className="btn ghost filebtn">Importer prosjekt (ZIP/JSON) …<input type="file" accept=".zip,.json,application/zip,application/json" onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              void run('Import', async () => { const r = await importProject(f, 'new', pid); await switchProject(r.projectId); useStore.getState().set({ tab: 'status' }); return `Importerte «${r.name}» som nytt prosjekt (${r.routes} ruter, ${r.images} bilder). Andre prosjekter er ikke endret.`; });
            }} /></label>
          </div>
        ) : (
          <div className="newproj form1">
            <label>Navn<input id="new-proj-name" autoFocus value={nw.name} placeholder="F.eks. Hardangervidda Snowkite Training" onChange={(e) => setNw({ ...nw, name: e.target.value })} /></label>
            <label>Kort beskrivelse<input value={nw.desc} onChange={(e) => setNw({ ...nw, desc: e.target.value })} /></label>
            <div className="seg">
              <button className={`btn small ${nw.template === 'tom' ? 'on' : ''}`} onClick={() => setNw({ ...nw, template: 'tom' })}>Tomt prosjekt (importer egen GPX)</button>
              <button className={`btn small ${nw.template === 'finse' ? 'on' : ''}`} onClick={() => setNw({ ...nw, template: 'finse' })}>Start med Finse–Rjukan-ruten</button>
            </div>
            <div className="btns">
              <button id="new-proj-ok" className="btn" disabled={!nw.name.trim() || !!busy} onClick={() => void run('Nytt prosjekt', async () => { await createProject({ name: nw.name, description: nw.desc, template: nw.template }); setNw({ ...nw, open: false }); useStore.getState().set({ tab: 'status' }); return `«${nw.name}» er opprettet og åpnet.${nw.template === 'tom' ? ' Importer en GPX under Kart → panelet «Rute og data».' : ''}`; })}>Opprett og åpne</button>
              <button className="btn ghost" onClick={() => setNw({ ...nw, open: false })}>Avbryt</button>
            </div>
          </div>
        )}
        {busy && <p className="small muted">{busy} …</p>}
        {msg && <p className="small msg">{msg}</p>}
      </Card>
      {deleted.length > 0 && (
        <Card title="Nylig slettet" className="wide">
          <ul className="small list">
            {deleted.map((d) => <li key={d.id}><b>{d.name}</b> · slettet {fmtTime(d.at)} <button className="link" onClick={() => void run('Gjenopprett', async () => { await restoreDeletedProject(d.backupId); const db = await getDB(); await db.put('meta', { key: `deletedProject:${d.id}`, value: { ...d, restored: true } }); return `«${d.name}» er gjenopprettet.`; })}>gjenopprett</button></li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}
