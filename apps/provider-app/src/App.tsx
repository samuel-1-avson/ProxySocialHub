// Placeholder until the real screens land (plan Phase 3): shows the derived app state.
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export function App() {
  const [state, setState] = useState<string>('checking...');

  useEffect(() => {
    invoke('app_state')
      .then((s) => setState(JSON.stringify(s)))
      .catch((e: unknown) => setState(`error: ${String(e)}`));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>ProxyHubb Provider</h1>
      <p>State: {state}</p>
    </main>
  );
}
