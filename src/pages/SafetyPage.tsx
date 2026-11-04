import { useState } from 'react';
import { useStore } from '../state/store';
import { useActiveRoute, useBarrierCheck, useTerrain, useDayPlan, useProfile } from '../state/derived';
import { overrideState, reviewPending } from '../lib/analysis/overrides';
import { bearing, angleDiff } from '../lib/geo';
import { WATERS, NOT_VERIFIED } from '../data/waters';
import { classify } from '../lib/analysis/terrain';
import { avalancheWarnings, type AvalancheWarning } from '../lib/api/varsom';
import { densify } from '../lib/geo';
import { Badge, Card, Kind, fmtTime } from '../components/ui';
import type { Status } from '../types';

export const CHECKLIST: { id: string; group: string; text: string }[] = [
  { id: 'nve-atlas', group: 'Vann', text: 'Alle vann langs endelig rute kontrollert i NVE Atlas / magasinregister (HRV/LRV, dammer, overføringer, inntak)' },
  { id: 'nve-tapping', group: 'Vann', text: 'Kontakt regulant (Statkraft m.fl.) om vintertapping/is langs Mår-, Kalhovd- og Gøysta-magasinene' },
  { id: 'rivers', group: 'Vann', text: 'Elver/bekker og utløp på ruten kontrollert (åpne råker, overvann)' },
  { id: 'varsom', group: 'Skred', text: 'Skredvarsel (Varsom) for aktuelle regioner lest siste døgn før avreise og hver kveld' },
  { id: 'bratthet', group: 'Skred', text: 'Bratthetskart (NVE / Varsom Xgeo) gjennomgått for alle bratte punkter og nedstigningen til Rjukan' },
  { id: 'regobs', group: 'Skred', text: 'Siste observasjoner i regObs/Varsom gjennomgått' },
  { id: 'met', group: 'Vær', text: 'MET-prognose (vind, kast, nedbør, sikt) og yr.no/Windy-ensemble for alle dager' },
  { id: 'whiteout', group: 'Navigasjon', text: 'Ruten lagt inn i GPS + papirkart (N50) + kompass; planlagte kurser for whiteout' },
  { id: 'batteri', group: 'Navigasjon', text: 'Strømplan (kulde): powerbank, reservebatterier, varme lommer' },
  { id: 'kom', group: 'Kommunikasjon', text: 'Satellittkommunikasjon (inReach/PLB) testet, SOS-rutine avtalt, turplan levert hjemme' },
  { id: 'dekning', group: 'Kommunikasjon', text: 'Mobildekning langs ruten sjekket (Telenor/Telia dekningskart) – ikke anta dekning' },
  { id: 'telt', group: 'Leir', text: 'Telt med snøfester, spade, sag, ekstra barduner – testet i storm' },
  { id: 'brenner', group: 'Leir', text: 'Brenner + drivstoff for snøsmelting (beregn ~0,15–0,2 l/døgn) + reservebrenner/tenning' },
  { id: 'førstehjelp', group: 'Sikkerhet', text: 'Førstehjelp, vindsekk/bivy, reparasjonssett (kite, binding, pulk)' },
  { id: 'krosso', group: 'Logistikk', text: 'Krossobanen-status kontrollert (stengt fra 19.06.2024 – gjenåpning usikker)' },
  { id: 'nedstigning', group: 'Logistikk', text: 'Nedstigning Gvepseborg → Rjukan avklart (Ryes vei vinterstatus/skred, alternativ)' },
  { id: 'transport', group: 'Logistikk', text: 'Transport Finse inn (tog) og ut fra Rjukan (buss) bestilt/kontrollert' },
  { id: 'hytter', group: 'Logistikk', text: 'DNT-hytter: åpningstid påske/vinter, nøkkel (DNT-nøkkel) og nødproviant sjekket på ut.no' },
];

