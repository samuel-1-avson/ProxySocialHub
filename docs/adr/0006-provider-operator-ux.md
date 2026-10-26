# ADR 0006: Provider operator UX — web dashboard, not a TUI

**Status:** Accepted (amended 2026-06-04)
**Date:** 2026-06-04
**Context:** Provider deep-dive asked whether a dedicated terminal UI (ratatui/cursive) should exist alongside `provider-node` and the web dashboard.

## Decision

We will **not** build a full-screen provider TUI in the near term.

Operator workflows stay on:

1. **`provider-node` CLI** — `register`, `start`, `metrics`, `stop` (daemon + local stats on port 9090).
2. **Web provider dashboard** — nodes, earnings, services, relationships, CLI download/connect.
3. **Optional `proxyhubb-cli`** — thin dev onboarding wrapper only.

## Rationale

- The product surface is already split correctly: **daemon** (Rust) + **control plane** (Go API) + **dashboard** (Next.js).
- A TUI would duplicate health/metrics already exposed at `http://localhost:9090/stats` and in the dashboard, with ongoing sync cost.
- Provider operators on Windows need reliable **stop** and service install docs more than a curses UI.
- If we add richer local UX later, prefer **`provider-node status --config <path>`** (one-shot JSON/text) over a persistent TUI.

## Consequences

- Document `provider-node` as the production binary; keep dashboard CLI page aligned.
- Invest in API contract tests and Windows stop instead of ratatui.
- Revisit only if we ship an offline/air-gapped operator bundle with no browser.

## Alternatives considered

| Option | Rejected because |
|--------|------------------|
| ratatui dashboard in `proxyhubb-cli` | Duplicates web + metrics HTTP; high maintenance |
| `provider-node dashboard` subcommand | Possible future incremental step; not required now |
| Electron desktop app | Out of scope for bandwidth sellers |

## Amendment (2026-06-04)

We added two **local-only** operator commands to `provider-node` without replacing the web dashboard:

- **`provider-node doctor`** — pre-flight checks (config, Control API health, provider auth, gateway, signing key, PID/metrics).
- **`provider-node dashboard`** — ratatui live view of process state, local `/stats`, and Control API node list.

These complement `status --json` for scripting and the web UI for account-level workflows. A full-screen “command center” TUI that duplicates earnings, tokens, or moderation remains out of scope.

**Further amendment (same day):**

- **`provider-node watch`** — non-curses refresh loop for SSH/headless operators.
- **`provider-node install`** — prints canonical paths (`~/.config/proxyhubb`, `~/.proxyhubb`) and OS service hints.
- **`proxyhubb-cli`** — unified wrapper: `join` writes config; all runtime commands delegate to `provider-node` (including dev `PROXYHUB_CLI_DEV` → `cargo run`).
- **Deeper TUI** — `dashboard` uses `OperatorSnapshot` (status + earnings summary + runtime.json + log tail).
- **Distribution** — `rebuild-cli.ps1` emits `provider-cli-*` alongside `provider-node-*`.
