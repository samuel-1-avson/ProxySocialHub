import { useEffect, useState } from 'react';
import { listOrNone, offerSentence, updateSentence } from '../format';
import type { Ipc } from '../ipc';
import type { NodeSettings } from '../types';
import type { AppApi } from '../useApp';

/** A newer installer exists. The app does not update itself; it opens the download page. */
export function UpdateBanner({ ipc, app }: { ipc: Ipc; app: AppApi }) {
  const update = app.update;
  if (!update) return null;
  return (
    <div className="banner" role="status">
      <span>{updateSentence(update.latest, update.current)}</span>
      <div className="actions">
        <button className="secondary" type="button" onClick={app.dismissUpdate}>
          Not now
        </button>
        <button className="primary" type="button" onClick={() => void app.act(() => ipc.openDownloadPage())}>
          Get it
        </button>
      </div>
    </div>
  );
}

/** This computer's node settings, for reading. Nothing here can be changed from the app. */
export function NodeSettingsPanel({ ipc }: { ipc: Ipc }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<NodeSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read when opened, each time, so what is shown is what the file says now.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError(null);
    ipc
      .getNodeSettings()
      .then((s) => alive && setSettings(s))
      .catch((e: unknown) => alive && setError(typeof e === 'string' ? e : 'Could not read the settings.'));
    return () => {
      alive = false;
    };
  }, [open, ipc]);

  return (
    <details className="panel" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>Node settings</summary>
      {error && <p role="alert">{error}</p>}
      {!settings && !error && open && <p className="muted">Reading…</p>}
      {settings && (
        <>
          <dl className="settings">
            <div>
              <dt>Gateways</dt>
              <dd>{listOrNone(settings.gateways, 'none')}</dd>
            </div>
            <div>
              <dt>Connection</dt>
              <dd>
                {settings.transport || 'unknown'}, certificate checks {settings.tls_skip_verify ? 'off' : 'on'}
              </dd>
            </div>
            <div>
              <dt>Offered to ProxyHubb</dt>
              <dd>{offerSentence(settings.max_connections, settings.bandwidth_limit_mbps)}</dd>
            </div>
            <div>
              <dt>Allowed ports</dt>
              <dd>{listOrNone(settings.allowed_ports, 'none')}</dd>
            </div>
            <div>
              <dt>Blocked sites</dt>
              <dd>{listOrNone(settings.blocked_hosts, 'none')}</dd>
            </div>
            <div>
              <dt>Connection type</dt>
              <dd>{settings.connection_type || 'not set'}</dd>
            </div>
          </dl>
          {settings.tls_skip_verify && (
            <p className="banner warn" role="alert">
              Certificate checks for the gateway are turned off. That is for development only.
            </p>
          )}
          <p className="muted small">
            The connections and speed tell ProxyHubb what this computer offers. The node does not slow your own
            connection down to them. These settings cannot be changed from the app yet.
          </p>
          <p className="muted small path">Settings file: {settings.config_path}</p>
        </>
      )}
    </details>
  );
}

/**
 * "Disconnect this computer": asks once, says what it does and what it does not do. It cannot
 * revoke the key; the reminder to do that comes on the next screen.
 */
export function Disconnect({ ipc, app }: { ipc: Ipc; app: AppApi }) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <p className="muted small">
        <button className="link" type="button" disabled={app.busy} onClick={() => setAsking(true)}>
          Disconnect this computer…
        </button>
      </p>
    );
  }

  return (
    <div className="banner warn" role="group" aria-label="Confirm disconnecting this computer">
      <strong>Disconnect this computer?</strong>
      <span>
        This stops sharing and disconnects this computer from your ProxyHubb account. Its settings file is kept, and
        it still holds this computer’s key, so there is one more step afterwards: revoking that key in your dashboard.
      </span>
      <div className="actions">
        <button className="secondary" type="button" onClick={() => setAsking(false)}>
          Cancel
        </button>
        <button
          className="primary"
          type="button"
          disabled={app.busy}
          onClick={() => {
            setAsking(false);
            void app.act(async () => app.setDisconnected(await ipc.disconnect()));
          }}
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}

/** Shown on the Connect screen right after a disconnect: the key is still valid until revoked. */
export function DisconnectedReminder({ ipc, app }: { ipc: Ipc; app: AppApi }) {
  const result = app.disconnected;
  if (!result) return null;
  return (
    <div className="banner warn" role="status">
      <strong>This computer is disconnected</strong>
      <span>
        One step is left. Its key still works until you revoke it: open Tokens in your dashboard and revoke the token
        named {'“Paired: <this computer’s name>”'}.
      </span>
      {result.archived_config && (
        <span className="muted small path">
          The settings were kept in {result.archived_config}. Delete that file once the key is revoked.
        </span>
      )}
      <div className="actions">
        <button className="secondary" type="button" onClick={() => app.setDisconnected(null)}>
          Done
        </button>
        <button className="primary" type="button" onClick={() => void app.act(() => ipc.openTokensPage())}>
          Open Tokens
        </button>
      </div>
    </div>
  );
}
