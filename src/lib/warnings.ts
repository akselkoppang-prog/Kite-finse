import { useMemo } from 'react';
import { useStore } from '../state/store';
import { useActiveRoute, useBarrierCheck, useTerrain } from '../state/derived';
import { useExpedition } from '../state/expedition';
import { classify } from './analysis/terrain';
import { overrideState, reviewPending } from './analysis/overrides';
import type { LatLon } from './geo';

/**
 * Rådgivende varsler i tre nivåer. Ingen av dem stopper planlegging, redigering eller simulering.
 * «Vurdert av deg» er din egen vurdering – aldri en offisiell kontroll.
 */
export type Level = 'info' | 'advarsel' | 'viktig';
export interface Warning { id: string; level: Level; title: string; text: string; where?: LatLon; ack?: string; action?: 'godkjenn-vann'; barrierId?: string }

export const LEVEL_TEXT: Record<Level, string> = { info: 'INFORMASJON', advarsel: 'ADVARSEL', viktig: 'VIKTIG ADVARSEL' };

export function useWarnings(): Warning[] {
  const route = useActiveRoute();
  const check = useBarrierCheck(route);
  const terrain = useTerrain(route);
  const { days } = useExpedition();
  const acks = useStore((s) => s.acks);
  const overrides = useStore((s) => s.lakeOverrides);
  const tripDate = useStore((s) => s.tripDate);
  return useMemo(() => {
    const w: Warning[] = [];
    for (const c of check.crossings) {
      const id = `kryss:${c.barrier.id}:${Math.round(c.fromD / 500)}`;
      const km = `${(c.fromD / 1000).toFixed(1)} km`;
      if (c.label === 'BRUKERGODKJENT' && !c.hazards.length) w.push({ id, level: 'info', title: `Godkjent av deg: ${c.barrier.name}`, text: `Kryssing ved ${km} er godkjent for din rute. Offisiell status: ${c.barrier.label}.`, where: c.entry });
      else if (c.hazards.length) w.push({ id, level: 'viktig', title: `Farlig kryssing: ${c.barrier.name}`, text: `${c.hazards.join('; ')} (ved ${km}).`, where: c.entry, barrierId: c.barrier.id });
      else if (c.barrier.kind === 'sone') w.push({ id, level: c.barrier.status === 'RØD' ? 'viktig' : 'advarsel', title: `Ruten går gjennom «${c.barrier.name}»`, text: `Din egen ${c.barrier.status === 'RØD' ? 'no-go' : 'usikre'} sone, ved ${km}.`, where: c.entry });
      else if (c.barrier.kind === 'magasin' || /regulert/i.test(c.barrier.label) && !c.barrier.label.startsWith('IKKE'))
        w.push({ id, level: 'viktig', title: `Regulert vann: ${c.barrier.name}`, text: `Ruten krysser et regulert magasin ved ${km} (${Math.round(c.lengthM)} m). Is og vannstand kan være usikker. Du kan godkjenne kryssingen hvis du kjenner den.`, where: c.entry, action: 'godkjenn-vann', barrierId: c.barrier.id });
      else w.push({ id, level: 'advarsel', title: `Ukontrollert vann: ${c.barrier.name}`, text: `Ruten krysser et vann uten dokumentert reguleringsstatus ved ${km}.`, where: c.entry, action: 'godkjenn-vann', barrierId: c.barrier.id });
    }
    check.bandWarnings.forEach((b) => w.push({ id: `hoyde:${b.wp.id}`, level: 'advarsel', title: `Mulig på magasin: ${b.water}`, text: `Et rutepunkt har høyde ${Math.round(b.wp.eleGpx!)} moh, innenfor reguleringsintervallet (${b.band}).`, where: b.wp }));
    if (!check.waterChecked) w.push({ id: 'vann-ikke-sjekket', level: 'info', title: 'Vann ikke kontrollert mot NVE ennå', text: 'Hent NVE-data under «Rute og data» for å se kryssinger av regulerte vann.' });
    if (terrain) {
      const steep = terrain.samples.filter((t) => classify(t).cls === 'bratt');
      if (steep.length) w.push({ id: `bratt:${steep.length}`, level: 'advarsel', title: `${steep.length} bratte partier (≥30°)`, text: 'Mulig skredterreng nær ruten. Sjekk bratthetskart og skredvarsel.', where: steep[0] });
    } else w.push({ id: 'terreng-ikke-analysert', level: 'info', title: 'Terreng ikke analysert', text: 'Kjør terrenganalyse for helning, skredterreng og le.' });
    overrides.filter((o) => overrideState(o, tripDate) === 'aktiv' && reviewPending(o)).forEach((o) => w.push({ id: `review:${o.id}`, level: 'advarsel', title: `Gå gjennom godkjenningen av ${o.name}`, text: 'Du har bedt om en ny gjennomgang før avreise.', where: o.centroid }));
    days.forEach((d) => d.issues.forEach((t, i) => w.push({ id: `dag${d.day}:${i}:${t.slice(0, 20)}`, level: /Mangler/.test(t) ? 'viktig' : 'advarsel', title: `Dag ${d.day}`, text: t })));
    w.push({ id: 'krossobanen', level: 'info', title: 'Krossobanen er stengt', text: 'Planlegg å gå ned fra Gvepseborg til Rjukan selv (se Utstyr & planlegging → Sikkerhet).' });
    return w.map((x) => ({ ...x, ack: acks[x.id] })).sort((a, b) => ['viktig', 'advarsel', 'info'].indexOf(a.level) - ['viktig', 'advarsel', 'info'].indexOf(b.level));
  }, [check, terrain, days, acks, overrides, tripDate]);
}
