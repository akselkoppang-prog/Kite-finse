import { useState } from 'react';
import { safeUrl } from '../lib/html';
import * as turf from '@turf/turf';
import { useStore } from '../state/store';
import { useActiveRoute, useBarrierCheck } from '../state/derived';
import { overrideState, reviewPending } from '../lib/analysis/overrides';
import { fmtCoord, fmtDM, uid } from '../lib/geo';
import { Badge, fmtTime } from './ui';
import type { LakeOverride, OverrideScope } from '../types';
import type { Barrier } from '../lib/analysis/barriers';

export function waterClass(b: Barrier, overridden: boolean): { text: string; status: 'RØD' | 'GUL' | 'BRUKER' | 'GRØNN' } {
  if (b.kind === 'sone') return { text: b.status === 'RØD' ? 'Forbudt / no-go-sone' : 'Usikker sone', status: b.status === 'RØD' ? 'RØD' : 'GUL' };
  if (overridden) return { text: 'Brukergodkjent (whitelist) – IKKE uavhengig verifisert', status: 'BRUKER' };
  if (b.label.startsWith('Bruker-dokumentert')) return { text: 'Dokumentert uregulert av deg (isforhold ukjent)', status: 'GUL' };
  if (/regulert/i.test(b.label) && !b.label.startsWith('IKKE')) return { text: 'Regulert vann', status: 'RØD' };
  return { text: 'Uverifisert vann', status: 'RØD' };
}

