# Node doctor, explained ("Ask the doctor")

**Date:** 2026-11-04 · **Branch:** `feat/node-doctor` · **Status:** built and tested locally;
the web route is not deployed yet, and no new node or app build has been published.

The node's own `doctor` checks are deterministic and already shown in the Provider app as
plain findings ("Check my connection"). They say *what* is wrong, one line per problem. "Ask
the doctor" adds the explanation a person actually needs: what it means and what to try, in
order — for example after "sharing stopped when I turned my VPN on".

A Meta model explains; it does not diagnose. The checks stay the source of truth, the
findings always show, and nothing on the computer is changed. Same shape as the session
assistant and plain-language provider rules: the model drafts strict JSON, deterministic code
checks it, the person reads it.

## 1. How it works

```
"Ask the doctor" ──► provider-node "doctor --explain --json"
                        │  1. runs the normal doctor (the full report stays on this computer)
                        │  2. POST /api/provider-doctor/draft (the node's own provider token,
                        │     20/user/hour, 300/hour overall) with ONLY each check's id,
                        │     outcome, severity and remediation code, plus the provider's
                        │     optional words — never messages, file paths or keys
                        │  3. model drafts an explanation (muse-spark-1.3, standard mode)
                        │  4. checker: lib/provider-doctor.ts
                        ▼
                     findings + advice (summary, steps in order, guesses, "can't tell")
                     shown together in the app; the findings also show when the
                     explanation cannot be fetched, with why.
```

The app never sees a credential: the node asks with its own token and derives the web address
from its configured control/API host (`--web-url` / `PROXYHUB_WEB_URL` overrides it).

Privacy is by construction, not by redaction. The doctor's messages and remediation text can
hold file paths (they name `provider.toml` and shell commands), so they are never sent. The
node's sanitiser (`doctor_explain.rs`) builds the payload field by field, and the web parser
(`parseDoctorChecks`) drops anything else a caller adds; both sides are pinned by tests that
feed them paths and a fake key and assert neither travels.

The checker decides:

| Rule | Why |
| --- | --- |
| A step may cite only a check that actually failed (the JSON schema's enum is built from the failed ids; the checker drops anything else) | The model cannot invent a failure or a fix for a passing check |
| At most 6 steps, at most 2 of them general; steps for errors come before warnings before general | Bounded, and the most important thing is first whoever ordered them |
| Only in-app / at-home actions (the instructions name them); never edit files, use a terminal, or share a key | The audience is non-technical, and dangerous advice is worse than none |
| A failure on ProxyHubb's side is explained as "wait", not "change settings" | People should not reconfigure a healthy computer during an outage |
| All text is length-capped; an unreadable draft is refused and only the findings show | A bad model answer can never hide a real problem |
| A healthy report with no question is answered without calling the model | "All N checks passed" needs no model — and costs nothing |

What each remediation code means in plain words lives server-side (`CODE_MEANINGS`), kept in
step with the codes pinned in `services/provider-node/src/doctor.rs` and the app wording in
`apps/provider-app/src-tauri/src/diagnosis.rs`. The provider's text is not logged.

## 2. From the CLI

```
provider-node doctor --explain [--text "sharing stopped after the update"] [--json] [--web-url URL]
```

Without `--json` it prints the usual doctor report, then the summary and steps. With `--json`
it prints `{ok, report, advice, model}` — the report is always there, so a caller can show the
findings even when `ok` is false (not connected, key unusable, model down). Plain
`provider-node doctor` is unchanged, including its exit code; `--explain` exits 1 only when
the explanation could not be fetched.

## 3. Files

| File | What |
| --- | --- |
| `apps/web/src/lib/provider-doctor.ts` | The checker: payload parser (privacy boundary), code meanings, plan building (pure, no imports) |
| `apps/web/src/lib/server/provider-doctor-draft.ts` | Prompt, per-report strict output format, drafting steps |
| `apps/web/src/app/api/provider-doctor/draft/route.ts` | `POST /api/provider-doctor/draft` (same audit wrapper, Meta client and rate limiter as the other assistants) |
| `apps/web/scripts/provider-doctor.test.mjs`, `provider-doctor-draft.test.mjs` | Unit tests (13): `npm run test:provider-doctor`, `npm run test:provider-doctor-draft` |
| `services/provider-node/src/doctor_explain.rs` | Sanitised payload, the web call, outcome shaping (report always included) |
| `services/provider-node/src/main.rs` | `doctor --explain [--text] [--web-url]` |
| `apps/provider-app/src-tauri/src/diagnosis.rs` | `parse_explain`: findings (as before) + advice, or findings + why there is no advice |
| `apps/provider-app/src-tauri/src/node.rs`, `engine.rs`, `commands.rs` | Sidecar call, engine `explain_doctor` (consent-gated, stateless), Tauri command |
| `apps/provider-app/src/screens/Details.tsx`, `DoctorAdvice.tsx` | "Ask the doctor" in the "Something wrong?" panel: optional words, ordered steps, guesses, model + data mode |
| `apps/provider-app/src/ipc.ts`, `mock.ts`, `types.ts` | The new command on the window↔Rust surface (22 commands now), browser mock (`?doctor=fail`), shared types |

## 4. Running it

```
# apps/web: needs MODEL_API_KEY (already in the VM's .env for the other assistants)
next dev -H 127.0.0.1 -p 4027

# always pin a scratch config on a machine with a real provider node
provider-node doctor --explain --config <scratch>/provider.toml \
  --text "sharing stopped" --json --web-url http://127.0.0.1:4027
```

A full end-to-end run against the real model needs a paired node's token (the route answers
401 without one, verified locally). On a machine with a real provider config that means
waiting until the published app/node builds carry this and using "Ask the doctor" there;
do not point a scratch config at the production API with a copied key.

Tests: web `npm run test:provider-doctor` + `npm run test:provider-doctor-draft` + typecheck +
eslint; node `cargo test` in `services/provider-node`; app `cargo test --locked` in
`apps/provider-app/src-tauri` (needs `npm ci` + `npm run build` and the sidecar binary),
frontend `npm test` + `npm run typecheck`.

Deploying is web-only (the route); the node and app ship with their next published builds.

## 5. Limits and what this is not

- It explains; it never fixes. There are no "Fix it" buttons and no setting is changed.
  Mechanical fixes (clear a stale PID, restart) already exist as app actions; the steps can
  point at them ("pause and resume sharing").
- It knows only what the doctor checks. Buyer demand, listing state, earnings and anything
  server-side beyond health/auth are invisible to it, and the prompt requires saying so in
  "The checks can't tell" rather than guessing.
- The explanation costs one model call, rate-limited with the other assistants. The plain
  findings ("Check my connection") stay free, local-config-free and instant by comparison,
  and remain the thing support will ask for first (with the support file, which is unchanged
  and still redacted).
