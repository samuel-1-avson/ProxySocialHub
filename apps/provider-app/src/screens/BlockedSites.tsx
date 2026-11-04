import { useEffect, useRef, useState } from 'react';
import type { Ipc } from '../ipc';
import type { BlockedSitesSaved, RuleChange, RulesDraft } from '../types';

/**
 * The sites this computer refuses to connect to. The list is edited here, by hand or from a
 * change the rules assistant drafts in the provider's own words, and nothing is saved until
 * "Save and apply" is pressed. Like the connection check, this panel keeps its own busy and
 * error state: a draft can take a few seconds, and Pause must stay usable while it runs.
 */
export function BlockedSitesPanel({ ipc }: { ipc: Ipc }) {
  const [open, setOpen] = useState(false);
  const [sites, setSites] = useState<string[] | null>(null);
  const [savedSites, setSavedSites] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newSite, setNewSite] = useState('');
  const [words, setWords] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<RulesDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<BlockedSitesSaved | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Read the saved list when the panel is first opened; after that the panel works on its own
  // copy, so closing and reopening never throws away edits made here.
  useEffect(() => {
    if (!open || sites !== null) return;
    setLoadError(null);
    ipc
      .getNodeSettings()
      .then((s) => {
        if (!alive.current) return;
        setSites(s.blocked_hosts);
        setSavedSites(s.blocked_hosts);
      })
      .catch((e: unknown) => alive.current && setLoadError(errorWords(e, 'Could not read the blocked sites.')));
  }, [open, sites, ipc]);

  const dirty = sites !== null && savedSites !== null && JSON.stringify(sites) !== JSON.stringify(savedSites);

  const addSite = () => {
    const site = newSite.trim().toLowerCase();
    if (!site || sites === null) return;
    setNewSite('');
    if (!sites.includes(site)) setSites([...sites, site]);
  };

  const draftFromWords = () => {
    const text = words.trim();
    if (!text) return;
    setDrafting(true);
    setDraft(null);
    setDraftError(null);
    ipc
      .draftRules(text)
      .then((d) => alive.current && setDraft(d))
      .catch((e: unknown) => alive.current && setDraftError(errorWords(e, 'The rules assistant did not answer. You can still edit the list yourself.')))
      .finally(() => alive.current && setDrafting(false));
  };

  const save = () => {
    if (sites === null) return;
    setSaving(true);
    setSaved(null);
    setSaveError(null);
    ipc
      .saveBlockedSites(sites)
      .then((r) => {
        if (!alive.current) return;
        setSaved(r);
        setSites(r.blockedHosts);
        setSavedSites(r.blockedHosts);
        setDraft(null);
      })
      .catch((e: unknown) => alive.current && setSaveError(errorWords(e, 'The list could not be saved.')))
      .finally(() => alive.current && setSaving(false));
  };

  return (
    <details className="panel" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>Blocked sites</summary>
      <p className="muted small">
        Your computer refuses to connect to these sites, and their subdomains, for anyone using your connection.
        The list is kept and enforced on this computer.
      </p>
      {loadError && <p role="alert">{loadError}</p>}
      {!sites && !loadError && open && <p className="muted">Reading…</p>}
      {sites && (
        <>
          {sites.length === 0 ? (
            <p className="muted">No sites are blocked.</p>
          ) : (
            <ul className="sites">
              {sites.map((site) => (
                <li key={site}>
                  <span className="path">{site}</span>
                  <button
                    className="link"
                    type="button"
                    aria-label={`Remove ${site}`}
                    onClick={() => setSites(sites.filter((s) => s !== site))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="add-site"
            onSubmit={(e) => {
              e.preventDefault();
              addSite();
            }}
          >
            <label className="small" htmlFor="blocked-site-add">
              Block another site
            </label>
            <div className="add-row">
              <input
                id="blocked-site-add"
                type="text"
                value={newSite}
                placeholder="example.com"
                onChange={(e) => setNewSite(e.target.value)}
              />
              <button className="secondary" type="submit" disabled={!newSite.trim()}>
                Add site
              </button>
            </div>
          </form>

          <div className="draft-box">
            <label className="small" htmlFor="blocked-site-words">
              Or describe in your own words
            </label>
            <textarea
              id="blocked-site-words"
              value={words}
              maxLength={500}
              rows={3}
              placeholder="No gambling or adult sites, never Facebook, stop blocking old.example"
              onChange={(e) => setWords(e.target.value)}
            />
            <div className="actions">
              <button className="secondary" type="button" disabled={drafting || !words.trim()} onClick={draftFromWords}>
                {drafting ? 'Drafting… this can take a few seconds' : 'Draft a new list'}
              </button>
            </div>
            <p className="muted small">
              Your words are sent to ProxyHubb with this computer’s key. An assistant turns them into a list for you
              to check; nothing changes until you use the list and save it.
            </p>
            <div aria-live="polite">
              {draftError && <p role="alert">{draftError}</p>}
              {draft && (
                <DraftView
                  draft={draft}
                  onUse={() => {
                    setSites(draft.plan.blocked);
                    setDraft(null);
                  }}
                />
              )}
            </div>
          </div>

          <div className="actions">
            <button className="primary" type="button" disabled={saving || !dirty} onClick={save}>
              {saving ? 'Saving…' : 'Save and apply'}
            </button>
          </div>
          <div aria-live="polite">
            {saveError && <p role="alert">{saveError}</p>}
            {saved && (
              <>
                <p>{savedSentence(saved)}</p>
                {saved.rejected.length > 0 && (
                  <p className="muted small">These could not be used and were left out: {saved.rejected.join(', ')}.</p>
                )}
              </>
            )}
          </div>
        </>
      )}
    </details>
  );
}

function errorWords(e: unknown, fallback: string): string {
  return typeof e === 'string' ? e : fallback;
}

/** Where a drafted change came from: the provider named the site, or a category covers it. */
function sourceText(change: RuleChange, labels: Map<string, string>): string {
  if (change.source === 'named') return 'you named it';
  if (change.source.startsWith('category:')) {
    const id = change.source.slice('category:'.length);
    return `the ${labels.get(id) ?? id} category`;
  }
  return change.source;
}

function savedSentence(saved: BlockedSitesSaved): string {
  if (saved.restarted) return 'Saved. Your node was restarted, so the new list is in force now.';
  if (saved.needsRestart)
    return 'Saved. The node was started outside this app, so the new list needs a restart: it applies once the node is restarted.';
  return 'Saved. The new list applies when sharing starts.';
}

function DraftView({ draft, onUse }: { draft: RulesDraft; onUse: () => void }) {
  const plan = draft.plan;
  const labels = new Map(plan.categories.map((c) => [c.id, c.label]));
  return (
    <div className="draft">
      {plan.refused ? (
        <p>The assistant could not turn those words into a list change.</p>
      ) : plan.unchanged ? (
        <p>No change: those words leave your list as it is.</p>
      ) : (
        <>
          {plan.categories.length > 0 && (
            <ul className="findings">
              {plan.categories.map((c) => (
                <li key={`${c.id}-${c.action}`}>
                  {c.label}: {c.sites} sites {c.action === 'block' ? 'blocked' : 'no longer blocked'}.
                </li>
              ))}
            </ul>
          )}
          {plan.added.length > 0 && (
            <>
              <p>
                <strong>Newly blocked</strong>
              </p>
              <ul className="findings">
                {plan.added.map((c) => (
                  <li key={c.host}>
                    {c.host} <span className="muted small">({sourceText(c, labels)})</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {plan.removed.length > 0 && (
            <>
              <p>
                <strong>No longer blocked</strong>
              </p>
              <ul className="findings">
                {plan.removed.map((c) => (
                  <li key={c.host}>
                    {c.host} <span className="muted small">({sourceText(c, labels)})</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="actions">
            <button className="primary" type="button" onClick={onUse}>
              Use this list
            </button>
          </div>
        </>
      )}
      {plan.assumptions.length > 0 && (
        <>
          <p>
            <strong>The assistant guessed</strong> — check these:
          </p>
          <ul className="findings">
            {plan.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </>
      )}
      {plan.cannotDo.length > 0 && (
        <>
          <p>
            <strong>Can’t do</strong>
          </p>
          <ul className="findings">
            {plan.cannotDo.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      )}
      {plan.notes.length > 0 && (
        <ul className="findings">
          {plan.notes.map((n) => (
            <li key={n.message} className={n.level === 'info' ? 'note' : undefined}>
              {n.message}
            </li>
          ))}
        </ul>
      )}
      {plan.rejected.length > 0 && (
        <p className="muted small">Not used: {plan.rejected.join(', ')}.</p>
      )}
      <p className="muted small">
        Drafted by {draft.model || 'the assistant'}, data mode {draft.dataMode || 'unknown'}
        {draft.dataMode === 'standard' ? ' — your words are not used for training.' : '.'}
      </p>
    </div>
  );
}