export default function LakePanel({ id }: { id: string }) {
  const s = useStore();
  const route = useActiveRoute();
  const check = useBarrierCheck(route);
  const b = check.barriers.find((x) => x.id === id);
  const mine = s.lakeOverrides.filter((o) => o.barrierKey === id);
  const crossings = check.crossings.filter((c) => c.barrier.id === id);
  const [scope, setScope] = useState<OverrideScope>('tur');
  const [note, setNote] = useState('');
  const [link, setLink] = useState('');
  const [expires, setExpires] = useState('');
  const [seasonFrom, setSeasonFrom] = useState('03-01');
  const [seasonTo, setSeasonTo] = useState('04-30');
  const [review, setReview] = useState(true);
  const [segMode, setSegMode] = useState<'alle' | 'strekning'>(crossings.length ? 'strekning' : 'alle');
  const [fromKm, setFromKm] = useState(crossings[0] ? Math.max(0, crossings[0].fromD / 1000 - 0.5).toFixed(1) : '0');
  const [toKm, setToKm] = useState(crossings[0] ? (crossings[0].toD / 1000 + 0.5).toFixed(1) : '0');
  const [err, setErr] = useState('');
  const [quickNote, setQuickNote] = useState('');
  const close = () => s.set({ selectedBarrier: null });

  if (!b) {
    const o = mine[0];
    return (
      <div className="drawer">
        <header><h3>{o?.name ?? 'Vann'}</h3><button className="btn small" onClick={close}>✕</button></header>
        <p className="small warn">Vannet er ikke i dataene som er lastet nå (last NVE-data på nytt). {mine.length} overstyring(er) er lagret.</p>
      </div>
    );
  }
  const centroid = (() => {
    try {
      const c = turf.centroid(b.feature as never).geometry.coordinates;
      return { lat: c[1], lon: c[0] };
    } catch {
      return { lat: 0, lon: 0 };
    }
  })();
  const activeOver = check.activeOverrideKeys.has(b.id);
  const wc = waterClass(b, activeOver);
  const updated = b.kind === 'magasin' ? check.hydroAt : b.kind === 'innsjø' ? check.lakesAt : undefined;

  const add = () => {
    if (b.kind === 'sone') return setErr('Egne forbudte soner kan ikke overstyres. Slett eller endre sonen i stedet.');
    if (note.trim().length < 10) return setErr('Skriv en personlig begrunnelse (minst 10 tegn): hvorfor er denne kryssingen akseptabel for deg, og under hvilke forhold?');
    const o: LakeOverride = {
      id: uid('ovr'),
      barrierKey: b.id,
      name: b.name,
      originalKind: b.kind as 'magasin' | 'innsjø',
      originalLabel: b.label,
      centroid,
      geometry: b.feature.geometry,
      scope,
      seasonFrom: scope === 'sesong' ? seasonFrom : undefined,
      seasonTo: scope === 'sesong' ? seasonTo : undefined,
      tripDate: scope === 'tur' ? s.tripDate : undefined,
      expires: expires || undefined,
      reviewRequired: review,
      note: note.trim(),
      sourceLink: link.trim() || undefined,
      segment: segMode === 'strekning' && route ? { routeId: route.id, routeName: route.name, fromKm: +fromKm, toKm: +toKm } : undefined,
      createdAt: new Date().toISOString(),
      active: true,
    };
    s.upsertOverride(o, `La ${b.name} i whitelist (${scope}${o.segment ? `, km ${fromKm}–${toKm} på ${route?.name}` : ', alle kryssinger'})`);
    setNote('');
    setErr('');
  };

  return (
    <div className="drawer">
      <header>
        <h3>{b.name}</h3>
        <button className="btn small" onClick={close} aria-label="Lukk">✕</button>
      </header>
      {b.kind !== 'sone' && crossings.length > 0 && route && (
        <div className="quick">
          {crossings.map((c, i) => {
            const approvedHere = c.label === 'BRUKERGODKJENT';
            return (
              <div key={i} className="quickrow">
                {approvedHere ? (
                  <>
                    <Badge s="BRUKER">USER APPROVED</Badge> Kryssing {(c.fromD / 1000).toFixed(1)}–{(c.toD / 1000).toFixed(1)} km
                    <button className="btn small ghost" onClick={() => c.override && s.upsertOverride({ ...c.override, active: false }, `Fjernet godkjenning av ${b.name} (km ${(c.fromD / 1000).toFixed(1)})`)}>Angre</button>
                  </>
                ) : c.hazards.length ? (
                  <span className="err small">Kryssing {(c.fromD / 1000).toFixed(1)} km kan ikke godkjennes: {c.hazards.join('; ')}</span>
                ) : (
                  <>
                    <button className="btn approve" onClick={() => {
                      const o: LakeOverride = {
                        id: uid('ovr'), barrierKey: b.id, name: b.name, originalKind: b.kind as 'magasin' | 'innsjø', originalLabel: b.label, centroid, geometry: b.feature.geometry,
                        scope: 'tur', tripDate: s.tripDate, reviewRequired: false, note: quickNote.trim() || '(godkjent uten notat)', active: true, createdAt: new Date().toISOString(),
                        segment: { routeId: route.id, routeName: route.name, fromKm: +(c.fromD / 1000 - 0.2).toFixed(2), toKm: +(c.toD / 1000 + 0.2).toFixed(2) },
                      };
                      s.upsertOverride(o, `GODKJENT FOR MIN RUTE: ${b.name}, km ${(c.fromD / 1000).toFixed(1)}–${(c.toD / 1000).toFixed(1)}`);
                    }}>✓ GODKJENN FOR MIN RUTE</button>
                    <span className="small">kryssing {(c.fromD / 1000).toFixed(1)}–{(c.toD / 1000).toFixed(1)} km ({Math.round(c.lengthM)} m)</span>
                  </>
                )}
              </div>
            );
          })}
          <input id="quick-note" placeholder="Valgfritt notat (f.eks. «kjent kryssing ved innløpet»)" value={quickNote} onChange={(e) => setQuickNote(e.target.value)} />
          <p className="small muted">Godkjenner bare denne kryssingen på denne turen ({s.tripDate}). Offisiell NVE-status endres ikke, og dammer/utløp/egne no-go-soner blokkerer fortsatt.</p>
        </div>
      )}
      <div className="kv small">
        <span>Klassifisering nå</span><b><Badge s={wc.status}>{wc.status === 'BRUKER' ? 'USER OVERRIDE' : wc.status}</Badge> {wc.text}</b>
        <span>Opprinnelig status</span><b>{b.label}</b>
        <span>Type</span><b>{b.kind === 'magasin' ? 'NVE reguleringsmagasin' : b.kind === 'innsjø' ? 'NVE innsjø' : 'Egen sone'}</b>
        <span>Koordinater (sentrum)</span><b className="mono">{fmtCoord(centroid)}<br />{fmtDM(centroid)}</b>
        <span>HRV / LRV</span><b>{b.hrv != null || b.lrv != null ? `${b.hrv ?? '–'} / ${b.lrv ?? '–'} moh` : 'ikke tilgjengelig'}</b>
        <span>Kilde</span><b>{b.source}</b>
        <span>Data oppdatert</span><b>{fmtTime(updated)}</b>
        <span>Kryssinger (aktiv rute)</span>
        <b>
          {crossings.length === 0 && 'Ingen'}
          {crossings.map((c, i) => (
            <div key={i}>
              {(c.fromD / 1000).toFixed(1)}–{(c.toD / 1000).toFixed(1)} km ({Math.round(c.lengthM)} m) · <Badge s={c.blocking ? 'RØD' : c.label === 'BRUKERGODKJENT' ? 'BRUKER' : 'GUL'}>{c.label}</Badge>
              {c.hazards.map((h) => <div key={h} className="err">⚠️ {h} – ikke overstyrbar</div>)}
            </div>
          ))}
        </b>
      </div>
      <p className="small note">Whitelist betyr at <b>du</b> har akseptert kryssingen i planen. Det betyr ikke at isen er kontrollert. NVE-statusen over endres aldri, og dammer, inntak og egne forbudte soner blokkerer fortsatt.</p>

      {mine.length > 0 && (
        <div>
          <h4>Dine overstyringer</h4>
          {mine.map((o) => (
            <OverrideRow key={o.id} o={o} />
          ))}
        </div>
      )}

      {b.kind !== 'sone' && (
        <details className="form1">
          <summary><b>Avansert whitelist</b> (sesong, permanent, utløp, gjennomgang, egen strekning)</summary>
          <label>Type
            <select id="ovr-scope" value={scope} onChange={(e) => setScope(e.target.value as OverrideScope)}>
              <option value="tur">Kun denne turen ({s.tripDate})</option>
              <option value="sesong">Sesong (gjentas hvert år)</option>
              <option value="permanent">Permanent personlig</option>
            </select>
          </label>
          {scope === 'sesong' && (
            <div className="row">
              <label>Fra (MM-DD)<input id="ovr-sf" value={seasonFrom} onChange={(e) => setSeasonFrom(e.target.value)} /></label>
              <label>Til (MM-DD)<input id="ovr-st" value={seasonTo} onChange={(e) => setSeasonTo(e.target.value)} /></label>
            </div>
          )}
          <label>Utløper / ny vurdering innen<input id="ovr-exp" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></label>
          <label className="chk"><input id="ovr-rev" type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> Krever manuell gjennomgang før avreise</label>
          <label>Gjelder
            <select id="ovr-seg" value={segMode} onChange={(e) => setSegMode(e.target.value as 'alle' | 'strekning')}>
              <option value="strekning">Kun en strekning av aktiv rute</option>
              <option value="alle">Alle kryssinger av dette vannet</option>
            </select>
          </label>
          {segMode === 'strekning' && (
            <div className="row">
              <label>Fra km<input id="ovr-from" type="number" step="0.1" value={fromKm} onChange={(e) => setFromKm(e.target.value)} /></label>
              <label>Til km<input id="ovr-to" type="number" step="0.1" value={toKm} onChange={(e) => setToKm(e.target.value)} /></label>
            </div>
          )}
          <label>Personlig begrunnelse (påkrevd)<textarea id="ovr-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="F.eks. kjenner strekningen, kryss kun ved innløpet når magasinet er fullt, sjekk overvann…" /></label>
          <label>Kilde / dokumentasjon (lenke)<input id="ovr-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" /></label>
          {err && <p className="err small">{err}</p>}
          <button className="btn" onClick={add}>✋ Legg til i whitelist</button>
        </details>
      )}
    </div>
  );
}

