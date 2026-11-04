export interface Category {
  id: string;
  label: string;
  icon: string;
  color: string;
  custom?: boolean;
}

/** Innebygde kategorier for rutepunkter og egne markører. Egne kategorier lagres i planen. */
export const BUILTIN_CATEGORIES: Category[] = [
  { id: 'camp', label: 'Leir / telt', icon: '⛺', color: '#22c55e' },
  { id: 'launch', label: 'Kite-start', icon: '🪁', color: '#38bdf8' },
  { id: 'landing', label: 'Kite-landing', icon: '🛬', color: '#0ea5e9' },
  { id: 'terrain', label: 'Terrengvarsel', icon: '⛰️', color: '#eab308' },
  { id: 'windshadow', label: 'Vindskygge', icon: '🌀', color: '#a3a3a3' },
  { id: 'avalanche', label: 'Skredvarsel', icon: '⚠️', color: '#f97316' },
  { id: 'ice', label: 'Vann / is – varsel', icon: '🧊', color: '#60a5fa' },
  { id: 'regulated', label: 'Regulert vann', icon: '🚫', color: '#ef4444' },
  { id: 'alternative', label: 'Rutealternativ', icon: '🔀', color: '#3b82f6' },
  { id: 'rest', label: 'Hvilested', icon: '☕', color: '#14b8a6' },
  { id: 'exit', label: 'Nødutgang', icon: '🆘', color: '#dc2626' },
  { id: 'pickup', label: 'Henteplass', icon: '🚐', color: '#8b5cf6' },
  { id: 'note', label: 'Generelt notat', icon: '📝', color: '#a855f7' },
];

export function allCategories(custom: Category[]): Category[] {
  return [...BUILTIN_CATEGORIES, ...custom];
}

export function categoryOf(id: string | undefined, custom: Category[]): Category | undefined {
  if (!id) return undefined;
  return allCategories(custom).find((c) => c.id === id);
}

export const VERIFICATION_TEXT = {
  uverifisert: { label: 'Uverifisert', cls: 'GRÅ' },
  advarsel: { label: 'Advarsel', cls: 'GUL' },
  brukergodkjent: { label: 'Brukergodkjent', cls: 'BRUKER' },
  verifisert: { label: 'Verifisert (kilde)', cls: 'GRØNN' },
  blokkert: { label: 'Blokkert', cls: 'RØD' },
} as const;
