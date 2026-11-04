import type { ReactNode } from 'react';
import type { DataKind, Status } from '../types';

const BADGE_TEXT: Record<Status, string> = { GRØNN: 'VERIFISERT', GUL: 'ADVARSEL', RØD: 'VIKTIG', GRÅ: 'INGEN DATA', BRUKER: 'BRUKERGODKJENT' };

/** Statusmerke. Standardtekst: VERIFISERT / ADVARSEL / VIKTIG / INGEN DATA / BRUKERGODKJENT. */
export function Badge({ s, children }: { s: Status; children?: ReactNode }) {
  return <span className={`badge b-${s}`} title={s === 'BRUKER' ? 'Din egen godkjenning – ikke uavhengig verifisert' : undefined}>{children ?? BADGE_TEXT[s]}</span>;
}

const KIND_TEXT: Record<DataKind, string> = {
  kartdata: 'Kartdata',
  forslag: 'Forslag',
  beregnet: 'Beregnet',
  uverifisert: 'Uverifisert',
  'sjekk-selv': 'Sjekk selv',
};
export function Kind({ k }: { k: DataKind }) {
  return <span className={`kind k-${k}`}>{KIND_TEXT[k]}</span>;
}

export function Card({ title, right, children, className = '' }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <header>
          <h3>{title}</h3>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-l">{label}</div>
      <div className="stat-v">{value}</div>
      {sub && <div className="stat-s">{sub}</div>}
    </div>
  );
}

export function Progress({ f }: { f: number }) {
  return (
    <div className="progress">
      <div style={{ width: `${Math.round(f * 100)}%` }} />
    </div>
  );
}

export const fmtTime = (iso?: string) => (iso ? new Date(iso).toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' }) : '–');
