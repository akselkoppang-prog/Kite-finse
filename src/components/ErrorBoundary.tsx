import { Component, lazy, type ComponentType, type ReactNode } from 'react';
import { logError, isChunkError } from '../lib/errlog';
import { APP_VERSION } from '../lib/version';

const RELOAD_KEY = 'kite.chunkReload';

/** Last siden på nytt én gang (ikke i løkke) – brukes når en sidefil mangler etter en oppdatering. */
function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 60000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  // gi autolagringen et øyeblikk til å skrive ferdig
  void import('../storage/persistence').then((m) => m.flush()).catch(() => undefined).finally(() => location.reload());
  return true;
}

/**
 * Som React.lazy, men tåler at sidefilen ikke finnes lenger (ny versjon lagt ut mens fanen var åpen):
 * prøver én gang til, og laster ellers appen på nytt automatisk.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await load();
    } catch (e) {
      if (!isChunkError(e)) throw e;
      await new Promise((r) => setTimeout(r, 600));
      try {
        return await load();
      } catch (e2) {
        logError('lasting av side', e2);
        if (reloadOnce()) return new Promise<{ default: T }>(() => undefined); // siden lastes på nytt
        throw e2;
      }
    }
  });
}

interface Props { children: ReactNode; where: string; /** hele appen (true) eller én side (false) */ full?: boolean; onHome?: () => void }
interface State { error: Error | null }

/** Fanger feil i visningen så resten av appen (og dataene) er urørt, og gir tydelige veier videre. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error) {
    logError(this.props.where, error);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkError(error);
    return (
      <div className="errorboundary" role="alert">
        <h3>{chunk ? 'Appen er oppdatert – siden må lastes på nytt' : this.props.full ? 'Appen fikk en feil' : 'Denne siden fikk en feil'}</h3>
        <p>{chunk ? 'En ny versjon er lagt ut siden du åpnet appen.' : 'Planen din er lagret og er ikke berørt. Du kan prøve igjen, gå til en annen side eller laste appen på nytt.'}</p>
        <p className="small muted mono">{String(error.message).slice(0, 300)}</p>
        <div className="btns">
          {!chunk && <button className="btn" onClick={() => this.setState({ error: null })}>Prøv igjen</button>}
          {!this.props.full && this.props.onHome && <button className="btn" onClick={() => { this.setState({ error: null }); this.props.onHome?.(); }}>Gå til Oversikt</button>}
          <button className="btn primary" onClick={() => location.reload()}>Last appen på nytt</button>
        </div>
        <p className="small muted">Versjon {APP_VERSION}. Feilen er notert i feilloggen under Innstillinger → Datakilder.</p>
      </div>
    );
  }
}
