import { useEffect, useState } from 'react';
import { formatBytes, formatDuration, formatRetrySentence } from '../format';
import type { Ipc } from '../ipc';
import type { AppApi } from '../useApp';
import type { AppState } from '../types';

function StartAtSignIn({ ipc, app }: { ipc: Ipc; app: AppApi }) {
  const [on, setOn] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    ipc
      .getAutostart()
      .then((v) => alive && setOn(v))
      .catch(() => alive && setOn(false));
    return () => {
      alive = false;
    };
  }, [ipc]);

  const toggle = (next: boolean) => {
    setOn(next);
    void app.act(() => ipc.setAutostart(next)).then(() => undefined);
  };

  return (
    <label className="check">
      <input
        type="checkbox"
        checked={on === true}
        disabled={on === null || app.busy}
        onChange={(e) => toggle(e.target.checked)}
      />
      <span>Start ProxyHubb Provider when I sign in to Windows</span>
    </label>
  );
}

function Footer({ ipc, app }: { ipc: Ipc; app: AppApi }) {
  return (
    <>
      <StartAtSignIn ipc={ipc} app={app} />
      <p className="muted small">
        Closing this window keeps sharing going. To stop completely, right-click the ProxyHubb icon near the
        clock and choose “Quit”.{' '}
        <button className="link" type="button" onClick={() => void app.act(() => ipc.openDashboard())}>
          Open my dashboard
        </button>
      </p>
    </>
  );
}

/**
 * Pause for a node this app started is one press. A node started outside the app (the CLI, the
 * website's setup script) is stopped only after a second, explicit press: the app does not stop
 * something it did not start without asking.
 */
function PauseOrStop({ ipc, app, managedExternally }: { ipc: Ipc; app: AppApi; managedExternally: boolean }) {
  const [asking, setAsking] = useState(false);

  if (!managedExternally) {
    return (
      <div className="actions">
        <button className="secondary" type="button" disabled={app.busy} onClick={() => void app.act(() => ipc.setSharing(false))}>
          Pause sharing
        </button>
      </div>
    );
  }

  if (!asking) {
    return (
      <div className="actions">
        <button className="secondary" type="button" disabled={app.busy} onClick={() => setAsking(true)}>
          Stop this node…
        </button>
      </div>
    );
  }

  return (
    <div className="banner warn" role="group" aria-label="Confirm stopping the node">
      <span>
        This node was started outside this app, for example from the command line. Stopping it here stops
        sharing, and the app will not start it again until you press Resume sharing.
      </span>
      <div className="actions">
        <button className="secondary" type="button" onClick={() => setAsking(false)}>
          Keep sharing
        </button>
        <button
          className="primary"
          type="button"
          disabled={app.busy}
          onClick={() => {
            setAsking(false);
            void app.act(() => ipc.stopOutsideNode());
          }}
        >
          Stop this node
        </button>
      </div>
    </div>
  );
}

export function Connecting({
  ipc,
  app,
  state,
}: {
  ipc: Ipc;
  app: AppApi;
  state: Extract<AppState, { kind: 'connecting' }>;
}) {
  return (
    <section aria-labelledby="connecting-title">
      <h1 id="connecting-title">Connecting…</h1>
      <p aria-live="polite">Your computer is getting online with ProxyHubb. This usually takes a few seconds.</p>
      {state.retry ? (
        <p className="muted" aria-live="polite">
          {formatRetrySentence(state.retry, state.detail, Date.now())}
        </p>
      ) : (
        state.detail && <p className="muted">Last attempt: {state.detail}</p>
      )}
      {/* Someone whose node cannot connect must still be able to stop it. */}
      <PauseOrStop ipc={ipc} app={app} managedExternally={state.managed_externally} />
      <Footer ipc={ipc} app={app} />
    </section>
  );
}

export function Sharing({
  ipc,
  app,
  state,
}: {
  ipc: Ipc;
  app: AppApi;
  state: Extract<AppState, { kind: 'sharing' }>;
}) {
  return (
    <section aria-labelledby="sharing-title">
      <h1 id="sharing-title">
        <span className="dot on" aria-hidden="true" /> Sharing is on
      </h1>
      <dl className="stats">
        <div>
          <dt>Connected for</dt>
          <dd>{formatDuration(state.uptime_seconds)}</dd>
        </div>
        <div>
          <dt>Shared so far</dt>
          <dd>
            {formatBytes(state.bytes_down + state.bytes_up)}
            <span className="muted small">
              {' '}
              ({formatBytes(state.bytes_down)} down, {formatBytes(state.bytes_up)} up)
            </span>
          </dd>
        </div>
        <div>
          <dt>Connections now</dt>
          <dd>{state.active_connections}</dd>
        </div>
      </dl>
      {state.managed_externally && (
        <p className="muted">Started outside this app, for example from the command line.</p>
      )}
      <PauseOrStop ipc={ipc} app={app} managedExternally={state.managed_externally} />
      <Footer ipc={ipc} app={app} />
    </section>
  );
}

export function Paused({ ipc, app }: { ipc: Ipc; app: AppApi }) {
  return (
    <section aria-labelledby="paused-title">
      <h1 id="paused-title">
        <span className="dot" aria-hidden="true" /> Sharing is paused
      </h1>
      <p>Nobody is using your connection right now. Resume whenever you like.</p>
      <div className="actions">
        <button className="primary" type="button" disabled={app.busy} onClick={() => void app.act(() => ipc.setSharing(true))}>
          Resume sharing
        </button>
      </div>
      <Footer ipc={ipc} app={app} />
    </section>
  );
}

export function Problem({
  ipc,
  app,
  state,
}: {
  ipc: Ipc;
  app: AppApi;
  state: Extract<AppState, { kind: 'problem' }>;
}) {
  return (
    <section aria-labelledby="problem-title">
      <h1 id="problem-title">
        <span className="dot bad" aria-hidden="true" /> Something needs attention
      </h1>
      <p role="alert">{state.reason}</p>
      <div className="actions">
        <button className="primary" type="button" disabled={app.busy} onClick={() => void app.act(() => ipc.setSharing(true))}>
          Try again
        </button>
      </div>
    </section>
  );
}
