import type { Insights } from '../plan/insights';
import type { Task, Expense } from './model';
import type { Tab } from '../../state/store';

/** Hvor klare er vi? Én vurdering per område, samme logikk i dashbord og eksport. */
export interface Area { id: string; label: string; score: number; status: 'ok' | 'obs' | 'mangler'; detail: string; todo: { text: string; tab: Tab }[] }

export function readiness(o: {
  today: string;
  tripDate: string;
  tasks: Task[];
  ins: Insights;
  importantWarnings: number;
  waterChecked: boolean;
  forecastFetched: boolean;
  forecastPossible: boolean;
  budget: number;
  expenses: Expense[];
  campCount: number;
}): { areas: Area[]; overall: number; daysLeft: number } {
  const { ins } = o;
  const daysLeft = Math.round((Date.parse(`${o.tripDate}T12:00:00Z`) - Date.parse(`${o.today}T12:00:00Z`)) / 86400000);
  const areas: Area[] = [];
  const st = (s: number): Area['status'] => (s >= 0.95 ? 'ok' : s >= 0.6 ? 'obs' : 'mangler');
  // oppgaver
  const open = o.tasks.filter((t) => !t.done);
  const overdue = open.filter((t) => t.due && t.due < o.today);
  const tScore = o.tasks.length ? (o.tasks.length - open.length) / o.tasks.length : 1;
  areas.push({ id: 'oppgaver', label: 'Oppgaver', score: overdue.length ? Math.min(tScore, 0.5) : tScore, status: overdue.length ? 'mangler' : st(tScore), detail: `${o.tasks.length - open.length}/${o.tasks.length} ferdig${overdue.length ? ` · ${overdue.length} over fristen` : ''}`, todo: overdue.slice(0, 4).map((t) => ({ text: `Over fristen: ${t.title}`, tab: 'oppgaver' })) });
  // utstyr
  const missing = ins.advice.filter((a) => a.level === 'mangler' || a.level === 'uegnet');
  const gScore = Math.max(0, ins.gear.packedPct * 0.5 + (missing.length ? Math.max(0, 0.5 - missing.length * 0.1) : 0.5));
  areas.push({ id: 'utstyr', label: 'Utstyr', score: gScore, status: missing.length ? 'mangler' : st(gScore), detail: `${Math.round(ins.gear.packedPct * 100)} % pakket · ${missing.length} mangler/uegnet`, todo: missing.slice(0, 4).map((a) => ({ text: `${a.level === 'uegnet' ? 'Uegnet' : 'Mangler'}: ${a.text}`, tab: 'utstyr' })) });
  // mat
  const fOk = !ins.food.shortDays.length;
  areas.push({ id: 'mat', label: 'Mat og vann', score: fOk ? 1 : 0.5, status: fOk ? 'ok' : 'obs', detail: `${ins.food.totalDays} døgn · ${ins.food.totalKg.toFixed(1)} kg · ${ins.food.fuelL.toFixed(1)} l brensel`, todo: fOk ? [] : [{ text: `For lite energi dag ${ins.food.shortDays.join(', ')}`, tab: 'mat' }] });
  // overnatting
  const chosen = ins.nights.filter((n) => n.camp).length;
  const nIssues = ins.nights.flatMap((n) => n.issues.map((t) => `Natt ${n.night}: ${t}`));
  const nScore = ins.nights.length ? chosen / ins.nights.length : 1;
  areas.push({ id: 'netter', label: 'Overnatting', score: nScore, status: nIssues.length ? (chosen ? 'obs' : 'mangler') : 'ok', detail: `${chosen}/${ins.nights.length} netter valgt${o.campCount ? '' : ' · ingen steder lagt inn'}`, todo: nIssues.slice(0, 4).map((t) => ({ text: t, tab: 'netter' })) });
  // rute og sikkerhet
  const rScore = o.importantWarnings ? 0.4 : o.waterChecked ? 1 : 0.7;
  areas.push({ id: 'rute', label: 'Rute og sikkerhet', score: rScore, status: o.importantWarnings ? 'mangler' : o.waterChecked ? 'ok' : 'obs', detail: `${o.importantWarnings} viktige varsler ikke vurdert${o.waterChecked ? '' : ' · vann ikke kontrollert mot NVE'}`, todo: [...(o.importantWarnings ? [{ text: `${o.importantWarnings} viktige varsler å vurdere`, tab: 'oversikt' as Tab }] : []), ...(o.waterChecked ? [] : [{ text: 'Kontroller vann langs ruten (NVE)', tab: 'oversikt' as Tab }])] });
  // vær
  const imp = ins.hazards.filter((h) => h.level === 'viktig');
  const wScore = !o.forecastPossible ? 1 : !o.forecastFetched ? 0.5 : imp.length ? 0.4 : 1;
  areas.push({ id: 'vaer', label: 'Vær', score: wScore, status: !o.forecastPossible ? 'ok' : !o.forecastFetched ? 'obs' : imp.length ? 'mangler' : 'ok', detail: !o.forecastPossible ? `Prognose fra ca. ${Math.max(0, daysLeft - 9)} dager før avreise` : !o.forecastFetched ? 'Prognose tilgjengelig – ikke hentet' : `${imp.length} farlige forhold i prognosen`, todo: [...(o.forecastPossible && !o.forecastFetched ? [{ text: 'Hent værmelding langs ruten', tab: 'vaer' as Tab }] : []), ...imp.slice(0, 3).map((h) => ({ text: `Dag ${h.day}: ${h.text}`, tab: 'vaer' as Tab }))] });
  // budsjett
  if (o.budget > 0) {
    const sum = o.expenses.reduce((a, e) => a + e.amount, 0);
    const over = sum > o.budget;
    areas.push({ id: 'budsjett', label: 'Budsjett', score: over ? 0.5 : 1, status: over ? 'obs' : 'ok', detail: `${Math.round(sum).toLocaleString('nb-NO')} av ${o.budget.toLocaleString('nb-NO')} kr`, todo: over ? [{ text: 'Over budsjett', tab: 'oppgaver' }] : [] });
  }
  const overall = areas.reduce((a, x) => a + x.score, 0) / areas.length;
  return { areas, overall, daysLeft };
}
