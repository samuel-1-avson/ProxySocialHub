import { useEffect, useState } from 'react';
import { loadIpc, type Ipc } from './ipc';
import { Consent } from './screens/Consent';
import { Connecting, Paused, Problem, Sharing } from './screens/Home';
import { UpdateBanner } from './screens/Manage';
import { NeedsPairing, Pairing } from './screens/Pair';
import { useApp } from './useApp';

export function App() {
  const [ipc, setIpc] = useState<Ipc | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    loadIpc()
      .then(setIpc)
      .catch((e: unknown) => setLoadError(String(e)));
  }, []);

  if (loadError) return <main className="shell"><p role="alert">{loadError}</p></main>;
  if (!ipc) return <main className="shell" aria-busy="true" />;
  return <Screens ipc={ipc} />;
}

function Screens({ ipc }: { ipc: Ipc }) {
  const app = useApp(ipc);
  const { state } = app;

  let screen: React.ReactNode;
  if (!state) {
    screen = <p className="muted" role="status">Starting…</p>;
  } else {
    switch (state.kind) {
      case 'needs_consent':
        screen = <Consent ipc={ipc} app={app} />;
        break;
      case 'needs_pairing':
        screen = <NeedsPairing ipc={ipc} app={app} />;
        break;
      case 'pairing':
        screen = <Pairing ipc={ipc} app={app} state={state} />;
        break;
      case 'connecting':
        screen = <Connecting ipc={ipc} app={app} state={state} />;
        break;
      case 'sharing':
        screen = <Sharing ipc={ipc} app={app} state={state} />;
        break;
      case 'paused':
        screen = <Paused ipc={ipc} app={app} />;
        break;
      case 'problem':
        screen = <Problem ipc={ipc} app={app} state={state} />;
        break;
    }
  }

  return (
    <main className="shell">
      <header className="brand">
        <span className="logo" aria-hidden="true">R</span>
        <span>ProxyHubb Provider</span>
      </header>
      {/* Not before the person has agreed to anything: the first screen is only the consent. */}
      {state && state.kind !== 'needs_consent' && <UpdateBanner ipc={ipc} app={app} />}
      {screen}
      {app.error && (
        <div className="banner warn" role="alert">
          <span>{app.error}</span>
        </div>
      )}
    </main>
  );
}