export function useAcceptance() {
  const route = useActiveRoute();
  const check = useBarrierCheck(route);
  const terrain = useTerrain(route);
  const acks = useStore((s) => s.acks);
  const overrides = useStore((s) => s.lakeOverrides);
  const tripDate = useStore((s) => s.tripDate);
  const overridesPending = overrides.filter((o) => overrideState(o, tripDate) === 'aktiv' && reviewPending(o)).length;
  const steep = terrain ? terrain.samples.filter((t) => classify(t).cls === 'bratt').length : null;
  const items: { text: string; status: Status; blocking: boolean }[] = [
    { text: 'Regulerte magasiner lastet (NVE)', status: check.hydroAt ? 'GRØNN' : 'GRÅ', blocking: !check.hydroAt },
    { text: 'Alle innsjøer langs denne ruteversjonen hentet (NVE)', status: check.lakesAt ? 'GRØNN' : 'GRÅ', blocking: !check.lakesAt },
    { text: `Ingen blokkerende kryssing av regulerte / ikke-verifiserte vann, dammer eller forbudte soner (${check.blocking.length} funnet)`, status: check.blocking.length ? 'RØD' : check.waterChecked ? 'GRØNN' : 'GRÅ', blocking: check.blocking.length > 0 || !check.waterChecked },
    ...(check.userApproved.length ? [{ text: `${check.userApproved.length} kryssing(er) godkjent av deg (whitelist) – IKKE uavhengig verifisert: ${check.userApproved.map((c) => c.barrier.name).join(', ')}`, status: 'BRUKER' as Status, blocking: false }] : []),
    ...(overridesPending ? [{ text: `${overridesPending} overstyring(er) krever gjennomgang før avreise`, status: 'GUL' as Status, blocking: false }] : []),
    {
      text: `GPX-høyder i reguleringsintervall (${check.bandWarnings.length})${check.bandWarnings.length && acks['band'] ? ` – kvittert: ${acks['band']}` : ''}`,
      status: check.bandWarnings.length ? (acks['band'] ? 'GUL' : 'RØD') : 'GRØNN',
      blocking: check.bandWarnings.length > 0 && !acks['band'],
    },
    { text: 'Terrenganalyse (DTM) kjørt for ruten', status: terrain ? 'GRØNN' : 'GRÅ', blocking: !terrain },
    {
      text: `Bratte punkter (≥30°) gjennomgått mot bratthetskart (${steep ?? '–'})${acks['steep'] ? ` – kvittert: ${acks['steep']}` : ''}`,
      status: steep == null ? 'GRÅ' : steep === 0 ? 'GRØNN' : acks['steep'] ? 'GUL' : 'RØD',
      blocking: steep == null || (steep > 0 && !acks['steep']),
    },
  ];
  const accepted = items.every((i) => !i.blocking);
  return { route, items, accepted };
}

