import { dirName } from '../geo';
import { hhmm } from '../sim/expedition';
import { KITES } from '../../data/kites';
import { summarize, type PlanRun } from './context';
import type { Camp } from '../../types';

export const SCENARIO_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#14b8a6', '#f97316'];

export const kiteName = (id: string) => {
  const k = KITES.find((x) => x.id === id);
  return k ? `${k.name} ${k.size} m²` : id;
};

/** Rader i sammenligningstabellen (felles for skjerm, PDF og Excel). */
export function compareRows(runs: PlanRun[], camps: Camp[], destination: string): { label: string; values: string[] }[] {
  const sums = runs.map(summarize);
  return [
    { label: 'Rute', values: runs.map((r) => r.route?.name ?? '–') },
    { label: 'Total distanse', values: sums.map((s) => `${s.totalKm.toFixed(1)} km`) },
    { label: 'Antall dager', values: sums.map((s) => `${s.days}`) },
    { label: `Ankomst ${destination || 'mål'}`, values: runs.map((_, i) => (sums[i].doneDay ? `Dag ${sums[i].doneDay!.day} kl. ${hhmm(sums[i].doneDay!.arrival)} (${sums[i].doneDay!.date})` : `Når ikke frem – ${sums[i].remainingKm.toFixed(0)} km igjen`)) },
    { label: 'Distanse per dag', values: runs.map((r) => r.days.map((d) => (d.reason.startsWith('allerede') ? `D${d.day}: reserve` : `D${d.day}: ${((d.endD - d.startD) / 1000).toFixed(0)} km`)).join(' · ')) },
    { label: 'Reisetid per dag', values: runs.map((r) => r.days.map((d) => (d.reason.startsWith('allerede') ? `D${d.day}: –` : `D${d.day}: ${hhmm(d.departure)}–${hhmm(d.arrival)}`)).join(' · ')) },
    { label: 'Sum kitetid', values: sums.map((s) => `${s.movingH.toFixed(1)} t`) },
    { label: 'Kite per dag', values: runs.map((r) => r.days.map((d) => `D${d.day}: ${kiteName(d.kiteId)}${d.kiteAuto ? ' (auto)' : ''}`).join(' · ')) },
    { label: 'Vind per dag', values: runs.map((r) => r.plan.days.map((d, i) => `D${i + 1}: ${dirName(d.wind.dir)} ${d.wind.avg} m/s (${d.wind.min}–${d.wind.max}, kast ${d.wind.gust})${d.windMode === 'manuell' ? '' : ' · prognose'}`).join(' · ')) },
    { label: 'Teltplasser', values: runs.map((r) => r.plan.days.slice(0, -1).map((d, i) => `N${i + 1}: ${camps.find((c) => c.id === d.campId)?.name ?? 'ikke valgt'}`).join(' · ') || '–') },
    { label: 'Notat', values: runs.map((r) => r.plan.note || '–') },
  ];
}
