import { create } from 'zustand';

/**
 * Visningsvalg for denne enheten (ikke prosjektdata): enkel/detaljert visning, hjelpetekster og
 * kom-i-gang-veiledningen. Lagres i localStorage; virker også uten (privat modus o.l.).
 */
export interface UiPrefs {
  /** true = vis detaljer og avanserte innstillinger åpne som standard */
  detailed: boolean;
  /** vis forklaring øverst på hver side */
  hints: boolean;
  /** kom-i-gang-listen på Start er skjult */
  guideHidden: boolean;
}
const KEY = 'kite-ui-prefs';
const DEF: UiPrefs = { detailed: false, hints: true, guideHidden: false };

function load(): UiPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      detailed: typeof raw.detailed === 'boolean' ? raw.detailed : DEF.detailed,
      hints: typeof raw.hints === 'boolean' ? raw.hints : DEF.hints,
      guideHidden: typeof raw.guideHidden === 'boolean' ? raw.guideHidden : DEF.guideHidden,
    };
  } catch {
    return DEF;
  }
}

export const useUiPrefs = create<UiPrefs & { setPref: (p: Partial<UiPrefs>) => void }>((set, get) => ({
  ...load(),
  setPref: (p) => {
    set(p);
    const { detailed, hints, guideHidden } = get();
    try { localStorage.setItem(KEY, JSON.stringify({ detailed, hints, guideHidden })); } catch { /* ikke lagret – virker likevel denne økten */ }
  },
}));
