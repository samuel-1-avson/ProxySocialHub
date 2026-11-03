"use client";

// Session assistant (agent concierge): the buyer describes a session, an AI model drafts it,
// lib/concierge-plan.ts checks it, and the buyer approves it here. Edits are re-checked in the
// browser with the same checker and the same active listings the server used.

import { useMemo, useState, type FormEvent } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { createSessionIntent, type CreateSessionIntentResponse } from "@/lib/api";
import { ApiError } from "@/lib/api/client";
import { draftSession, type ConciergeDraftResponse } from "@/lib/api/concierge";
import { BYTES_PER_GB, LIMITS, checkDraft, type PlanNote, type PlannedIntent } from "@/lib/concierge-plan";

/** Matches MAX_REQUEST_CHARS in lib/server/concierge-draft.ts. */
const MAX_CHARS = 500;
const EXAMPLE = "Sticky Ghana exit for Playwright tests of my own store, under $1 per GB, stop at $3.";

const EDITABLE = ["session_type", "country", "max_mb", "time_limit_minutes", "max_price_per_gb", "budget_usd"] as const;
type EditKey = (typeof EDITABLE)[number];
type Edits = Partial<Record<EditKey, string>>;

const NOTE_LABEL: Record<PlanNote["level"], string> = { blocked: "Must change", warning: "Changed", info: "Note" };

function applyEdits(draft: Record<string, unknown>, edits: Edits): Record<string, unknown> {
  const next = { ...draft };
  for (const key of EDITABLE) {
    const value = edits[key];
    if (value === undefined) continue;
    if (key === "session_type") next[key] = value;
    else if (key === "country") next[key] = value.trim() ? value.trim().toUpperCase() : null;
    else next[key] = value.trim() === "" ? null : Number(value);
  }
  return next;
}

function draftText(v: unknown): string {
  return typeof v === "number" || typeof v === "string" ? String(v) : "";
}

function usd(n: number): string {
  return n > 0 && n < 0.01 ? "under $0.01" : `$${n.toFixed(2)}`;
}

