# Extension connectivity — implementation plan

**Start here.** Research and architecture:
[`EXTENSION_CONNECTIVITY_LAYER.md`](EXTENSION_CONNECTIVITY_LAYER.md).

This plan is the work queue. One PR per slice. Do not open the Chrome Web
Store until PR-E (verify) is green on unpacked testnet.

**Live constraints (do not violate):** public buyer CONNECT is HMAC
`proxy.proxyhubb.com:8090`. Capability soak is Host-A `:18091`. Slash dual-gates
stay unset. `programs/session` stays undeployed. Usage SoT is the edge.

---

## How to work

| Rule | Why |
|------|-----|
| Ship **PR-A before any `chrome.proxy` code** | Shop and extension would both 407 on `:8090` if `password` is `phubb1.` |
| Default Connect target is **HMAC `:8090`** | Matches the URL we already print |
| Capability (`phubb1.`) is **advanced / soak** | Not the store-extension password |
| No new session database | Orders + existing sessions |
| No desktop agent until Phase 7 | Chrome CONNECT is the MVP |
| Unpacked extension for testnet | CWS after PR-E |

Suggested branches: `feat/credentials-hmac-default`, then `feat/extension-mvp`.

---

## PR-A — Credentials contract (Week 1)

**Status (2026-08-19):** Implemented in working tree. Not rolled to Host-A `control-api` yet.

**Goal:** `GET /v1/orders/:id/credentials` is safe for public `:8090`.

**Was:** under `PROXYHUB_SESSION_CAPABILITY=enforce`,
`proxy_credentials.password` was overwritten with the `phubb1.` token.
HMAC lived only in `legacy_password`. Shop copied `password`.

**Now:** `password` and `legacy_password` are HMAC; `session_capability` holds
`phubb1.`; `auth_for_endpoint` is `"hmac"` for the published buyer endpoint.

**Change**

1. Keep `password` = `session.CredentialsPass` (HMAC) whenever the published
   buyer endpoint is the HMAC control group (`BuyerProxyConnectInfo()`, today
   `:8090`).
2. Always emit `session_capability` when capability mint succeeds (observe or
   enforce).
3. Keep `legacy_password` as an alias of HMAC for one release (same value as
   `password` after the fix) so nothing that already read it breaks.
4. Add `auth_for_endpoint`: `"hmac"` | `"capability"` so the extension does
   not guess.

**Files**

- `services/control-api/internal/api/orders.go` (`getOrderCredentials`)
- New test in `services/control-api/internal/api/` (enforce mode must not put
  `phubb1.` in `password`)
- Check other credential builders in `session.go` / sandbox activate — same
  contract if they overwrite password

**Done when**

```
go test ./internal/api/ -count=1 -run Credentials
```

Manual on Host-A (HMAC `:8090`):

```
curl -x "http://USER:PASSWORD@proxy.proxyhubb.com:8090" https://httpbin.org/ip
```

`PASSWORD` from `proxy_credentials.password` returns 200. `session_capability`
still starts with `phubb1.` when enforce is on.

**Do not** recreate `edge-a` or flip listing/slash.

---

## PR-B — Shop copy (Week 1, same week as A)

**Status (2026-08-19):** Implemented in working tree (types, order credentials UI, e2e, buyer docs).

**Goal:** Non-technical users see Connect-ready HMAC. Technical users can
still copy the capability token.

**Files**

- `apps/web/src/lib/api/marketplace.ts` — type
  `legacy_password?`, `session_capability?`, `auth_for_endpoint?`
- `apps/web/src/components/marketplace/MarketplaceOrderCredentials.tsx` —
  default curl uses `username` + `password` + `endpoint`; Advanced: capability
- `apps/web/src/components/BuyListingModal.tsx` — same if it prints curl
- `apps/web/e2e/marketplace-order-credentials.spec.ts` + fixture
- `apps/docs/content/buyer/connect.mdx` — one paragraph: Chrome / HTTP CONNECT
  / HMAC password; capability is soak

**Done when** Playwright `test:e2e:order-credentials` passes and the curl
snippet on an order page does not contain `phubb1.`.

---

## PR-C — Extension scaffold (Week 2)

**Status (2026-08-19):** Implemented in working tree. Pair API + unpacked MV3 shell. No `chrome.proxy.set`. Host-A not required for pairing against public API after control-api is deployed with migration `000152`.

**Goal:** Loadable MV3 unpacked extension. Sign-in pairing only. **No**
`chrome.proxy.set` yet.

```
apps/extension/
  package.json          # pnpm/npm workspace sibling of apps/web
  manifest.json         # MV3; permissions as in the research doc
  src/sw.ts
  src/popup/
  src/lib/api.ts
  src/lib/auth.ts
  README.md             # load unpacked; testnet API URL
```

**Backend (same PR or PR-C2 if large)**

- `POST /v1/extension/pair/start` — authenticated web JWT, returns 60s code
- `POST /v1/extension/pair/finish` — code + extension id → **device** JWT
  (scope: orders, credentials, usage)
- `GET /v1/extension/bootstrap` — user label + active orders summary
- Store device rows in Postgres (small table). Reuse `auth_refresh` patterns;
  do not reuse the full web refresh cookie.

**Web**

- `externally_connectable` ping from success/order page: “Extension installed”
- Pair button: `chrome.runtime.sendMessage(EXTENSION_ID, { type: "pair", code })`

**Done when** unpacked extension popup shows the signed-in email after pairing
on localhost or testnet. No proxy settings changed (`chrome.proxy.settings.get`
still not `controlled_by_this_extension`).

