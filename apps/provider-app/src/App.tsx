// Spike placeholder (plan step 0.2): proves the window loads and Rust can call the
// bundled provider-node. Replaced by the real screens in Phase 3.
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export function App() {
  const [version, setVersion] = useState<string>('checking...');

  useEffect(() => {
    invoke<string>('sidecar_version')
      .then(setVersion)
      .catch((e: unknown) => setVersion(`error: ${String(e)}`));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>ProxyHubb Provider</h1>
      <p>Bundled node: {version}</p>
    </main>
  );
}
