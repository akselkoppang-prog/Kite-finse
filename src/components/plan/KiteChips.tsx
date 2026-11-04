import { useStore } from '../../state/store';
import { kiteInput } from '../../state/sim';
import { KITES } from '../../data/kites';
import { airDensity, canStart, heightFactor, overpowered } from '../../lib/sim/physics';
import type { DayWind } from '../../lib/sim/expedition';

export const kiteShort = (id: string) => {
  const k = KITES.find((x) => x.id === id);
  return k ? `${k.name.replace(/^(Flysurfer|Ozone|Naish) /, '').replace(/ V\d+| \d$/, '')} ${k.size}` : id;
};

export type Fit = 'god' | 'grense' | 'for liten' | 'for stor';

/** Passer kiten vindfordelingen? (fysikkmodell, din vekt + pulk). */
export function kiteFit(id: string, w: DayWind, s: ReturnType<typeof useStore.getState>): { fit: Fit; text: string } {
  const p = { ...s.simParams, riderKg: s.riderKg, pulkKg: s.pulkKg, snow: s.snow };
  const k = kiteInput(id, s);
  const rho = airDensity(p.tempC, 1150);
  const hf = heightFactor(p);
  const pers = k.personal;
  const start = (v: number) => (pers ? v >= pers.low : canStart(k, p, rho, v * hf));
  const over = (v: number) => (pers ? v > pers.high : overpowered(k, p, rho, v * hf));
  if (!start(w.avg)) return { fit: 'for liten', text: 'for lite trekk i snittvinden' };
  if (over(w.avg)) return { fit: 'for stor', text: 'for mye kraft i snittvinden' };
  if (over(w.max) || over(w.gust)) return { fit: 'grense', text: over(w.max) ? 'for stor i maksvinden' : 'kastene er over grensen' };
  if (!start(w.min)) return { fit: 'grense', text: 'for liten i minimumsvinden' };
  return { fit: 'god', text: 'passer hele vindfordelingen' };
}

/** Velg ÉN kite for dagen blant kitene du tar med. Farge = hvor godt den passer vinden. */
export default function KiteChips({ value, wind, autoPick, onPick }: { value: string; wind: DayWind; autoPick?: string; onPick: (id: string) => void }) {
  const s = useStore();
  const quiver = s.quivers.find((q) => q.id === s.activeQuiverId)?.kiteIds ?? [];
  return (
    <div className="kitechips">
      <button className={`kchip2 ${value === 'auto' ? 'on' : ''}`} onClick={() => onPick('auto')} title="Velg automatisk den kiten som gir best fremdrift">
        Auto{value === 'auto' && autoPick ? `: ${kiteShort(autoPick)}` : ''}
      </button>
      {quiver.map((id) => {
        const f = kiteFit(id, wind, s);
        return (
          <button key={id} className={`kchip2 fit-${f.fit.replace(' ', '-')} ${value === id ? 'on' : ''}`} onClick={() => onPick(id)} title={f.text}>
            🪁 {kiteShort(id)} m²<span className="fitdot" />
          </button>
        );
      })}
      {quiver.length === 0 && <span className="small warn">Velg hvilke kites du tar med (Vær & kite).</span>}
    </div>
  );
}