---

## PR-D — Connect / disconnect (Week 2–3)

**Status (2026-08-19):** Implemented in working tree (unpacked 0.2.0). Host-A `control-api` still needs a recreate with existing overlays before live shop HMAC matches this build. Do not ship soak `:18091` in the popup.

**Goal:** Turn on / turn off Chrome HTTP CONNECT to `proxy.proxyhubb.com:8090`
with HMAC from PR-A.

**Files:** `apps/extension/src/lib/proxy.ts`, `hmac.ts`, `connect.ts`, `sw.ts`

- `fixed_servers` + `singleProxy` scheme `http`
- `bypassList`: localhost, `<local>`, `proxyhubb.com`, `*.proxyhubb.com`,
  `api.proxyhubb.com`
- `onAuthRequired` at **service worker top level**, `details.isProxy` only,
  HMAC password from `chrome.storage.session`
- After `set`, `get` and require `levelOfControl === "controlled_by_this_extension"`
- Disconnect: `mode: "direct"`, wipe **proxy secrets only** (keep device JWT), badge off. Must not call the API.
- `chrome.proxy.onProxyError`: if we still show Connected, flip to lost; fatal → `direct`
- HMAC picker: if `password` looks like `phubb1.`, use `legacy_password`. Reject port `18091`.

**Done when** (unpacked, testnet order):

1. Turn on.
2. New tab `https://httpbin.org/ip` (or ipify) is not the home IP.
3. Turn off.
4. Same tab (reload) is home IP.
5. Disconnect works **even if api.proxyhubb.com is unreachable** (bypass list).

Lab-only: a hidden setting for `:18091` + `session_capability` must not ship
in the store build (`OFFICIAL_BUILD` / missing from popup).

---

## PR-E — Verify (Week 3)

**Status (2026-08-19):** Implemented in working tree (unpacked 0.3.0). Tab probe to `api.ipify.org` / `httpbin.org/ip`. No SW `fetch` for egress. No soak `:18091`. No `GET /v1/extension/egress-check` yet (hardcoded check URLs).

**Goal:** Popup says healthy vs failed without trusting the service worker’s
own `fetch`.

- Short-lived inactive tab (not offscreen: Chrome has no NETWORK reason)
- Show egress IP, RTT, protocol HTTP CONNECT
- On fail: do not leave “Connected” if verify IP equals pre-connect IP (roll back to `direct`)

**Done when** connect → green IP → disconnect → IP matches baseline.

---

## PR-F — Marketplace handoff (Week 3–4)

**Status (2026-08-19):** Implemented in working tree (unpacked 0.4.0). Shop **Connect with ProxyHubb** pairs (if needed) then `chrome.runtime.sendMessage({ type: "connect", orderId })`. CWS URL only if `NEXT_PUBLIC_EXTENSION_CWS_URL` is set; otherwise unpacked instructions. `NEXT_PUBLIC_EXTENSION_ID` required for page→extension messaging.

**Goal:** After purchase, **Connect with ProxyHubb** / **Install extension**.

- `BuyListingModal` success and order detail
- Detect extension via `externally_connectable`
- Deep link: pair + select the order that was just paid, then Turn on
- Chrome Web Store URL behind a flag until listing exists (testnet: “load
  unpacked” instructions)

**Done when** buy-on-web → one click → popup Turn on for that order (unpacked).

---

## PR-G — Reliability (Week 4+)

**Status (2026-08-19):** Implemented in working tree (unpacked 0.5.0). Alarm 5 minutes before marketplace `expires_at` (popup prompt); at expiry clear proxy + wipe HMAC + badge `!`. Popup **Switch** among purchased orders (one Chrome profile = one proxy; reload tabs). 1-minute `chrome.alarms` keep-alive while connected so `onAuthRequired` still has HMAC after SW idle; device JWT refresh is best-effort and must not drop the proxy. Incognito note + “Allow in incognito”. Turn on/Switch disabled when `controlled_by_other_extensions`. No auto-buy failover. No soak `:18091`. No `notifications` permission.

**Goal:** Stay usable after idle, expiry, and switching purchases.

- Alarm before credential/session expiry → prompt reconnect
- Switch among purchased orders (one Chrome profile = one proxy)
- SW keep-alive so 407 still gets HMAC after idle
- Incognito: document “Allow in incognito”; spanning already in manifest
- Detect `controlled_by_other_extensions`

---

## Later (not the start)

| When | What |
|------|------|
| After PR-E | CWS listing, privacy policy, permission justifications |
| Phase 6 | PAC allowlists, WebRTC policy (`privacy` optional permission) |
| Phase 7 | Desktop agent (SOCKS5 auth, OS proxy) |
| Never in this track | `programs/session`, client-side billing, auto-buy failover |

---

## Week 1 calendar

| Day | Work |
|-----|------|
| 1 | PR-A tests + `orders.go` password fix |
| 2 | Host-A HMAC CONNECT check with new credentials JSON |
| 3 | PR-B shop UI + e2e |
| 4–5 | PR-C scaffold + pair API design (can overlap 3 if A is merged) |

---

## Commands

```bash
# PR-A
cd services/control-api && go test ./internal/api/ -count=1 -run 'Credential|Order'

# PR-B
cd apps/web && npm run test:e2e:order-credentials

# PR-C+ (after scaffold)
cd apps/extension && npm test && npm run build   # then chrome://extensions → Load unpacked
```

Host-A HMAC check stays on `:8090`. Do not point the store extension at
`:18091` by default.
