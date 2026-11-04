import { useState } from 'react';
import { useStore } from '../state/store';
import { useWarnings, LEVEL_TEXT, type Warning } from '../lib/warnings';

const PRESETS = ['Vurdert – jeg kjenner området', 'Personlig vurdert – akseptabelt for min planlagte rute', 'Sjekkes nærmere før avreise'];

function Row({ w }: { w: Warning }) {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(PRESETS[0]);
  const ack = (txt: string) => {
    s.set({ acks: { ...s.acks, [w.id]: `${txt} (${new Date().toISOString().slice(0, 10)})` } });
    s.log('annet', `Vurderte varsel «${w.title}»: ${txt}`);
    setOpen(false);
  };
  return (
    <div className={`warn-row lv-${w.level} ${w.ack ? 'acked' : ''}`}>
      <div className="warn-head">
        <span className={`lv lv-${w.level}`}>{LEVEL_TEXT[w.level]}</span>
        <b>{w.title}</b>
      </div>
      <div className="small">{w.text}</div>
      {w.ack && <div className="small ackline"><span className="badge b-BRUKER">VURDERT AV DEG</span> {w.ack} <button className="link" onClick={() => { const a = { ...s.acks }; delete a[w.id]; s.set({ acks: a }); }}>angre</button></div>}
      <div className="btns">
        {w.where && <button className="btn small ghost" onClick={() => s.focusOn(w.where!.lat, w.where!.lon, 13)}>Vis i kartet</button>}
        {w.action === 'godkjenn-vann' && w.barrierId && <button className="btn small" onClick={() => s.set({ tab: 'oversikt', selectedBarrier: w.barrierId!, selectedWp: null, selectedMarker: null, selectedCamp: null })}>Godkjenn kryssing…</button>}
        {!w.ack && w.level !== 'info' && <button className="btn small ghost" onClick={() => setOpen(!open)}>Merk som vurdert</button>}
      </div>
      {open && (
        <div className="ackform">
          <select value={PRESETS.includes(note) ? note : ''} onChange={(e) => setNote(e.target.value || note)} aria-label="Ferdig tekst">
            {PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
            <option value="">Egen tekst …</option>
          </select>
          <input value={note} onChange={(e) => setNote(e.target.value)} aria-label="Din vurdering" />
          <button className="btn small" onClick={() => ack(note || PRESETS[0])}>Lagre vurdering</button>
          <span className="small muted">Dette er din egen vurdering – ikke en offisiell kontroll.</span>
        </div>
      )}
    </div>
  );
}

/** Rådgivende varsler. Ingen av dem stopper planleggingen. */
export default function Warnings({ compact = false }: { compact?: boolean }) {
  const all = useWarnings();
  const [showAll, setShowAll] = useState(!compact);
  const [showInfo, setShowInfo] = useState(false);
  const open = all.filter((w) => !w.ack && w.level !== 'info');
  const count = (l: Warning['level']) => all.filter((w) => w.level === l && !w.ack).length;
  const list = all.filter((w) => showInfo || w.level !== 'info');
  return (
    <div className="warnings">
      <div className="warn-sum">
        <span className="lv lv-viktig">{count('viktig')} viktige</span>
        <span className="lv lv-advarsel">{count('advarsel')} advarsler</span>
        <span className="lv lv-info">{count('info')} info</span>
        {compact && <button className="link" onClick={() => setShowAll(!showAll)}>{showAll ? 'skjul' : 'vis alle'}</button>}
      </div>
      {(showAll ? list : open.slice(0, 3)).map((w) => <Row key={w.id} w={w} />)}
      {showAll && <label className="chk small"><input type="checkbox" checked={showInfo} onChange={(e) => setShowInfo(e.target.checked)} /> Vis også informasjon ({count('info')})</label>}
      <p className="small muted">Varslene er råd. Du kan planlegge, endre og simulere uansett.</p>
    </div>
  );
}
