# Plain-language provider rules (blocked sites)

**Date:** 2026-11-03 · **Branch:** `feat/provider-rules` · **Status:** built and tested locally;
the web route is not deployed yet, and no new node or app build has been published.

A provider says, in their own words, which sites their node must refuse: "no gambling or adult
sites, never Facebook, stop blocking old.example". A Meta model drafts the change, deterministic
code checks it and merges it with the node's current list, and the provider approves the result
in the Provider app. Nothing is written until the provider presses **Save and apply**.

The list is enforced **on the provider's own node**, not at the gateway. The node's traffic
handler refuses the listed sites (and their subdomains) before connecting anywhere. That layer
was chosen because it is the one that works today: the gateway's copy of a provider's rules is
cached with a 1-hour TTL, fails open when the cache is empty, and the API cannot set domain or
port rules at all.

## 1. How it works

```
provider's words ──► Provider app ──► provider-node "rules draft --json"
                                          │  POST /api/provider-rules/draft (the node's own provider token,
                                          │  20 drafts/user/hour, 300/hour overall)
                                          │  1. model drafts strict JSON: sites the provider named + category ids
                                          │     (muse-spark-1.3, standard mode)
                                          │  2. checker: lib/provider-rules.ts expands categories from a
                                          │     curated list and merges with the node's current list
                                          ▼
                                     plan (added / removed, each with its source) ──► app shows it,
                                          with the assistant's guesses and what it can't do
provider approves ──► "Use this list" ──► Save and apply
                                          ──► provider-node "config set-blocked-sites --json"
                                              (writes only blocked_hosts in provider.toml)
                                          ──► the app restarts the node only if the app started it
                                              and it is running; otherwise the panel says whether the
                                              list needs a restart or applies when sharing starts
```

The app never sees a credential: the node sends the draft request with its own token. The node
derives the web address from its configured control/API host (`--web-url` overrides it).

The model only proposes. The checker (`apps/web/src/lib/provider-rules.ts`) decides:

| Rule | Why |
| --- | --- |
| Only sites the provider named, plus categories from the fixed list (`gambling`, `adult`, `social_media`, `video_streaming`, `dating`) | The model cannot invent a blocklist |
| Categories expand from a short, curated list of major sites, and the plan says so | Best effort, stated plainly: other sites in a category are not blocked |
| A site name blocks that site and its subdomains (`facebook.com` also blocks `m.facebook.com`) | The node's own matching rule, shared by the checker |
| Rules with no dot (written by hand before this feature) keep the old substring match | Existing provider configs keep behaving as written |
| Invalid names are rejected and reported, never silently written | The saved list is always one the node accepts; the node enforces the same rules (`MAX_BLOCKED_SITES` = 1000) |
| The plan is merged with the node's current list and shown as added/removed with sources (`named`, `category:<id>`) | The provider sees exactly what changes before approving |

The provider's text is not logged. A failed draft (model down, rate limited, refused) changes
nothing: the panel says so and the list stays editable by hand.

## 2. Editing by hand and from the CLI

The **Blocked sites** panel (below Node settings in the Provider app) also edits the list
directly: remove a site, add one, then Save and apply. The same operations exist on the node:

```
provider-node rules draft --text="no gambling, never facebook" --json [--web-url URL]
provider-node config set-blocked-sites [sites... | --stdin | --from-file FILE] --json
```

`config set-blocked-sites` changes only `blocked_hosts` in `provider.toml`; every other key is
kept untouched. The node reads the list at start, so a running node applies a new list after it
restarts — the app does that restart itself for a node it started.

## 3. Files

| File | What |
| --- | --- |
| `apps/web/src/lib/provider-rules.ts` | The checker: categories, site validation, plan building (pure, no imports) |
| `apps/web/src/lib/server/provider-rules-draft.ts` | Prompt, strict output format, drafting steps |
| `apps/web/src/app/api/provider-rules/draft/route.ts` | `POST /api/provider-rules/draft` (reuses the session assistant's audit wrapper, Meta client and rate limiter) |
| `apps/web/scripts/provider-rules.test.mjs`, `provider-rules-draft.test.mjs` | Unit tests (19): `npm run test:provider-rules`, `npm run test:provider-rules-draft` |
| `services/provider-node/src/blocked_sites.rs` | Site matching (exact + subdomains; legacy dot-less substring) and saving `blocked_hosts` only |
| `services/provider-node/src/rules_draft.rs`, `src/main.rs` | `rules draft` and `config set-blocked-sites` CLIs (JSON in, JSON errors out) |
| `services/provider-node/src/proxy/handler.rs` | The traffic handler uses the new matching |
| `apps/provider-app/src-tauri/src/rules.rs` | Parsing the node's JSON for the window (camelCase) |
| `apps/provider-app/src-tauri/src/node.rs`, `engine.rs`, `commands.rs` | Sidecar calls (the list passes through a temp file), engine `draft_rules` / `save_blocked_sites`, Tauri commands |
| `apps/provider-app/src/screens/BlockedSites.tsx` | The panel: current list, hand edits, own-words draft, Save and apply |
| `apps/provider-app/src/ipc.ts`, `mock.ts`, `types.ts` | The two new commands on the window↔Rust surface (21 commands now), browser mock, shared types |

## 4. Running it

Local end-to-end (node → web route → real model), as verified on 2026-11-03:

```
# apps/web: needs MODEL_API_KEY (already in the VM's .env for the session assistant)
next dev -H 127.0.0.1 -p 4027

# always pin a scratch config on a machine with a real provider node
provider-node --config <scratch>/provider.toml rules draft \
  --text="no gambling or adult sites, never Facebook" --json --web-url http://127.0.0.1:4027
```

Tests: node `cargo test` in `services/provider-node`, app Rust `cargo test --locked` in
`apps/provider-app/src-tauri` (needs the app's `npm ci` + `npm run build` for `dist/` and the
sidecar binary in `src-tauri/binaries/`), app frontend `npm test` + `npm run typecheck`, web
`npm run test:provider-rules` + `npm run test:provider-rules-draft` + typecheck + eslint.

Deploying is web-only (the route); the node and app ship with their next published builds.

## 5. Limits and known gaps (not fixed here)

- Categories are a curated shortlist of major sites, not a category database. Sites outside the
  list are not blocked unless named.
- The gateway layer still cannot enforce provider site/port rules: its `node:config` cache
  expires after 1 hour and fails open, and the API has no domain or port fields. The node-local
  list is the enforcement that exists.
- The price limit is the rate billed: the gateway ignores price when routing, and settlement
  uses the price fixed at session creation.
