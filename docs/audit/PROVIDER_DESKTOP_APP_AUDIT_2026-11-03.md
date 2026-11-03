# ProxyHubb Provider desktop app: audit, inventory and improvement plan

Date: 2026-11-03. Status: **the work in this report is on `main`** (see the status section below). The report itself was written before any change was made; the decisions in section 8 were approved as recommended.

## Status (updated 2026-11-03, later the same day)

**On `main`:**
- Reconnect-loop fix: a server error (for example HTTP 502) no longer stops the node; only the control API's own key refusal does (#152).
- Phase A: Pause survives a restart; "Stop this node…" asks before stopping a node the app did not start; the tray menu follows the state; one status read per tick; a `settings.json` saved with a byte-order mark still loads (#153).
- Phase B: "On ProxyHubb" status, earnings, live numbers, "Check my connection", "Save support details", and `provider-node account --json` (#157).
- Phase C: Restart node, Disconnect this computer (the key is not revoked by the app), read-only node settings, a newer-version notice, and `provider-node unpair`, `config show` and `latest-release` (#157).
- Phase D: 52 screen tests (Vitest) with three pinned dev dependencies, and a note on the web "Set up a node" page pointing to the app (#156).
- Hygiene (#159): `key_was_refused` in the app's diagnosis and `provider-node account` now use the shared `ip::is_key_refusal`, and the clippy finding at `services/provider-node/src/tui/dashboard.rs` is fixed.
- Version 0.1.3 for the app (#160).

**Checked since then, without Docker:** the real debug app (0.1.3) with the bundled `provider-node` 1.0.11, in an isolated scratch folder with no real node or app running. Resume then pause: 7 of 7 checks passed. Hidden start and single instance: 5 of 5 checks passed. (Running the second one on its own, `E2E_ONLY=hidden`, is added in #161.)

**Left to do:**
1. **Pairing end-to-end scenarios** (happy path, denied, cancelled; `apps/provider-app/e2e/run.mjs` with no `E2E_ONLY`). Not run against the current code. They need a Postgres database and the control-api pairing handlers (two containers, not the whole system) and the user's installed node stopped; the script refuses to run otherwise. Held back because the build machine has little disk space and Docker freezes it.
2. **Clicked tray pass** (`apps/provider-app/e2e/tray-pass.ps1`, without `-Auto`). Needs a person at the keyboard.
3. **Publish the installer.** `ProxyHubb Provider_0.1.3_x64-setup.exe` (4,780,940 bytes, sha256 `e6f90276f002c1139fad35c5c21776545ac783e0885b96d43e09e2bd9477b958`) was built from `main` with the new bundled node. It is unsigned and not published anywhere. Publishing means signing it (item 5) and uploading it by hand as the `desktop` package at 0.1.3. The app's update notice compares against the published version, so users on 0.1.2 will not see a notice until that is done.
4. **Logo** for the tray and window (decision D7). Needs the logo file.
5. **Code signing** for the installer and the node (Azure Artifact Signing and Apple). Needs the accounts (decision D6).
6. **Legal review** of the draft consent text (`apps/provider-app/src/consent.ts`).
7. **CI.** GitHub Actions is off, so none of the PRs above had an automated run; every check was run by hand.
8. **Cleanup.** The remote branches `fix/provider-app-phase-a`, `feat/provider-app-phase-b`, `-c`, `-d`, `fix/provider-fatal-auth`, `docs/provider-desktop-app-audit`, `fix/provider-node-hygiene` and `chore/provider-app-0.1.3` are merged and can be deleted.

Scope: `apps/provider-app`, plus the parts of `services/provider-node`, `services/control-api` and `apps/web` the app depends on. Code baseline: `origin/main` (db47f32b) when the audit was written; the status above is as of `origin/main` 2c2a6a94.

---

## 1. Short version

- The desktop app is a Windows tray app. It does not share bandwidth itself. It wraps the same `provider-node` binary the CLI uses and runs four fixed commands on it.
- What works: the happy path is short (agree, approve one code, sharing). Consent gates everything. The webview cannot run a command or open a link outside its allowlist.
- What a provider needs but the app lacks: earnings, server-side status, logs and diagnostics, updates, any setting, and a way to disconnect or switch account. Today the window shows three numbers.
- Two problems are in the code now, separate from missing features:
  1. **Pause does nothing for a node started by the CLI or the website's setup script**, and the docs say it stops it. The current behaviour was chosen on purpose in #112 ("never stop foreign nodes"), but the screen and the docs disagree with it.
  2. **A Pause on such a node is undone at the next app start.** Nothing in the code or the tests asks for this, so it looks like a real bug.
- Recommended order: fix the two problems and the tray menu first (Phase A, small). Then read-only monitoring (Phase B). Then control (Phase C), which needs the product decisions in section 8.

---

## 2. What the desktop provider app is made of

### 2.1 Parts

| Part | Where | What it does |
|---|---|---|
| Installer | `apps/provider-app/scripts/build-app.mjs`, NSIS per-user | Builds the app and the sidecar into one `ProxyHubb Provider_0.1.2_x64-setup.exe`. Unsigned. Creates Start menu and desktop shortcuts. |
| Tray shell | `src-tauri/src/lib.rs` | Tray icon and menu (Open, Pause, Resume, Quit). Single instance. Closing the window hides it. `--hidden` start. Autostart plugin (HKCU Run key). |
| Commands and supervisor | `src-tauri/src/commands.rs` | Nine typed commands, two events, and a background loop every 5 s that keeps the node running and refreshes the window. |
| Engine | `src-tauri/src/engine.rs` | `AppCore`: consent, the sharing wish, pairing, start/stop, "adopt" a node started outside the app, shutdown. |
| State | `src-tauri/src/state.rs` | Derives the screen from facts each time (never stored). |
| Node driver | `src-tauri/src/node.rs` | Runs `provider-node status --json --local`, `start --background`, `stop`, `pair --json`. Parses output. Link allowlist (`https://proxyhubb.com/` only). |
| Settings | `src-tauri/src/settings.rs` | `settings.json`: consent (version and time) and the sharing wish. |
| Webview | `src/` | `App.tsx`, screens in `src/screens/` (Consent, Pair, Home with Connecting, Sharing, Paused, Problem), `useApp.ts`, `ipc.ts`, `format.ts`, `consent.ts`, `styles.css`. |
| Dev mock | `src/mock.ts` | Scripted stand-in for the Rust side in `npm run dev`. Excluded from production builds. |
| Sidecar | `provider-node.exe` (repo: `services/provider-node`, version 1.0.11) | The node itself. The app is the same binary the CLI ships. |

### 2.2 Files on the PC

| File | Owner | Holds |
|---|---|---|
| `%APPDATA%\proxyhubb\provider.toml` | provider-node | Account API key or JWT, signing key, gateway, node id. Plain text. |
| `%USERPROFILE%\.proxyhubb\` | provider-node | PID file, logs, `runtime.json`, `stats.json` (lifetime totals). |
| `%APPDATA%\com.proxyhubb.provider\settings.json` | app | Consent and the sharing wish. Nothing else. |

### 2.3 Web and server pieces it depends on

| Piece | Where | Used for |
|---|---|---|
| Pairing API | `control-api/internal/api/provider_pairing.go` (`/v1/provider/pair/start`, `poll`, `lookup`, `decision`) | Connect and approve. |
| Approval page | `apps/web/src/app/dashboard/provider/pair/page.tsx` | The owner approves the code. |
| Token list | `apps/web/src/app/dashboard/provider/tokens/page.tsx` | Revoking `Paired: <computer>` (the docs ask people to do this by hand). |
| Desktop download | `apps/web/src/app/dashboard/provider/cli/page.tsx` (`#desktop-app`) | The installer link. |
| Node list | `GET /v1/provider/nodes` | Used by the CLI's `status`, not by the app. |
| Earnings summary | `GET /v1/provider/earnings/summary` | Allowed for node tokens (`middleware/provider_token_scope.go:60`). Not used by the app. |
| Docs | `apps/docs/content/provider/app.mdx` (preview), `docs/plans/provider-tray-app.md` | User docs and the plan. |

### 2.4 Tests and checks

| Check | State |
|---|---|
| Rust unit tests in the app | 70 `#[test]` functions by count. **Not re-run in this audit.** |
| Vitest | 13 cases by count, in `src/format.test.ts` only. No screen tests. **Not re-run:** `node_modules` is not installed in this checkout. |
| `e2e/run.mjs` | 37 checks, 4 scenarios, drives the real window over WebView2. Windows only, needs Docker for the pairing handlers. Last recorded as passing on the release build. |
| `e2e/tray-pass.ps1` | Automatic mode passes 8/8. **The clicked pass (tray menu, Quit, resume after Quit) has never been done by a person.** |
| CI jobs | `provider-app-check` and `provider-app-installer` in `proxyhubb-ci.yml`. GitHub Actions is off by your decision of 2026-11-02, so nothing runs automatically. |

---

## 3. The flow a provider goes through today

1. **Install.** Unsigned installer, so Windows shows a SmartScreen warning.
2. **Consent.** Four points and a checkbox. Nothing runs until it is ticked and continued. Consent is tied to the wording version (`CONSENT_VERSION`, pinned in a test).
3. **Connect.** The app runs `provider-node pair --json` and shows a code.
4. **Approve.** The person opens the dashboard page, checks the device name and code, and approves.
5. **Sharing.** The app starts the node in the background and shows *Sharing is on*. Closing the window keeps sharing. Quit stops the node the app started.

Screens: `NeedsConsent`, `NeedsPairing`, `Pairing`, `Connecting`, `Sharing`, `Paused`, `Problem`.

---

## 4. What the app does, against what a provider needs

| Need | Desktop app now | Where it is today | Gap |
|---|---|---|---|
| Is my node sharing now? | Yes: Sharing, Connecting, Paused | CLI dashboard | None |
| Connected for, shared so far, connections now | Yes (local counters) | CLI dashboard | No rate, failed connections or latency |
| Does the server see my node online? | **No** | `provider-node status` (full), `doctor`, web `/provider/nodes` | Missing. This is what caused the "dashboard says offline, app says sharing" confusion. |
| Earnings, payable, paid | **No** | CLI dashboard (`fetch_earnings_summary`), web `/provider/earnings` | Missing. The node token may already read the summary. |
| Why is it not connecting? | Retry line and last error | `doctor`, CLI dashboard | No plain-language diagnosis in the app |
| Logs, support bundle | **No** | `provider-node support bundle` | Missing |
| Max connections, bandwidth cap | **No** | Edit `provider.toml` by hand | Missing. Product call not made (see the plan doc). |
| Allowed ports, blocked hosts | **No** | Edit `provider.toml` by hand | Keep read-only. The consent text promises ports 80, 443, 8080 and 8443, and the plan says the app never changes what traffic the daemon allows. |
| Pause and resume | Yes, but only for a node the app started | CLI `stop` and `start` | See F1 and F2 |
| Start at sign-in | Yes (HKCU Run, `--hidden`) | `service install` | None |
| Update the node | **No** (plan: none until signing exists) | `provider-node update` | Missing. The app's bundled node never updates from the CLI. |
| Disconnect or switch account | **No** | None. Docs: revoke the token in the dashboard, then delete `provider.toml`. | Missing. See F3. |
| Notice when sharing stops or needs attention | **No** | None | Missing |
| Tray menu shows the state | Static: Pause and Resume are always both enabled, no status line | None | See F4 |

---

## 5. Findings

Severity: High means it breaks what the person expects or hides a choice they made. Medium means it costs a lot of trust, support time or safety later. Low means polish.

| ID | Sev. | Finding | Evidence | Confidence |
|---|---|---|---|---|
| F1 | High | **Pause does not stop a node started outside the app, and the UI and docs say otherwise.** | `set_sharing(false)` saves the wish and stops only nodes the app started (`engine.rs:244-266`). The Sharing screen keeps showing "Sharing is on" with the note "Pause here will not stop it" (`screens/Home.tsx`). The tray Pause does the same. `app.mdx` says "Stop it with **Pause sharing** in the app" and its table says Quit makes "the node stop". Both are wrong for these nodes. The behaviour is deliberate since #112 (commit b813f9b7, "never stop foreign nodes"). The website's setup script creates this kind of node, so existing providers hit it. | Verified in code, and pinned by the test `pausing_an_adopted_node_leaves_it_running_and_says_so`. |
| F2 | High | **A Pause on a node started outside the app is undone at the next app start.** | `pause_requested` is memory only (`engine.rs:71`). The node is never stopped, so after a relaunch `pause_requested` is false, `sharing_wanted` is false on disk, the node is running and has a config. `remember_running_node` (`engine.rs:315-337`) then saves `sharing_wanted = true`. The person paused, and the window says "Sharing is on" again. The tests cover pause and relaunch separately, never together. | From code reading. Needs a failing test first. Not deliberate: the adoption test only expects a reboot to resume a node the person never paused. |
| F3 | High (gap) | **No way to disconnect the computer or switch account from the app.** | No command does it. `provider-node pair` refuses when `provider.toml` exists unless `--force` is given (`main.rs:1300`), and the app never passes `--force`. `derive_state` shows the Connect screen only when there is no config (`state.rs`). So a PC paired to account A cannot be paired to account B from the app. This has happened on the author's PC (the config belonged to another account). | Verified in code. |
| F4 | Medium | **The tray menu is static.** | `lib.rs:59-62`: four items, all always enabled. No status line. Quit says "stops sharing" even in the F1 case. | Verified in code. |
| F5 | Medium | **Status is polled by starting a process every 5 seconds, all the time, even with the window hidden.** | The supervisor (`commands.rs:76-82`) calls `supervise_once` and then `emit_state`. Each calls `node.status()`, which runs `provider-node status --json --local`. That is about two process starts per tick. | From code reading. Not measured. |
| F6 | Medium | **No update path and no version shown.** | The app ships its own node copy. A CLI update does not reach it. The plan says no self-update until signing exists. The window does not show the version. | Verified in code. |
| F7 | Medium | **No diagnostics a person can send support.** | The Problem screen shows only the reason. The raw node error goes to the log, and the app does not say where the log is or offer a bundle. | Verified in code. |
| F8 | Medium | **Test gaps for the planned work.** | No screen tests (Vitest covers `format.ts` only). The tray clicks, Quit stopping the node and resume-after-Quit were never checked by a person (plan Phase 4). E2E needs Windows and Docker. With Actions off, nothing runs automatically. | Verified in plan doc and tree. |
| F9 | Medium | **Preview polish.** | The logo is a hard-coded "R" (`App.tsx`). The consent text is marked DRAFT v1 and needs legal review before public release (`consent.ts`). The installer is unsigned, so SmartScreen warns. | Verified in code. |
| F10 | Medium (funnel) | **The new "Set up a node" page does not mention the desktop app.** | A search of `apps/web/src/app/provider` and `apps/web/src/components/provider` finds no reference. The download is only on `/dashboard/provider/cli`. | Verified by search. |
| F11 | Low | **A settings file saved with a byte-order mark is read as "no consent".** | `serde_json` rejects the BOM, so the person is asked again. Safe direction. Seen on 2026-10-29 after a Notepad-style edit. | From the incident notes. |

### 5.1 What is good and should stay

- Strict CSP (`default-src 'self'`, no `unsafe-eval`), and the capability file grants `core:default` only. A test pins both.
- The webview cannot pass arguments to a process. The sidecar runs only fixed subcommands. Links must start with `https://proxyhubb.com/`.
- Consent is required before anything runs, and it is tied to the wording version.
- Settings are minimal and separate from `provider.toml`, so the app and the CLI cannot disagree about the node.

### 5.2 Security notes for the planned work

- `provider.toml` holds the account key, JWT and signing key in plain text. The plan defers DPAPI. Any new feature that reads it must not copy it anywhere.
- Paired tokens never expire (the docs say so). The device-flow approval has a known phishing risk, recorded in the pairing notes.
- A node token can read earnings and nodes but cannot rename or delete them (`provider_token_scope.go`). Any feature that changes the account (disconnect, rename) must go through the owner's session, which means the dashboard. The app cannot do it alone.
- Showing client IP addresses is not allowed (see the Cloudflare note in memory). The node list has an `ip_address` field, and the app must not show it.

---

## 6. Usability

- The happy path is five steps. That suits a non-technical person.
- The friction is elsewhere: (a) a Pause that does not work for script- or CLI-started nodes (F1); (b) no earnings and no way to see whether the server agrees (section 4); (c) disconnecting means editing files or revoking tokens by hand (F3); (d) the web funnel does not offer the app (F10); (e) the docs ask people to read config paths.
- The copy is plain. The words "adopted" and "managed externally" are internal. The Sharing note already says "started outside the app", which is the right phrasing to keep.

---

## 7. Improvement plan

Phases are ordered so each one ships on its own. Phase A changes no new behaviour except the fixes. Phases B and C add features. Phase D can run alongside.

**How we work:** a new worktree off `origin/main` (not the shared main checkout), one branch per phase, `git commit -s` for DCO, no AI attribution in commits or PR bodies, no push or PR without your go.

**Checks for every phase:** `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` for the app, `npm run typecheck` and `npm test` for the frontend, the provider-node contract test for any new command, a mutation check for each new guard, and `e2e/run.mjs` before merge. Tray changes also need the clicked `tray-pass.ps1`.

### Phase A: make what exists correct (size M)

| Step | What | Files | Done when |
|---|---|---|---|
| A1 | Keep the user's Pause across restarts (fixes F2). Persist the pause (for example a `paused_by_user` field in `settings.json`), clear it when the person resumes, and have `remember_running_node` respect it. | `engine.rs`, `settings.rs` | A test that pauses, relaunches with the node still running, and checks the wish stays off. It fails on main and passes on the branch. A settings test covers an old file without the field. |
| A2 | Make Pause honest for a node started outside the app (F1). Recommended: Pause on such a node shows a **Stop this node** button that asks once ("This node was started outside this app. Stop it?"). A yes runs the sidecar `stop`. Keeps the #112 rule, but gives the person an explicit way to act. | `Home.tsx`, `commands.rs`, `engine.rs`, `ipc.ts`, `mock.ts` | Engine test: stop only after an explicit confirm. UI test: the button and the confirm. |
| A3 | Fix the docs to match A1 and A2: the Pause row, the Quit row (it does not stop an outside node), and "Where things are". | `apps/docs/content/provider/app.mdx` | Docs page reviewed against the behaviour. |
| A4 | Tray: enable only the valid action (Pause while sharing, Resume while paused). Add a disabled status line ("Sharing · 3 connections", "Paused", "Needs attention"). | `lib.rs`, `state.rs` | A pure `tray_menu_for(state)` function, tested in `state.rs`. Clicked tray pass. |
| A5 | Accept a settings file with a byte-order mark (F11). | `settings.rs` | Test with a BOM-prefixed file. |
| A6 | One status read per tick, shared by the supervisor and the window (F5). | `commands.rs`, `engine.rs` | A counting fake shows one status call per tick. Before and after process counts recorded. |

### Phase B: see your node (size M, read-only, no server change)

| Step | What | Files | Done when |
|---|---|---|---|
| B1 | Earnings on the Sharing screen: today, 7 days, 30 days, payable and paid. A new `provider-node earnings --json` reuses `fetch_earnings_summary` (`operator.rs:164`) with the node's token. Read every 60 s while sharing, not every 5 s. | `services/provider-node` (new subcommand, contract test), `apps/provider-app` | Contract test pins the JSON. Screen shows the numbers. |
| B2 | "On ProxyHubb" line: Online, Not seen for N minutes, or Not registered. From `provider-node status --json` (full, with the control API) every 60 s. Explains the difference from "Sharing" in plain words. | same | Test for each of the three states. The line never shows `ip_address`. |
| B3 | Richer numbers: current rate, failed connections, time since the last connection. Already in `status --json --local` metrics. | `state.rs`, `Home.tsx` | Test for the fields. |
| B4 | Problem and Connecting screens show the top finding from `doctor --json` in plain words, and a **Copy support details** button. The button runs `provider-node support bundle` to a file in the app's folder and reveals it. The reveal uses the Rust opener API, so the webview's capability stays `core:default`. | `commands.rs`, `node.rs`, `Problem` screen | Test for the message mapping. The capability test still passes. |
| B5 | (Optional, later) Windows notification when sharing stops unexpectedly or needs attention. Needs a new plugin, so it goes through the dependency checklist in the plan. | `lib.rs`, `Cargo.toml` | Decision needed (see section 8). |

### Phase C: control your node (size L, needs decisions D3 to D6)

| Step | What | Files | Done when |
|---|---|---|---|
| C1 | **Restart node** button (stop, then start). Helps when it is stuck in Connecting. | `commands.rs`, `Connecting`/`Sharing` screens | Test with the fake node. |
| C2 | **Disconnect this computer** (F3). A new `provider-node unpair --json` stops the node and moves `provider.toml` aside (it is kept, not deleted). The app then opens the Tokens page so the person revokes `Paired: <name>` in the dashboard, because the node token cannot revoke itself. Then the Connect screen returns. | `services/provider-node` (`unpair`, contract test), app | Test: the config moves, the node stops, the screen is NeedsPairing. |
| C3 | **Switch account** is C2 followed by Connect. Nothing new to build. | none | Covered by C2's test plus one pairing test. |
| C4 | **Read-only settings screen**: gateways, transport, connections, bandwidth cap, ports, blocked hosts, connection type. Uses a new `provider-node config show --json`. | `services/provider-node`, app | Contract test. |
| C5 | **Editable limits** (max connections and bandwidth cap only), through `provider-node config set --json` with the existing validation in `config_validate.rs`. Ports and blocked hosts are never editable in the app. Needs the product definition of the cap (D5). | `services/provider-node`, app | Validation tests. A restart prompt after a change. |
| C6 | **New version available**: `provider-node update --check` shows a notice with a link to the download page. No self-update until signing exists (D6). | `services/provider-node`, app | Test for the notice. |

### Phase D: ship quality (size S to M, can run alongside A to C)

| Step | What |
|---|---|
| D1 | Screen tests with Vitest and Testing Library for each state. New dev dependencies go through the dependency checklist. |
| D2 | Clicked tray pass (`e2e/tray-pass.ps1` without `-Auto`). Needs you at the keyboard. This closes the open item in plan Phase 4. |
| D3 | Keep `e2e/run.mjs` green for each phase. It needs Docker, so check Docker first; it has been down on this machine before. |
| D4 | Replace the "R" logo with the ProxyHubb mark. Needs the file from you (D7). |
| D5 | Web: add a "Download the desktop app" link on `/provider/nodes/new` (F10). A small `apps/web` change, no server change. |
| D6 | Signing: Azure Artifact Signing and the Apple certificate. External accounts. Needs the secrets from you. |
| D7 | Consent text: legal review before public release. |

---

## 8. Decisions I need from you

Each has a recommendation. Reply with the letters you want changed, or say "approve the recommendations".

- **D1 (F1), Pause on a node started outside the app.** (a) **Recommended:** a Stop-this-node button with one confirmation. (b) Keep the current behaviour and fix only the wording. (c) Stop it without asking, which reverses #112.
- **D2 (F2), should a Pause survive a restart?** **Recommended: yes.** A1 is needed under any option.
- **D3 (F3), disconnect.** Move `provider.toml` aside (**recommended**), or delete it? Either way the person is sent to the Tokens page to revoke the token.
- **D4 (B1), earnings on the Sharing screen.** **Recommended: yes**, read-only.
- **D5 (C5), can the app change the bandwidth cap and max connections?** **Recommended: read-only in v1.** The product has to define what the cap means first. Ports and blocked hosts stay read-only for good.
- **D6 (C6), "new version available" notice that opens the download page.** **Recommended: yes**, no self-update.
- **D7, the ProxyHubb logo file** for the tray and window, to replace the "R".

---

## 9. What this audit did not verify

- The Rust tests (70) and Vitest were not run. `node_modules` is not installed in this checkout, and `cargo` would rebuild Tauri and needs the sidecar built first.
- F2 and F5 come from code reading. F2 needs a failing test to confirm. F5 needs a measurement.
- Nothing was run on a real window, and the tray was not clicked.
- The web app and the control API were not built or run. Phase A and B are local to the app and the node. Phase B needs no server change. Phase C also needs no server change, but the disconnect step depends on the existing Tokens page.
- The consent wording, the signing status and the Docker state are as recorded in the project notes. They were not checked again today.
