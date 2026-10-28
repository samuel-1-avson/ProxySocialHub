# ProxyHubb Provider app (Tauri tray app, Windows first)

Ticket: none (GitHub issues not used for this work). Roadmap: memory `provider-app-roadmap`, step 2 of 4.
Depends on open PRs #65 (`start --background`, Windows sign-in entry) and #66 (`pair`). This branch
(`feat/provider-app`) is a linear stack on both; rebase onto main as they merge.

## Goal, as a measurable outcome

A non-technical person on Windows can: download one installer, double-click it (no admin prompt, no
terminal), read a plain-language consent screen, approve one code in their browser, and see
"Sharing" in a tray app that keeps their node online 24/7 and comes back after a restart.
Success = this path passes end to end on a clean Windows profile, with zero commands typed.

## Architecture

```text
 React UI (webview, strict CSP, no shell/fs access)
      |  typed commands + events only
 src-tauri (Rust)  -- node driver --> runs FIXED subcommands of the bundled sidecar:
      |                                 provider-node status --json | start --background | stop
      |                                 provider-node pair --json
      |  tray, single-instance, autostart, opener (https://proxyhubb.com/* only)
 provider-node  (same binary the CLI ships; detached daemon; config shared with the CLI)
```

- The app is a thin shell: one implementation of the protocol (`provider-node`), no duplicated
  pairing or tunnel code. Headless/VPS providers keep using the CLI unchanged.
- Config and state live exactly where the CLI puts them (`provider.toml`, `~/.proxyhubb/`), so
  app and CLI users see the same node.
- UI state is derived, never stored: `NeedsConsent | NeedsPairing | Pairing{code,link} |
  Connecting | Sharing | Paused | Problem{reason}`. The only persisted app settings are consent
  (version + timestamp) and the user's sharing intent.

### Lifecycle rules (decided in the gate below)
- Closing the window hides it to the tray; sharing continues.
- Tray **Quit** stops sharing and exits (label says so). The next launch resumes if the intent is "on".
- **Pause** stops the daemon and records intent "off" until the user resumes.
- Start at sign-in launches the app hidden (`--hidden`); it resumes sharing if intent is "on".
- A second launch focuses the existing window.

## Draft consent text, v1 (needs your / legal review before any public release)

Every factual claim below is checked against the code; the risk sentence is judgment.

> **Before you start sharing**
> ProxyHubb Provider lets people who buy bandwidth on ProxyHubb browse the internet *through your
> connection*. Please read what that means:
> 1. Websites they visit will see **your home internet address**, not theirs.
> 2. Their traffic uses **your** internet speed and data allowance. You can pause sharing any time.
> 3. Only web traffic is allowed (ports 80, 443, 8080 and 8443), and connections to private or local
>    addresses on your own network are blocked.
> 4. ProxyHubb's rules say buyers must use the service lawfully, but you are the owner of the
>    connection. If someone misuses it, your internet provider may contact you. Sharing is not risk-free.
>
> [ ] I own this internet connection, or I have permission from whoever does, and I understand the above.
> [Not now]  [I understand, continue]

Checked: ports = `default_allowed_ports` (80, 443, 8080, 8443); private/loopback/link-local blocked
by `is_public_ip` in `proxy/handler.rs`; "lawful use" = the existing Terms page. Not checked: the
ISP-contact sentence. The existing Terms say nothing about a provider's own exposure, so this text
is new, not borrowed.

## Phases

Slicing is vertical where possible and risk-first: Phase 0 proves the toolchain and sidecar
packaging before anything is built on them; Phase 1 can run in parallel with it.

### Phase 0: Spike (fail fast)
Verified when: a Tauri window with a tray icon runs on this machine, can call the bundled
`provider-node --version` from Rust, and `tauri build` produces an installer, or the fallback in
"Not yet specified" is taken.
Files: `apps/provider-app/**` (scaffold only).

#### Step 0.1: Scaffold with pinned dependencies (Size: S)
- Acceptance: `apps/provider-app` builds a blank Vite+React page and `cargo check` passes in `src-tauri`.
- Acceptance: every dependency pinned exactly and at least two weeks old (see "Dependency intake").
- Verification: `cd apps/provider-app && npm ci && npm run build && (cd src-tauri && cargo check --locked)`
- Files: `package.json`, `package-lock.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src-tauri/{Cargo.toml,Cargo.lock,build.rs,tauri.conf.json,capabilities/default.json,src/{main,lib}.rs}`, `.gitignore`
- Seams: build only. Blocked by: none.

