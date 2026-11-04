import { DAY_COLORS, type DayOutcome } from '../../lib/sim/expedition';

/** Visuell stripe for hele turen: én farget bit per dag, grå = det som gjenstår. */
export function TripStrip({ days, total }: { days: DayOutcome[]; total: number }) {
  return (
    <div className="tripstrip" role="img" aria-label="Fordeling av distansen per dag">
      {days.map((d, i) => {
        const w = (100 * (d.endD - d.startD)) / Math.max(1, total);
        return w > 0 ? <div key={i} style={{ width: `${w}%`, background: DAY_COLORS[i % DAY_COLORS.length] }} title={`Dag ${d.day}: ${((d.endD - d.startD) / 1000).toFixed(0)} km`}>{w > 8 ? `D${d.day} ${((d.endD - d.startD) / 1000).toFixed(0)}` : ''}</div> : null;
      })}
      {days.length > 0 && days[days.length - 1].remainingKm > 0.05 && <div className="rest" style={{ width: `${(100 * days[days.length - 1].remainingKm * 1000) / total}%` }}>{days[days.length - 1].remainingKm.toFixed(0)} km igjen</div>}
    </div>
  );
}