export default function SafetyPage() {
  const s = useStore();
  const { route, items, accepted } = useAcceptance();
  const check = useBarrierCheck(route);
  const terrain = useTerrain(route);
  const [ava, setAva] = useState<{ warnings: AvalancheWarning[]; url: string; fetchedAt: string }[] | null>(null);
  const [avaErr, setAvaErr] = useState('');

  const loadAva = async () => {
    if (!route) return;
    setAvaErr('');
    const ds = densify(route.waypoints, 5000);
    const picks = [ds[0], ds[Math.floor(ds.length / 2)], ds[ds.length - 1]];
    try {
      setAva(await Promise.all(picks.map((p) => avalancheWarnings(p, 3))));
    } catch (e) {
      setAvaErr((e as Error).message);
    }
  };

  const ack = (key: string) => {
    const note = prompt('Hva har du kontrollert, mot hvilken kilde og dato?');
    if (note) s.set({ acks: { ...s.acks, [key]: `${note} (${new Date().toISOString().slice(0, 10)})` } });
  };

  const risks: { name: string; status: Status; text: string }[] = [
    { name: 'Regulerte vann', status: check.status, text: `${check.crossings.length} kryssinger i NVE-data, ${check.bandWarnings.length} høyde-indikasjoner. Alle regulerte vann er forbudt i planen.` },
    { name: 'Isbarrierer / overvann', status: 'GUL', text: 'Strandsoner ved magasiner får sprekker og overvann ved nedtapping. Elveutløp og inntak kan ha åpne råker. Ikke kartlagt i data.' },
    { name: 'Skredfare', status: terrain ? (terrain.samples.some((t) => classify(t).cls === 'bratt') ? 'GUL' : 'GRØNN') : 'GRÅ', text: 'DTM-helning ≥30° langs ruten markeres. Nedstigning Gvepseborg → Rjukan (~500 høydemeter) går i bratt dalside – egen vurdering.' },
    { name: 'Whiteout', status: 'GUL', text: 'Hardangervidda er flat og uten landemerker; sikt kan forsvinne raskt ved SV-fronter. Kiting i whiteout frarådes.' },
    { name: 'Vindeksponering', status: 'GUL', text: 'Vidda gir lite le. Kast > 1,5× middelvind er vanlig nær fronter og i le av rygger.' },
    { name: 'Kulde', status: 'GUL', text: 'Mars/april: −25 til +5 °C. Vindavkjøling ved kiting (fart + vind). Planlegg for −30 °C effektiv.' },
    { name: 'Bratte partier med pulk', status: 'GUL', text: 'Se høydeprofil (>15 % / >25 % markert). Nedkjøringer med 40 kg pulk krever brems/stramme tau.' },
    { name: 'Navigasjonsrisiko', status: 'GUL', text: 'Rette GPX-linjer er ikke terrengtilpasset. Omveier rundt magasiner gjør kursene komplekse.' },
    { name: 'Teltplassering', status: 'GUL', text: 'Kandidater er beregnet fra DTM og IKKE befart. Unngå utløpsområder, skavler og strandsone.' },
    { name: 'Nødkommunikasjon', status: 'GRÅ', text: 'Mobildekning ikke kartlagt. Satellittkommunikasjon er påkrevd.' },
    { name: 'Avbrudd', status: Object.keys(s.places).length ? 'GUL' : 'GRÅ', text: 'Hytter hentet fra Kartverket. Åpningstid, brøytet vei og transport er ikke kontrollert.' },
  ];

  return (
    <div className="page">
      <Card title="Ruteaksept – aktiv rute" right={<Badge s={accepted ? 'GUL' : 'RØD'}>{accepted ? 'Kan aksepteres for videre planlegging' : 'BLOKKERT'}</Badge>} className="wide">
        <p className="small"><b>{route?.name ?? 'Ingen rute'}</b>. Aksept betyr kun at kjente datakontroller er bestått – ikke at ruten er trygg.</p>
        <ul className="gate">
          {items.map((i) => (
            <li key={i.text}>
              <Badge s={i.status} /> {i.text} {i.blocking && <b className="err">← blokkerer</b>}
            </li>
          ))}
        </ul>
        <div className="btns">
          {check.bandWarnings.length > 0 && <button className="btn small" onClick={() => ack('band')}>Kvitter høyde-indikasjoner…</button>}
          {terrain && <button className="btn small" onClick={() => ack('steep')}>Kvitter gjennomgang av bratte punkter…</button>}
        </div>
      </Card>

      <Card title="Verifiseringsstatus – forklaring">
        <ul className="legend-list small">
          <li><Badge s="GRØNN" /> Kontrollert mot angitt datakilde og dato. Betyr IKKE automatisk trygt.</li>
          <li><Badge s="GUL" /> Usikkerhet eller manglende opplysninger.</li>
          <li><Badge s="RØD" /> Kjent barriere, uakseptabel risiko eller forbudt i planen.</li>
          <li><Badge s="GRÅ" /> Ingen tilgjengelige data.</li>
        </ul>
        <p className="small">Datakategorier: <Kind k="kartdata" /> <Kind k="forslag" /> <Kind k="beregnet" /> <Kind k="uverifisert" /> <Kind k="sjekk-selv" /></p>
      </Card>

      <Card title="Risikooversikt" className="wide">
        <div className="risks">
          {risks.map((r) => (
            <div key={r.name} className="risk">
              <Badge s={r.status} /> <b>{r.name}</b>
              <div className="small">{r.text}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Vannregister (Mår-reguleringen m.fl.)" className="wide">
        <div className="tablewrap">
          <table className="tbl small">
            <thead>
              <tr><th>Vann</th><th>Status</th><th>HRV / LRV</th><th>System</th><th>Kilde</th><th>Merknad</th></tr>
            </thead>
            <tbody>
              {WATERS.map((w) => (
                <tr key={w.key}>
                  <td><b>{w.name}</b></td>
                  <td><Badge s={w.status} /> {w.label}</td>
                  <td>{w.hrv != null ? `${w.hrv} / ${w.lrv} moh` : 'ikke hentet'}</td>
                  <td>{w.system}</td>
                  <td>{w.source}</td>
                  <td>{w.note}</td>
                </tr>
              ))}
              <tr>
                <td><i>Alle andre vann ruten krysser</i></td>
                <td colSpan={5}><Badge s="RØD" /> {NOT_VERIFIED} – til reguleringsstatus er dokumentert (Kart → «Dokumenter uregulert…»).</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small muted">HRV/LRV er hentet fra sekundærkilder (SNL/Wikipedia) 2026-11-03 og må bekreftes mot NVE. Når NVE-magasiner lastes, vises NVEs egne attributter i kartet.</p>
      </Card>

      <Card title="Skredvarsel (Varsom)" right={<button className="btn small" onClick={loadAva} disabled={!route}>Hent varsel</button>}>
        <p className="small muted">Varsles 1. desember–31. mai. Utenfor sesong er svaret tomt.</p>
        {avaErr && <p className="err small">Feil: {avaErr}</p>}
        {ava?.map((a, i) => (
          <div key={i} className="small">
            <b>{['Start', 'Midtpunkt', 'Slutt'][i]}</b> · hentet {fmtTime(a.fetchedAt)}
            {a.warnings.length === 0 && <div className="muted">Ingen varsel returnert (utenfor sesong eller ingen region).</div>}
            {a.warnings.map((w, j) => (
              <div key={j}>
                {w.ValidFrom?.slice(0, 10)} · {w.RegionName}: faregrad <b>{w.DangerLevel}</b> {w.DangerLevelName ?? ''} – {w.MainText}
              </div>
            ))}
          </div>
        ))}
        <a href="https://www.varsom.no/snoskredvarsling/" target="_blank" rel="noreferrer">varsom.no</a> · <a href="https://www.regobs.no" target="_blank" rel="noreferrer">regObs</a>
      </Card>

      <DescentCard />

      <Card title="Sjekkliste før avreise" className="wide">
        {Array.from(new Set(CHECKLIST.map((c) => c.group))).map((g) => (
          <div key={g}>
            <h4>{g}</h4>
            {CHECKLIST.filter((c) => c.group === g).map((c) => (
              <label key={c.id} className="chk">
                <input type="checkbox" checked={!!s.checklist[c.id]} onChange={(e) => s.set({ checklist: { ...s.checklist, [c.id]: e.target.checked } })} />
                {c.text}
              </label>
            ))}
          </div>
        ))}
        <p className="small muted">{Object.values(s.checklist).filter(Boolean).length} / {CHECKLIST.length} kontrollert</p>
      </Card>
    </div>
  );
}

/** Sluttnedstigningen Gvepseborg → Rjukan som eget segment med egen risikovurdering. */
function DescentCard() {
  const route = useActiveRoute();
  const plan = useDayPlan(route);
  const { profile } = useProfile(route);
  const terrain = useTerrain(route);
  const ds = plan.descent;
  let metrics: { len: number; avg: number; max: number; turns: number; steepNear: number | null } | null = null;
  if (ds && route) {
    const seg = profile.filter((p) => p.d >= ds.fromD && p.d <= ds.toD && p.z != null);
    let max = 0;
    for (let i = 0; i < seg.length; i++) {
      const j = seg.findIndex((q) => q.d >= seg[i].d + 200);
      if (j > 0) max = Math.max(max, Math.abs(seg[j].z! - seg[i].z!) / (seg[j].d - seg[i].d));
    }
    const cum: number[] = [0];
    route.waypoints.forEach((w, i) => i && cum.push(cum[i - 1] + Math.hypot((w.lat - route.waypoints[i - 1].lat) * 111320, (w.lon - route.waypoints[i - 1].lon) * 55660)));
    const pts = route.waypoints.filter((_, i) => cum[i] >= ds.fromD - 1);
    let turns = 0;
    for (let i = 2; i < pts.length; i++) if (angleDiff(bearing(pts[i - 2], pts[i - 1]), bearing(pts[i - 1], pts[i])) > 70) turns++;
    const tn = terrain?.samples.filter((t) => t.d >= ds.fromD && t.d <= ds.toD).map((t) => t.maxNearSlope ?? 0) ?? [];
    metrics = { len: ds.toD - ds.fromD, avg: ds.drop / Math.max(1, ds.toD - ds.fromD), max, turns, steepNear: tn.length ? Math.max(...tn) : null };
  }
  const rows: [string, string, Status][] = [
    ['Lengde / fall', metrics ? `${(metrics.len / 1000).toFixed(1)} km / ${Math.round(ds!.drop)} m (fra din rute)` : 'Ryes vei: ca. 4 km / ca. 500 m (visitrjukan.com)', metrics ? 'GRØNN' : 'GUL'],
    ['Gjennomsnittlig helning', metrics ? `${(metrics.avg * 100).toFixed(0)} % (${((Math.atan(metrics.avg) * 180) / Math.PI).toFixed(0)}°) – beregnet` : '–', metrics ? 'GUL' : 'GRÅ'],
    ['Brattest 200 m', metrics ? `${(metrics.max * 100).toFixed(0)} % (${((Math.atan(metrics.max) * 180) / Math.PI).toFixed(0)}°) – beregnet` : '–', metrics ? (metrics.max > 0.3 ? 'RØD' : 'GUL') : 'GRÅ'],
    ['Krappe svinger (>70°) i rutepunktene', metrics ? `${metrics.turns} (kilde oppgir 21 svinger på Ryes vei)` : '21 svinger (visitrjukan.com)', 'GUL'],
    ['Skredterreng (DTM, innen 150 m)', metrics?.steepNear != null ? `brattest ${Math.round(metrics.steepNear)}°` : 'kjør terrenganalyse', metrics?.steepNear != null ? (metrics.steepNear >= 30 ? 'RØD' : 'GUL') : 'GRÅ'],
    ['Underlag / vintertilgang', 'Sti/vei som brukes som akebakke om vinteren (visitrjukan.com). Brøyting, is og skavler ukjent.', 'GUL'],
    ['Restriksjoner', 'Ingen kilde funnet. Akebakke kan ha akere i fart – vurder tidspunkt.', 'GRÅ'],
    ['Pulk 40 kg', 'Ingen kilde bekrefter at Ryes vei er egnet med lastet pulk. Krever bremsetau/kjetting, evt. bære/dra pulk i krappe svinger.', 'GUL'],
  ];
  return (
    <Card title="Sluttnedstigning Gvepseborg → Rjukan (eget segment)" className="wide">
      <div className="risks">
        <div className="risk">
          <Badge s="RØD">Stengt</Badge> <b>Krossobanen</b>
          <div className="small">Statens jernbanetilsyn stanset driften 19.06.2024. Banen er under istandsetting. Kildene oppgir gjenåpning alt fra 2027 til 2028 – ingen offisiell dato funnet. <b>Planen forutsetter at du går ned for egen maskin med pulk.</b></div>
          <div className="small muted">Kilder: Telemark fylkeskommune (vedtak), TU.no, Komoot · sist kontrollert 2026-11-03 · <a href="https://en.visitrjukan.com/things-to-do/krossobanen-p525513" target="_blank" rel="noreferrer">visitrjukan.com</a></div>
        </div>
        <div className="risk">
          <Badge s={ds ? 'GUL' : 'GRÅ'}>{ds ? 'Segment funnet' : 'Ikke funnet'}</Badge> <b>Nedstigning i ruten</b>
          <div className="small">{ds ? `Fra ${(ds.fromD / 1000).toFixed(1)} km til mål: ${Math.round(ds.drop)} m fall. Modellen regner dette som gå-strekk (${'ikke kiting'}).` : 'Ruten har ikke et tydelig fall på >350 m mot slutten.'}</div>
        </div>
      </div>
      <div className="tablewrap">
        <table className="tbl small">
          <thead><tr><th>Ryes vei / din nedstigning</th><th>Vurdering</th><th>Status</th></tr></thead>
          <tbody>{rows.map(([a, b, st]) => <tr key={a}><td>{a}</td><td>{b}</td><td><Badge s={st} /></td></tr>)}</tbody>
        </table>
      </div>
      <h4>Alternativer hvis Ryes vei er uegnet</h4>
      <ul className="small">
        <li><Badge s="GRÅ" /> Avslutt vest ved Rjukan Fjellstue / fylkesvei og ta transport ned (brøyting og buss ikke kontrollert).</li>
        <li><Badge s="GRÅ" /> Bli hentet ved Gvepseborg/Helberghytta hvis det finnes vinteråpen vei eller beltebil (ikke kontrollert).</li>
        <li><Badge s="GRÅ" /> Transport videre fra Rjukan (buss mot Notodden/Oslo): rutetider for 2027 ikke kontrollert – <a href="https://www.entur.no" target="_blank" rel="noreferrer">entur.no</a>.</li>
        <li><Badge s="GRÅ" /> Annen sti ned dalsiden – ikke kartlagt; kontroller bratthet og skredfare i Varsom Xgeo før du vurderer den.</li>
      </ul>
      <p className="small muted"><Kind k="sjekk-selv" /> Kontakt Visit Rjukan / Tinn kommune om vinterstatus og om det finnes restriksjoner i akebakken.</p>
    </Card>
  );
}
