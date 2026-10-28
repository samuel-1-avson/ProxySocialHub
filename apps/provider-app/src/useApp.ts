import { useCallback, useEffect, useState } from 'react';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { noticeForPairingEnd, type Notice } from './format';
import type { Ipc } from './ipc';
import type { AppState } from './types';

export interface AppApi {
  state: AppState | null;
  /** Why the last pairing ended, until the person starts another or dismisses it. */
  notice: Notice | null;
  /** The last action that failed, in words. */
  error: string | null;
  busy: boolean;
  /** Run an action: marks the app busy, shows a failure as `error`. */
  act: (action: () => Promise<unknown>) => Promise<void>;
  dismissNotice: () => void;
}

export function useApp(ipc: Ipc): AppApi {
  const [state, setState] = useState<AppState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const unlisteners: UnlistenFn[] = [];
    const keep = (unlisten: UnlistenFn) => (alive ? unlisteners.push(unlisten) : unlisten());

    ipc
      .appState()
      .then((s) => alive && setState(s))
      .catch((e: unknown) => alive && setError(String(e)));
    void ipc.onState((s) => setState(s)).then(keep);
    void ipc.onPairingEnded((ended) => setNotice(noticeForPairingEnd(ended))).then(keep);

    return () => {
      alive = false;
      unlisteners.forEach((u) => u());
    };
  }, [ipc]);

  const act = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, notice, error, busy, act, dismissNotice: () => setNotice(null) };
}
