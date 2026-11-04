import { create } from 'zustand';
import type { SimResult } from '../lib/sim/route';

/** Avspilling av simulering (egen liten store så animasjonen ikke rerendrer hele appen). */
export interface PlayState {
  result: SimResult | null;
  label: string;
  t: number;
  playing: boolean;
  rate: number; // simulerte minutter per sekund
  load: (r: SimResult, label: string) => void;
  set: (p: Partial<PlayState>) => void;
}

export const usePlay = create<PlayState>((set) => ({
  result: null,
  label: '',
  t: 0,
  playing: false,
  rate: 5,
  load: (r, label) => set({ result: r, label, t: r.start, playing: false }),
  set: (p) => set(p),
}));
