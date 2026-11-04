import type { DoctorAdvice } from '../types';

/**
 * The doctor assistant's checked explanation: what the checks mean and what to try, in order.
 * Steps were already checked against the checks that failed; this only lays them out. The
 * plain findings above stay the source of truth.
 */
export function DoctorAdviceView({
  advice,
  model,
  dataMode,
}: {
  advice: DoctorAdvice;
  model: string;
  dataMode: string;
}) {
  if (advice.refused) {
    return (
      <div className="draft">
        <p>The assistant could not explain these results. The findings above still stand.</p>
        {advice.notes.length > 0 && (
          <ul className="findings">
            {advice.notes.map((n) => (
              <li key={n.message} className={n.level === 'info' ? 'note' : undefined}>
                {n.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="draft">
      <p>{advice.summary}</p>
      {advice.steps.length > 0 && (
        <>
          <p>
            <strong>What to try, in order</strong>
          </p>
          <ol className="steps">
            {advice.steps.map((s) => (
              <li key={`${s.checkId ?? 'general'}-${s.title}`}>
                <strong>{s.title}: </strong>
                {s.detail}
              </li>
            ))}
          </ol>
        </>
      )}
      {advice.assumptions.length > 0 && (
        <>
          <p>
            <strong>The assistant guessed</strong> — check these:
          </p>
          <ul className="findings">
            {advice.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </>
      )}
      {advice.cannotDo.length > 0 && (
        <>
          <p>
            <strong>The checks can’t tell</strong>
          </p>
          <ul className="findings">
            {advice.cannotDo.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      )}
      {advice.notes.length > 0 && (
        <ul className="findings">
          {advice.notes.map((n) => (
            <li key={n.message} className={n.level === 'info' ? 'note' : undefined}>
              {n.message}
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        Explained by {model || 'the assistant'}, data mode {dataMode || 'unknown'}
        {dataMode === 'standard' ? ' — your words are not used for training.' : '.'}
      </p>
    </div>
  );
}
