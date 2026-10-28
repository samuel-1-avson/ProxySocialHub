import { useState } from 'react';
import { CONSENT_CHECKBOX, CONSENT_INTRO, CONSENT_POINTS } from '../consent';
import { canAcceptConsent } from '../format';
import type { Ipc } from '../ipc';
import type { AppApi } from '../useApp';

export function Consent({ ipc, app }: { ipc: Ipc; app: AppApi }) {
  const [checked, setChecked] = useState(false);
  const [declined, setDeclined] = useState(false);

  return (
    <section aria-labelledby="consent-title">
      <h1 id="consent-title">Before you start sharing</h1>
      <p>{CONSENT_INTRO}</p>
      <ol className="points">
        {CONSENT_POINTS.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ol>
      <label className="check">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <span>{CONSENT_CHECKBOX}</span>
      </label>
      <div className="actions">
        <button className="secondary" type="button" onClick={() => setDeclined(true)}>
          Not now
        </button>
        <button
          className="primary"
          type="button"
          disabled={!canAcceptConsent(checked) || app.busy}
          onClick={() => void app.act(() => ipc.acceptConsent())}
        >
          I understand, continue
        </button>
      </div>
      {declined && (
        <p className="note" role="status">
          No problem. Nothing is shared until you agree. You can close this window.
        </p>
      )}
    </section>
  );
}
