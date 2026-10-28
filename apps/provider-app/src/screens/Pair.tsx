import { useEffect, useState } from 'react';
import { formatCountdown, secondsLeft } from '../format';
import type { Ipc } from '../ipc';
import type { AppApi } from '../useApp';
import type { AppState } from '../types';

/** Consent is given but this computer is not connected to an account yet. */
export function NeedsPairing({ ipc, app }: { ipc: Ipc; app: AppApi }) {
  const [starting, setStarting] = useState(false);

  const connect = () => {
    setStarting(true);
    app.dismissNotice();
    // If starting fails the error shows and the button comes back.
    void app.act(() => ipc.beginPairing()).then(() => undefined);
  };

  // A failure or an ended pairing brings the button back.
  useEffect(() => {
    if (app.error || app.notice) setStarting(false);
  }, [app.error, app.notice]);

  return (
    <section aria-labelledby="pair-title">
      <h1 id="pair-title">Connect this computer</h1>
      <p>
        Link this computer to your ProxyHubb account. You will get a short code to approve in your
        browser. There is nothing to copy or install.
      </p>
      {app.notice && (
        <div className={`banner ${app.notice.tone}`} role="status">
          <strong>{app.notice.title}</strong>
          <span>{app.notice.body}</span>
        </div>
      )}
      <div className="actions">
        <button className="primary" type="button" disabled={starting || app.busy} onClick={connect}>
          {starting ? 'Getting your code…' : 'Connect'}
        </button>
      </div>
    </section>
  );
}

/** The code is on screen and the person has to approve it in the browser. */
export function Pairing({
  ipc,
  app,
  state,
}: {
  ipc: Ipc;
  app: AppApi;
  state: Extract<AppState, { kind: 'pairing' }>;
}) {
  // The countdown starts when the code first appears on this screen.
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const left = secondsLeft(state.expires_in, startedAt, now);

  return (
    <section aria-labelledby="pairing-title">
      <h1 id="pairing-title">Approve this code</h1>
      <p>Open ProxyHubb, check that the device name matches this computer, and approve the code below.</p>

      <div className="code" aria-label={`Your code is ${state.user_code}`}>
        {state.user_code}
      </div>
      <p className="muted" role="timer" aria-live="off">
        {left > 0 ? `Expires in ${formatCountdown(left)}` : 'This code has expired. Cancel and try again.'}
      </p>

      <ol className="steps">
        <li>Press “Open ProxyHubb”. Sign in if asked.</li>
        <li>Check the device name and the code match what you see here.</li>
        <li>Choose “Approve this computer”. This window finishes by itself.</li>
      </ol>

      <div className="actions">
        <button className="secondary" type="button" disabled={app.busy} onClick={() => void app.act(() => ipc.cancelPairing())}>
          Cancel
        </button>
        <button className="primary" type="button" disabled={app.busy} onClick={() => void app.act(() => ipc.openPairingLink())}>
          Open ProxyHubb
        </button>
      </div>
    </section>
  );
}