function size(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(bytes / BYTES_PER_GB).toFixed(2)} GB` : `${Math.round(mb)} MB`;
}

function rotation(intent: PlannedIntent): string {
  if (intent.rotation_type === "none") return "Off: one exit for the whole session";
  if (intent.rotation_type === "time-based") return `New exit every ${intent.rotation_interval_seconds ?? 60} s`;
  return "New exit for every request";
}

function failure(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status === 401) return "Sign in again to use the session assistant.";
  return err instanceof Error && err.message ? err.message : fallback;
}

export function SessionConcierge({ onCreated }: { onCreated: (intent: CreateSessionIntentResponse) => void }) {
  const [request, setRequest] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ConciergeDraftResponse | null>(null);
  const [edits, setEdits] = useState<Edits>({});

  const plan = useMemo(
    () => (result ? checkDraft(applyEdits(result.draft, edits), result.market) : null),
    [result, edits],
  );

  async function draft(event: FormEvent) {
    event.preventDefault();
    if (!request.trim() || drafting) return;
    setDrafting(true);
    setError("");
    setResult(null);
    setEdits({});
    try {
      setResult(await draftSession(request.trim()));
    } catch (err) {
      setError(failure(err, "The session assistant could not draft a plan. Fill in the session form yourself."));
    } finally {
      setDrafting(false);
    }
  }

  async function create() {
    if (!plan || plan.blocked || creating) return;
    setCreating(true);
    setError("");
    try {
      onCreated(await createSessionIntent(plan.intent));
      setResult(null);
      setEdits({});
      setRequest("");
    } catch (err) {
      setError(failure(err, "The session could not be created."));
    } finally {
      setCreating(false);
    }
  }

  const field = (key: EditKey) => edits[key] ?? draftText(result?.draft[key]);
  const edit = (key: EditKey) => (value: string) => setEdits((prev) => ({ ...prev, [key]: value }));
  const intent = plan?.intent;

  return (
    <section id="session-assistant" className="ui-surface" aria-labelledby="concierge-title">
      <div className="ui-section-heading">
        <div>
          <h2 id="concierge-title">Describe the session you need</h2>
          <p className="ui-muted ui-small">
            An AI assistant drafts it and every value is checked against the rules and today&apos;s listings. Nothing is created
            until you press Create session.
          </p>
        </div>
      </div>

      <form onSubmit={draft}>
        <label className="ui-field">
          <span>What do you need?</span>
          <textarea
            className="concierge-textarea"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            maxLength={MAX_CHARS}
            placeholder={EXAMPLE}
            aria-describedby="concierge-help"
          />
          <small id="concierge-help">
            Country, sticky or rotating, the sites you will use, a price limit or budget. {request.length}/{MAX_CHARS}
          </small>
        </label>
        <div className="ui-actions mt-4">
          <button className="ui-button" type="submit" disabled={!request.trim() || drafting}>
            {drafting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
            {drafting ? "Drafting…" : "Draft session"}
          </button>
        </div>
      </form>

      {error && (
        <div className="ui-error mt-4" role="alert">
          <p>{error}</p>
        </div>
      )}

      {result && plan && intent && (
        <div className="concierge-plan" aria-live="polite">
          <p className={`ui-status ${plan.blocked ? "error" : "good"}`}>
            {plan.blocked ? "Needs a change before it can be created" : "Ready to create"}
          </p>

          <dl className="concierge-values">
            <div>
              <dt>Session</dt>
              <dd>{intent.type === "sticky" ? "Sticky (one stable exit)" : "Rotating"}</dd>
            </div>
            <div>
              <dt>Country</dt>
              <dd>{intent.target_geo ?? "Any"}</dd>
            </div>
            <div>
              <dt>Rotation</dt>
              <dd>{rotation(intent)}</dd>
            </div>
            <div>
              <dt>Data cap</dt>
              <dd>{size(intent.bandwidth_limit)}</dd>
            </div>
            <div>
              <dt>Time limit</dt>
              <dd>{intent.time_limit_minutes} min</dd>
            </div>
            <div>
              <dt>Price billed</dt>
              <dd>{intent.max_price_per_gb === undefined ? "Set when you fund it" : `${usd(intent.max_price_per_gb)} per GB`}</dd>
            </div>
            <div>
              <dt>Allowed sites</dt>
              <dd>{intent.allowed_domains?.join(", ") ?? "Any"}</dd>
            </div>
            {intent.blocked_domains && (
              <div>
                <dt>Blocked sites</dt>
                <dd>{intent.blocked_domains.join(", ")}</dd>
              </div>
            )}
            {intent.preferred_tier && (
              <div>
                <dt>Tier</dt>
                <dd>{intent.preferred_tier}</dd>
              </div>
            )}
          </dl>

          <p className="concierge-cost">
            {plan.maxCostUsd === null ? (
              "The escrow amount is set when you fund the session."
            ) : (
              <>
                The escrow locks at most <strong>{usd(plan.maxCostUsd)}</strong>; unused data is refunded.
              </>
            )}{" "}
            <span className="ui-muted">
              {plan.matchingListings} active listing{plan.matchingListings === 1 ? "" : "s"} match.
            </span>
          </p>

          {plan.assumptions.length > 0 && (
            <div className="concierge-guesses">
              <h3>The assistant guessed</h3>
              <ul className="concierge-list">
                {plan.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}

          {plan.cannotDo.length > 0 && (
            <div>
              <h3>Not possible with this session</h3>
              <ul className="concierge-list">
                {plan.cannotDo.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {plan.notes.length > 0 && (
            <div>
              <h3>Checks</h3>
              <ul className="concierge-list">
                {plan.notes.map((n, i) => (
                  <li key={`${n.field}-${i}`} data-level={n.level}>
                    <strong>{NOTE_LABEL[n.level]}:</strong> {n.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <details className="concierge-edit">
            <summary>Change values</summary>
            <div className="ui-form-grid">
              <label className="ui-field">
                <span>Session</span>
                <select className="ui-select" value={field("session_type") || "rotating"} onChange={(e) => edit("session_type")(e.target.value)}>
                  <option value="rotating">Rotating</option>
                  <option value="sticky">Sticky</option>
                </select>
              </label>
              <label className="ui-field">
                <span>Country (two letters, empty for any)</span>
                <input className="ui-input" value={field("country")} maxLength={2} onChange={(e) => edit("country")(e.target.value)} />
              </label>
              <label className="ui-field">
                <span>Data cap in MB ({LIMITS.minMb}-{LIMITS.maxMb})</span>
                <input className="ui-input" type="number" inputMode="numeric" value={field("max_mb")} onChange={(e) => edit("max_mb")(e.target.value)} />
              </label>
              <label className="ui-field">
                <span>Time limit in minutes ({LIMITS.minMinutes}-{LIMITS.maxMinutes})</span>
                <input
                  className="ui-input"
                  type="number"
                  inputMode="numeric"
                  value={field("time_limit_minutes")}
                  onChange={(e) => edit("time_limit_minutes")(e.target.value)}
                />
              </label>
              <label className="ui-field">
                <span>Price limit, USD per GB</span>
                <input
                  className="ui-input"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={field("max_price_per_gb")}
                  onChange={(e) => edit("max_price_per_gb")(e.target.value)}
                />
              </label>
              <label className="ui-field">
                <span>Budget, USD</span>
                <input
                  className="ui-input"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={field("budget_usd")}
                  onChange={(e) => edit("budget_usd")(e.target.value)}
                />
              </label>
            </div>
          </details>

          <p className="ui-muted ui-small">
            Drafted by Meta {result.model.id} (
            {result.model.dataMode === "standard"
              ? "standard mode, your request is not used for training"
              : "contributor mode, your request may be used for training"}
            ). Sites are matched with their subdomains. Only use the session on sites you are allowed to access.
          </p>

          <div className="ui-actions">
            <button className="ui-button" type="button" onClick={create} disabled={plan.blocked || creating}>
              {creating && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              Create session
            </button>
            <button
              className="ui-button secondary"
              type="button"
              onClick={() => {
                setResult(null);
                setEdits({});
                setError("");
              }}
            >
              Start over
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
