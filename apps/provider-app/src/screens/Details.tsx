import { useEffect, useRef, useState } from 'react';
import { formatAgo, formatSol, serverLine } from '../format';
import type { Ipc } from '../ipc';
import type { AppApi } from '../useApp';
import type { Diagnosis, DoctorExplained, RemoteView } from '../types';
import { DoctorAdviceView } from './DoctorAdvice';

/** What ProxyHubb's servers say about this computer, and how old that answer is. */
export function ServerStatus({ ipc, app, remote }: { ipc: Ipc; app: AppApi; remote: RemoteView }) {
  const line = serverLine(remote.server);
  const dot = line.tone === 'good' ? 'dot on' : line.tone === 'bad' ? 'dot bad' : 'dot';
  return (
    <section className="panel" aria-labelledby="server-title">
      <h2 id="server-title">On ProxyHubb</h2>
      <p className="status-line" aria-live="polite">
        <span className={dot} aria-hidden="true" /> {line.text}
      </p>
      <p className="muted small">
        {remote.updated_at_unix !== null && <>Checked {formatAgo(remote.updated_at_unix, Date.now())}. </>}
        <button className="link" type="button" disabled={app.busy} onClick={() => void app.act(() => ipc.refreshAccount())}>
          Refresh
        </button>
      </p>
    </section>
  );
}

export function Earnings({ remote }: { remote: RemoteView }) {
  const e = remote.earnings;
  return (
    <section className="panel" aria-labelledby="earnings-title">
      <h2 id="earnings-title">Earnings</h2>
      {e ? (
        <dl className="stats">
          <div>
            <dt>Last 7 days</dt>
            <dd>{formatSol(e.last_7_days_sol)}</dd>
          </div>
          <div>
            <dt>Last 30 days</dt>
            <dd>{formatSol(e.last_30_days_sol)}</dd>
          </div>
          <div>
            <dt>Waiting to be paid</dt>
            <dd>{formatSol(e.pending_sol)}</dd>
          </div>
          <div>
            <dt>Paid so far</dt>
            <dd>{formatSol(e.paid_sol)}</dd>
          </div>
        </dl>
      ) : remote.server === 'checking' ? (
        <p className="muted">Loading earnings…</p>
      ) : (
        <p className="muted">Earnings could not be loaded right now.</p>
      )}
      <p className="muted small">
        Earnings are credited when a buyer’s session ends and its usage is settled, so they can lag behind what you have
        shared.
      </p>
    </section>
  );
}

/**
 * "Check my connection" and "Save support details". Kept in its own state, not the app's busy
 * flag: a check can take a minute, and Pause must stay usable while it runs.
 */
export function Diagnose({ ipc }: { ipc: Ipc }) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Diagnosis | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [symptom, setSymptom] = useState('');
  const [asking, setAsking] = useState(false);
  const [explained, setExplained] = useState<DoctorExplained | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const words = (e: unknown) => (typeof e === 'string' ? e : 'Something went wrong. Please try again.');

  const check = () => {
    setChecking(true);
    setResult(null);
    setCheckError(null);
    setExplained(null);
    ipc
      .runDiagnosis()
      .then((r) => alive.current && setResult(r))
      .catch((e: unknown) => alive.current && setCheckError(words(e)))
      .finally(() => alive.current && setChecking(false));
  };

  const ask = () => {
    setAsking(true);
    setExplained(null);
    setAskError(null);
    ipc
      .explainDoctor(symptom.trim() || null)
      .then((e) => {
        if (!alive.current) return;
        setResult(e.diagnosis);
        setCheckError(null);
        setExplained(e);
      })
      .catch((e: unknown) => alive.current && setAskError(words(e)))
      .finally(() => alive.current && setAsking(false));
  };

  const save = () => {
    setSaving(true);
    setSaved(null);
    setSaveError(null);
    ipc
      .saveSupportDetails()
      .then((path) => alive.current && setSaved(path))
      .catch((e: unknown) => alive.current && setSaveError(words(e)))
      .finally(() => alive.current && setSaving(false));
  };

  return (
    <section className="panel" aria-labelledby="diagnose-title">
      <h2 id="diagnose-title">Something wrong?</h2>
      <div className="actions">
        <button className="secondary" type="button" disabled={checking} onClick={check}>
          {checking ? 'Checking… this can take a minute' : 'Check my connection'}
        </button>
        <button className="secondary" type="button" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save support details'}
        </button>
      </div>

      <div aria-live="polite">
        {result &&
          (result.findings.length === 0 ? (
            <p className="muted">
              The checks found nothing wrong on this computer. If sharing still does not start, save the support
              details and send them to ProxyHubb support.
            </p>
          ) : (
            <ul className="findings">
              {result.findings.map((f) => (
                <li key={f.text} className={f.level}>
                  <strong>{f.level === 'problem' ? 'Problem: ' : 'Note: '}</strong>
                  {f.text}
                </li>
              ))}
            </ul>
          ))}
        {checkError && <p role="alert">{checkError}</p>}
        {saved && (
          <p className="muted small">
            Saved. A folder window opened showing the file ({saved}).
          </p>
        )}
        {saveError && <p role="alert">{saveError}</p>}
      </div>


      <div className="draft-box">
        <label className="small" htmlFor="doctor-words">
          What’s happening? (optional)
        </label>
        <textarea
          id="doctor-words"
          value={symptom}
          maxLength={500}
          rows={2}
          placeholder="Sharing stopped after I turned my VPN on"
          onChange={(e) => setSymptom(e.target.value)}
        />
        <div className="actions">
          <button className="secondary" type="button" disabled={asking} onClick={ask}>
            {asking ? 'Asking… this can take a minute' : 'Ask the doctor'}
          </button>
        </div>
        <p className="muted small">
          This runs the same checks, then sends the results (no file paths and no keys) and your words to ProxyHubb.
          An assistant explains them and orders what to try. Nothing on this computer is changed.
        </p>
        <div aria-live="polite">
          {askError && <p role="alert">{askError}</p>}
          {explained?.adviceError && (
            <p className="muted">
              The explanation could not be fetched: {explained.adviceError} The findings above still stand.
            </p>
          )}
          {explained?.advice && (
            <DoctorAdviceView advice={explained.advice} model={explained.model} dataMode={explained.dataMode} />
          )}
        </div>
      </div>

      <p className="muted small">
        The support file leaves out your keys and passwords. It does include folder names on this computer, your
        account’s ID and the end of the node’s log, so send it only to ProxyHubb support.
      </p>
    </section>
  );
}