#### Step 0.2: Window, tray and bundled sidecar actually run (Size: M)
- Acceptance: `tauri dev` shows the window and a tray icon; a Rust command returns the sidecar's `--version`.
- Acceptance: `tauri build --no-bundle` yields an exe that finds `provider-node.exe` next to itself and runs it.
- Acceptance: `tauri build` (NSIS, per-user) yields an installer, which is built but **not installed** on this machine.
- Verification: `npm run tauri build -- --no-bundle` then run the exe and call the version command; `npm run tauri build` for the installer.
- Files: `src-tauri/{tauri.conf.json,src/lib.rs}`, `scripts/build-sidecar.mjs`
- Seams: the packaged exe. Blocked by: 0.1.

### Phase 1: provider-node machine interface (parallel with Phase 0)
Verified when: the app can drive pairing and read status without parsing human text.
Files: `services/provider-node/src/{pair.rs,main.rs}`.

#### Step 1.1: `pair --json` event stream (Size: S)
- Acceptance: with `--json`, stdout is JSON lines only (`code`, `approved`, `denied`, `expired`, `error`), no browser is opened, and the human banner is suppressed.
- Acceptance: exit code is 0 only after `provider.toml` is written; any failure is exactly one `error` event.
- Verification: `cd services/provider-node && cargo test --locked pair::` plus a real run against the mock control-api (the pair test server).
- Files: `src/pair.rs`, `src/main.rs`
- Seams: `pair::tests` (existing scripted server). Blocked by: none.

#### Step 1.2: Pin the `status --json` contract the app reads (Size: XS)
- Acceptance: a golden-file test fails if `StatusReport` / `stats::Snapshot` / `RuntimeState` fields the app uses are renamed or removed.
- Verification: `cargo test --locked status::`
- Files: `src/status.rs` (test only). Blocked by: none.

### Phase 2: App core (Rust)
Verified when: every UI state is reachable from canned sidecar output in unit tests.
Files: `src-tauri/src/{state,settings,node,pairing,commands}.rs`, `src-tauri/capabilities/*.json`.

#### Step 2.1: Settings and consent store (Size: S)
- Acceptance: consent (version + timestamp) and sharing intent persist atomically; a consent version bump re-requires consent; a corrupt file degrades to "no consent", never to "accepted".
- Verification: `cd src-tauri && cargo test --locked settings::`
- Seams: pure functions over a temp dir. Blocked by: 0.1.

#### Step 2.2: Node driver and state derivation (Size: M)
- Acceptance: fixed subcommands only (`status --json`, `start --background`, `stop`, `pair --json`); arguments are never built from webview input.
- Acceptance: canned outputs map to the right state: running+tunnel up = Sharing; running+tunnel down = Connecting; no process = Paused/Problem by intent; control API unreachable = Problem with a plain reason.
- Acceptance: pairing process events are forwarded as typed events; cancelling kills the child and leaves no config.
- Verification: `cargo test --locked node:: state::`
- Seams: parsing and `derive_state()` over canned JSON; process spawning is covered in Phase 5. Blocked by: 0.2, 1.1.

#### Step 2.3: Commands, events and capabilities (Size: S)
- Acceptance: webview can only call `app_state, accept_consent, begin_pairing, cancel_pairing, set_sharing, set_autostart, open_dashboard`; no shell, fs or arbitrary URL capability is granted; CSP is `default-src 'self'`.
- Acceptance: `open_dashboard` and the pairing link open only `https://proxyhubb.com/*` (opener scope).
- Verification: `cargo test --locked commands::` plus a test that parses `capabilities/*.json` and fails on any permission outside an allow-list.
- Blocked by: 2.1, 2.2.

### Phase 3: UI (React, plain CSS tokens, light/dark)
Verified when: a person can complete consent → pairing → sharing in the UI with mocked IPC, and the screens read correctly at 360 px and 1280 px.
Files: `src/{App.tsx,state.ts,ipc.ts,screens/*.tsx,styles.css}`.