export function OverrideRow({ o }: { o: LakeOverride }) {
  const s = useStore();
  const st = overrideState(o, s.tripDate);
  const upd = (patch: Partial<LakeOverride>, text: string) => s.upsertOverride({ ...o, ...patch }, text);
  return (
    <div className="ovr">
      <div>
        <Badge s={st === 'aktiv' ? 'BRUKER' : 'GRÅ'}>{st === 'aktiv' ? 'USER OVERRIDE' : st}</Badge> <b>{o.name}</b> <span className="muted small">({o.originalKind}, opprinnelig: {o.originalLabel})</span>
      </div>
      <div className="small">
        {o.scope === 'permanent' ? 'Permanent' : o.scope === 'tur' ? `Tur ${o.tripDate}` : `Sesong ${o.seasonFrom}–${o.seasonTo}`}
        {o.expires && ` · utløper ${o.expires}`}
        {o.segment ? ` · km ${o.segment.fromKm}–${o.segment.toKm} på «${o.segment.routeName}»` : ' · alle kryssinger'}
        {' · '}lagt til {o.createdAt.slice(0, 10)}
      </div>
      <div className="small">📝 {o.note}</div>
      {o.sourceLink && <div className="small">🔗 {safeUrl(o.sourceLink) ? <a href={safeUrl(o.sourceLink)} target="_blank" rel="noreferrer">{o.sourceLink}</a> : o.sourceLink}</div>}
      {reviewPending(o) && <div className="small warn">Krever gjennomgang før avreise</div>}
      {o.reviewedAt && <div className="small muted">Gjennomgått {o.reviewedAt.slice(0, 10)}</div>}
      <div className="btns">
        {reviewPending(o) && <button className="btn small" onClick={() => upd({ reviewedAt: new Date().toISOString() }, `Gjennomgikk overstyring for ${o.name}`)}>Marker gjennomgått</button>}
        {o.active ? (
          <button className="btn small danger" onClick={() => upd({ active: false }, `Fjernet ${o.name} fra whitelist`)}>Fjern fra whitelist</button>
        ) : (
          <button className="btn small" onClick={() => upd({ active: true }, `Aktiverte ${o.name} i whitelist igjen`)}>Aktiver igjen</button>
        )}
        <button className="btn small ghost" onClick={() => s.focusOn(o.centroid.lat, o.centroid.lon, 12)}>Vis i kart</button>
      </div>
    </div>
  );
}