#### Step 3.1: Shell, state hook and the three first-run screens (Size: M)
- Acceptance: Consent (checkbox gates the button), Pairing (large code, link, waiting, cancel, expiry), and a failure path for denied/expired.
- Verification: `npm run typecheck && npm test` and a look in a browser against mocked IPC.
- Blocked by: 2.3.

#### Step 3.2: Home screen (Size: M)
- Acceptance: connection status in words, Pause/Resume, "Start when I sign in" toggle, data shared today and uptime, a link to the dashboard, and a Problem state with a plain reason and "Try again".
- Verification: same as 3.1. Blocked by: 3.1.

#### Step 3.3: UI tests and visual check (Size: S)
- Acceptance: Vitest covers the state reducer, byte/duration formatters and the consent gate; screenshots of every screen in light and dark are reviewed.
- Verification: `npm test`; screenshots via the built-in browser against a Vite dev server with mocked IPC.
- Blocked by: 3.2.

### Phase 4: Tray and lifecycle
Verified when: the lifecycle rules above hold on a real window.
Files: `src-tauri/src/{tray,lifecycle}.rs`, `src-tauri/Cargo.toml`.

#### Step 4.1: Tray menu, hide-to-tray, single instance, `--hidden` (Size: M)
- Acceptance: menu has Open, Pause/Resume, Quit (stops sharing); close hides; a second launch focuses; `--hidden` starts without a window.
- Verification: `cargo test --locked lifecycle::` (decision logic) and the Phase 5 run.
- Blocked by: 2.3.

#### Step 4.2: Start at sign-in (Size: S)
- Acceptance: the toggle writes/removes the app's own sign-in entry with `--hidden`; a leftover `provider-node service install` entry is harmless (`start --background` is idempotent) and is documented.
- Verification: unit test with the plugin behind a trait and a fake; **never** against the real HKCU Run key.
- Blocked by: 4.1.

### Phase 5: End to end on Windows (real exe, real sidecar, real handlers)
Verified when: the primary path passes with zero commands typed, and the failure paths behave.
Files: `apps/provider-app/e2e/**`.

#### Step 5.1: Harness (Size: M)
- Acceptance: a script starts Postgres + the real control-api handlers (the pairing test harness pattern), launches the built exe with WebView2 remote debugging on, and attaches Playwright over CDP.
- Verification: `npm run e2e:smoke` launches the exe and reads the consent screen text.
- Blocked by: 3.2, 4.1.

#### Step 5.2: Flows (Size: M)
- Acceptance: consent → pairing → owner approves via the owner endpoint → "Sharing"; pause/resume; quit-then-relaunch resumes; close-to-tray keeps the daemon alive.
- Acceptance: denied and expired codes show the right screen and write no config.
- Verification: `npm run e2e` with screenshots saved. Blocked by: 5.1.

### Phase 6: Packaging, CI, docs
Verified when: CI builds and tests the app on every relevant PR; docs describe the app.
Files: `.github/workflows/proxyhubb-ci.yml`, `apps/docs/content/provider/app.mdx`, `src-tauri/icons/**`.

#### Step 6.1: Sidecar build, icons, NSIS per-user config (Size: S)
- Acceptance: `npm run build:app` builds provider-node release, copies it with the target triple, builds the installer; icon set generated from `apps/docs/app/icon.svg` rendered to 1024 px.
- Verification: `npm run build:app` produces `…-setup.exe`. Blocked by: 0.2.

#### Step 6.2: CI job (Size: S)
- Acceptance: `provider-app-check` on `windows-latest`, path-filtered to `apps/provider-app/**` and `services/provider-node/**`: `cargo fmt --check`, `clippy -D warnings`, `cargo test --locked`, `npm ci && typecheck && test && build`; actions pinned by SHA.
- Verification: `actionlint` locally, then green on the PR. Blocked by: 3.3, 6.1.

#### Step 6.3: Docs (Size: S)
- Acceptance: a "Provider app" docs page (what it does, what it shares, how to pause/uninstall); `cli.mdx` points non-technical readers to it.
- Verification: docs build check in CI. Blocked by: 5.2.

## Dependency intake (security-and-hardening checklist)

All from the `tauri-apps` organisation (official), pinned exactly, at least two weeks old; install
scripts to be read before first install (`npm view <pkg> scripts`); lockfiles committed.

| Package | Pin | Age | Why it is needed |
| --- | --- | --- | --- |
| crate `tauri` (feature `tray-icon`) | 2.12.3 | 17 d | the app framework + tray |
| crate `tauri-build` | 2.7.2 | 17 d | build script |
| crate `tauri-plugin-autostart` | 2.7.0 | 27 d | start at sign-in |
| crate `tauri-plugin-single-instance` | 2.5.3 | 17 d | one tray per user |
| crate `tauri-plugin-opener` | newest ≥ 14 d at install | check | open the dashboard link, scoped to proxyhubb.com |
| npm `@tauri-apps/cli`, `@tauri-apps/api` | 2.12.x, newest ≥ 14 d (2.12.4 is 7 d old: not used) | check | CLI + IPC bindings; api minor must match the crate |
| npm `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `typescript`, `vitest` | current stable at install, exact | check | UI and tests |

Deliberately **not** added: `tauri-plugin-shell` (the Rust side spawns the sidecar with
`std::process::Command`, so the webview never gets an exec capability), `tokio` (threads suffice),
Tailwind (plain CSS tokens; the design system is in flux and not on main).

## Decision log

| Decision | Chosen | Why |
| --- | --- | --- |
| Sidecar vs embedding the daemon | Sidecar | One protocol implementation; CLI users unaffected; daemon survives a UI crash |
| Where | `apps/provider-app` | Matches `apps/*`; independent package like the others |
| Frontend | React + Vite + TS, plain CSS | Small surface; no dependency on the unfinished design system |
| Installer | NSIS, per-user | No admin prompt, consistent with the no-admin autostart |
| Webview privileges | Typed commands only | A compromised webview must not get a shell |
| Branching | Stack on #65 + #66 | The app needs both; PR opens after they merge |
| Secrets | Stay in `provider.toml` for v1 | See "Not yet specified"; same exposure as the CLI today |
| Updates | None in v1 | An unsigned self-updater is a supply-chain risk; needs signing + key custody first |

Confirmed in the planning gate (2026-10-28): the five defaults (location, sidecar, React + Vite,
Windows first, no auto-update) and, by question: Quit stops sharing; the draft consent text is
used, with legal review before any public release; secrets stay in `provider.toml` for v1; the app
PR is opened only after #65 and #66 merge.

Assumptions carried into the build (low-stakes, reversible; each is in the tables above): NSIS
per-user installer, product name "ProxyHubb Provider" with identifier `com.proxyhubb.provider`,
no earnings view in v1, E2E by driving the real window over WebView2 remote debugging.

## Not yet specified

- **Credential store.** `provider.toml` holds `api_key`, `jwt_token`, `provider_signing_key` in plain
  text under the user profile. Moving them to DPAPI/Keychain needs provider-node to read secrets from
  somewhere other than the file. Precise question for its own plan: does the daemon get them via
  stdin/env at launch, or read the OS store itself?
- **Auto-update.** Needs the Azure/Apple signing from #65 working, an update-signing key and where it
  lives, and a release channel. Fog until then.
- **Spike fallback.** If NSIS cannot be built here (it downloads tooling at build time and GitHub has
  been flaky), ship the `--no-bundle` exe layout locally and build the installer in CI; the plan's
  verification for Phase 0 then moves to the CI job.
- macOS and Linux builds; wiring the installer into `cli-dist-release.yml` and signing it.
- Earnings/payout view (needs control-API calls with the node's key), bandwidth caps and schedule
  UI (the config fields exist; the product call does not), tray icon state variants, server-side
  record of consent.

## Always / Never

- Always: the app drives only fixed `provider-node` subcommands; consent is recorded before the first
  pairing and re-asked when its version changes; copy is plain language; app and CLI share one config.
- Always: tests never touch the real HKCU Run key or a real profile's config (isolated HOME, as before).
- Never: start sharing without recorded consent; give the webview shell/fs/exec access; add telemetry;
  self-update; change what traffic the daemon allows; display or rely on client IP addresses
  (see memory `cloudflare-client-ip-behind-caddy`).
- Never (this plan): merge or push anything without your go; install the installer on this machine.

## Progress

| Phase | Status |
| --- | --- |
| 0 Spike | not started |
| 1 provider-node interface | not started |
| 2 App core | not started |
| 3 UI | not started |
| 4 Tray and lifecycle | not started |
| 5 End to end | not started |
| 6 Packaging, CI, docs | not started |
