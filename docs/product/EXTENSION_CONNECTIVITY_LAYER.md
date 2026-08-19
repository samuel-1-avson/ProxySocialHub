# ProxyHubb connectivity layer — extension research and blueprint

**Date:** 2026-08-19  
**Stance:** This is a **browser connectivity product** on the existing federated
hybrid marketplace. It does not make ProxyHubb a DePIN. Live buyer path is
HTTP CONNECT to `proxy.proxyhubb.com:8090` (HMAC control group) with capability
soak on Host-A `:18091`. Do not deploy `programs/session`.

This file is the implementation blueprint. Pair it with
[`docs/buyer-proxy.md`](../buyer-proxy.md) and live session docs
[`docs/ops/W7_SESSION_CAPABILITY.md`](../ops/W7_SESSION_CAPABILITY.md).

**Work queue (start here):**
[`EXTENSION_IMPLEMENTATION_PLAN.md`](EXTENSION_IMPLEMENTATION_PLAN.md).

---

## Final recommendation

**Ship Architecture B now (Chrome/Edge extension + existing control-api).**  
**Plan Architecture D as the long-term shape (extension for browsers, optional
desktop agent for system-wide / SOCKS5-auth / other apps).**

That is Option **2** of the four product options, with Option **3** as Phase 7
only after the extension is real.

Do **not** ship an extension-only product (Option 1). Credentials, sessions,
revocation, and usage already live in control-api + edge-gateway. An extension
that only writes host/port/user/pass into Chrome still needs that backend, and
today the shop already hands users a password that does not match public
`:8090` under capability enforce.

### Why this fits ProxyHubb

| Fact in this repo | Consequence for the extension |
|-------------------|-------------------------------|
| Buyer edge is **CONNECT-only HTTP** (501 on absolute-URI GET) | Chrome `scheme: "http"` + CONNECT is the supported path |
| Auth is **username + password** (HMAC, `phubb1.` token, or `session-intent`) | MV3 `onAuthRequired` + `webRequestAuthProvider` |
| SOCKS5 exists on the same listener | Chrome **cannot** SOCKS5-authenticate ([crbug 1309413](https://crbug.com/1309413)) |
| Public endpoint is `:8090` HMAC; soak `:18091` is capability | Store build uses `password` (HMAC) + `auth_for_endpoint: hmac` |
| Usage SoT is the **edge**, not the client | Extension displays usage; never bills from the popup |
| Shop UI copies `proxy_credentials.password` | Password is HMAC for `:8090`; capability lives in `session_capability` |

---

## A. Feasibility

**Yes, for “turn on this proxy in Chrome.”** Chrome’s `chrome.proxy` API is
supported in Manifest V3. HTTP/HTTPS proxy authentication is supported via
`chrome.webRequest.onAuthRequired` with the `webRequestAuthProvider`
permission ([official webRequest docs](https://developer.chrome.com/docs/extensions/reference/api/webRequest)).

**No, for “this extension is a VPN / system proxy / authenticated SOCKS5.”**
Those need a desktop agent or a local loopback forwarder.

### Fully supported

- Set/clear Chrome profile proxy (`fixed_servers`, `pac_script`, `direct`, `system`)
- HTTP proxy (`scheme: "http"`) so HTTPS sites use CONNECT (matches our edge)
- HTTPS-to-proxy (`scheme: "https"`) if we later terminate TLS on the buyer port
- PAC scripts, including inline `data`
- `bypassList` for localhost / RFC1918
- `chrome.proxy.onProxyError`
- `onAuthRequired` for **HTTP/HTTPS proxies** with Basic (our HMAC / `phubb1.`)
- Incognito inherit from regular windows; optional separate incognito scope
- Chromium family (Chrome, Edge, Brave, Opera) with the same APIs, test each store

### Supported with limitations

| Capability | Limitation |
|------------|------------|
| Profile-wide routing | Not per-tab. Per-site needs a PAC. `singleProxy` covers http/https/ftp only; other schemes go **direct** ([chrome.proxy](https://developer.chrome.com/docs/extensions/reference/api/proxy)) |
| MV3 service worker | Can sleep; `onAuthRequired` must be registered at SW top level. Keep-alive or `offscreen` document is required for reliability |
| `asyncBlocking` auth | Needs `webRequest` + `webRequestAuthProvider` + host permission, typically `<all_urls>` — CWS will demand a justification |
| PAC `mandatory` | If `false` (default), invalid PAC **falls back to direct** |
| `onProxyError` `fatal: false` | Chrome **uses a direct connection** instead of failing closed |
| Incognito | Needs `spanning` or explicit incognito scope; users must enable “allow in incognito” |
| Enterprise policy | Policy wins over the extension (`levelOfControl` from `settings.get`) |
| Another extension | Last writer / `controlled_by_other_extensions` can silently no-op `set()` |
| QUIC / WebRTC | Can bypass the HTTP proxy (DNS/IP leak). Mitigate with `privacy` APIs in V1 |
| Verification fetch | Service-worker `fetch()` may not use the same proxy as tabs. Verify from a tab or offscreen document |
| Firefox | Different proxy API (`browser.proxy.onRequest`). Share UI, not the Chrome proxy module |

### Not reliably supported (extension alone)

- SOCKS5 **username/password** — Chromium: no SOCKS5 auth, no plans ([net/docs/proxy.md](https://chromium.googlesource.com/chromium/src/+/main/net/docs/proxy.md), [crbug 1309413](https://crbug.com/1309413))
- Embedding `user:pass` in the proxy URL — Chrome ignores it
- OS-wide proxy (WinINET / macOS System Settings / GNOME)
- Other applications (curl, Discord, Electron apps)
- True per-tab proxy (workaround: PAC + tab reload; not isolation)
- Blocking silent DIRECT fallback in all failure modes
- Remote DNS for HTTP CONNECT (browser resolves DNS **locally** unless SOCKS5 or a local agent)
- Trustless metering — client cannot be SoT (ADR 0010)

### Better solved with a desktop agent

- System-wide and per-app proxy
- Authenticated SOCKS5 (local clear SOCKS or HTTP → upstream SOCKS with userpass)
- Remote DNS / leak blocking (TUN or forced SOCKS5 via local helper)
- Secure OS credential storage
- Fail-closed networking when the provider dies
- Future “VPN-like” UX

---

## B. Architecture recommendation

### Option 1 — Extension only

Reject. The marketplace already mints sessions. An extension without the API
cannot revoke, rotate, meter, or know which order is paid.

### Option 2 — Extension + existing backend (MVP)

**Build this.** The extension is a Chrome-settings client of control-api:

```
proxyhubb.com (web)
    │  externally_connectable + pairing
    ▼
apps/extension (MV3)
    │  JWT (short) + chrome.storage.session for proxy password
    ▼
control-api  GET /v1/orders/:id/credentials
    ▼
edge-gateway  HTTP CONNECT + Proxy-Authorization
    ▼
provider tunnel → egress
```

Reuse: JWT + refresh (`auth_refresh.go`), orders FSM, Redis session at the
edge, capability tokens, session intents (`POST /v1/sessions/intent`).

Do **not** add `services/proxy-manager` or a second session store.

### Option 3 — Extension + backend + desktop agent

Correct **later**. Same control-api; agent speaks HTTP CONNECT or SOCKS to the
edge and exposes `127.0.0.1:localport` without auth to Chrome (`scheme: "http"`
to localhost) so Chrome never holds upstream secrets. That is also the SOCKS5
auth workaround.

### Option 4 — Different architecture

Not needed. Do not put a PAC CDN in front and call it a connectivity layer.
Do not ask users to install a “VPN” kernel driver for MVP.

**Chosen long-term shape: D** — extension is the default for browser users;
desktop agent is optional for power users.

---

## C. Chrome APIs (MVP)

| API | Why |
|-----|-----|
| `chrome.proxy.settings.set/get/clear` | Connect / disconnect |
| `chrome.proxy.onProxyError` | Provider down; **treat `fatal: false` as a leak risk** |
| `chrome.webRequest.onAuthRequired` + `webRequestAuthProvider` | Inject HMAC / `phubb1.` without a browser prompt |
| `chrome.storage.session` | Proxy password only while connected (not `storage.sync`) |
| `chrome.runtime.onMessageExternal` | Dashboard → extension “Connect” |
| `chrome.alarms` | Session expiry, credential refresh, SW wake |
| `chrome.action` | Popup + badge (on/off) |

V1 (not MVP): `chrome.privacy.network.webRTCIPHandlingPolicy`, optional
`offscreen` document for verify fetches.

### Manifest sketch (permissions are the CWS fight)

```json
{
  "manifest_version": 3,
  "name": "ProxyHubb",
  "minimum_chrome_version": "116",
  "permissions": [
    "proxy",
    "storage",
    "alarms",
    "webRequest",
    "webRequestAuthProvider"
  ],
  "host_permissions": [
    "https://api.proxyhubb.com/*",
    "https://proxyhubb.com/*",
    "<all_urls>"
  ],
  "optional_permissions": ["privacy"],
  "externally_connectable": {
    "matches": ["https://proxyhubb.com/*", "https://*.proxyhubb.com/*"]
  },
  "incognito": "spanning",
  "background": { "service_worker": "sw.js", "type": "module" }
}
```

`<all_urls>` is required for `onAuthRequired` on arbitrary sites. Justify it as
“supply proxy authentication for the sites you visit while connected.” Do not
request `history`, `tabs` (except optional diagnostics), cookies, or
`<all_urls>` scripting.

Connect config (public HMAC endpoint):

```js
await chrome.proxy.settings.set({
  value: {
    mode: "fixed_servers",
    rules: {
      singleProxy: {
        scheme: "http",
        host: "proxy.proxyhubb.com",
        port: 8090
      },
      bypassList: ["localhost", "127.0.0.1", "<local>", "proxyhubb.com", "*.proxyhubb.com", "api.proxyhubb.com"]
    }
  },
  scope: "regular"
});
```

Bypass ProxyHubb origins so pairing and billing calls do not hairpin through
the residential egress (and so a dead proxy cannot lock the user out of
disconnect).

Always `settings.get` and confirm `levelOfControl === "controlled_by_this_extension"`
after `set`.

---

## D. Security analysis

### Highest risks

1. **Silent DIRECT fallback** — `onProxyError` with `fatal: false`; PAC
   `mandatory: false`; QUIC/WebRTC. Product copy must not say “all traffic is
   proxied.” Detect via verify IP + `onProxyError`. Disconnect to `direct` on
   fatal errors; show “connection lost” rather than failing open quietly.
2. **Wrong password for `:8090`** — capability tokens (`phubb1.`) belong in
   `session_capability`, not `password`. Use HMAC `password` (or `legacy_password`)
   against public `:8090`. `auth_for_endpoint` must be `hmac` for that host.
3. **Credential theft from extension storage** — never `storage.sync`; never
   log the password; hold it in `chrome.storage.session` or SW memory; refresh
   from API. Malware on the device still wins (assume that; don’t pretend otherwise).
4. **`<all_urls>` + webRequest** — high CWS friction; do not use it to read
   bodies or history. Auth listener must ignore non-proxy challenges
   (`details.isProxy`).
5. **XSS on proxyhubb.com → extension** — `onMessageExternal` must check
   `sender.origin` and `sender.id`; pairing codes are one-time, bound to
   `chrome.runtime.id`.
6. **Stolen extension JWT** — short-lived access token, refresh rotation,
   server-side device row, revoke-all-devices. Proxy password is **not** the
   account JWT.
7. **Replay of HMAC/capability** — already bounded by session expiry and Redis
   / token `expires_at`. Extension must drop credentials on disconnect and on
   expiry alarm.
8. **Malicious provider node** — extension does not talk to providers. Egress
   still sees destination hostnames on CONNECT. Same as today; don’t claim
   “encrypted to the website through us” as if we were a VPN.
9. **Extension impersonation** — CWS listing + pinned IDs in `externally_connectable`.
   Unpacked sideload is a power-user path only.
10. **DNS leak** — HTTP CONNECT uses local DNS. Disclose it. Desktop agent is
    the real fix.

### Where secrets live

| Secret | Store |
|--------|--------|
| Account access JWT | `chrome.storage.session` or memory; refresh token in `chrome.storage.local` **encrypted is theater** — treat local as stolen-if-device-is. Prefer refresh in `session` + re-pair |
| Proxy password (HMAC / `phubb1.`) | Memory while connected; wipe on disconnect |
| Pairing code | Backend, TTL 60s, single use |
| Usage, listing title, geo | Backend; extension caches non-secrets |
| Billing | Backend / edge only |

---

## E. Buyer journey

**Non-technical (default)**

1. Buy on proxyhubb.com (existing escrow).
2. Success screen: **Connect with ProxyHubb** / **Install extension**.
3. If missing: Chrome Web Store. After install, dashboard detects via
   `externally_connectable` ping.
4. **Authorize this browser** (site login already done → one-click pair).
5. Popup: one purchased proxy, **Turn on**.
6. Extension sets Chrome proxy, answers 407, runs verify in an offscreen/tab
   fetch to a URL that must change IP.
7. Green: “You’re connected · {country} · {ip}”.
8. **Turn off** → `mode: "direct"` + wipe password.

Do not show host, port, username, password on that path.

**Technical (advanced panel)**

- Copy HMAC password, `phubb1.` token, session-intent, curl `-x`, SOCKS note
  (“Chrome cannot SOCKS5-auth; use the SDK or desktop agent”).
- Endpoint, protocol = HTTP CONNECT.

---

## F. API architecture

Reuse first. Add a thin extension namespace; do not invent a parallel session
service.

| Existing | Extension use |
|----------|----------------|
| `POST /v1/auth/refresh` | Keep the device signed in |
| `GET /v1/orders?mine` (or equivalent list) | Purchased proxies |
| `GET /v1/orders/:id/credentials` | Host/port/user + **correct** password for the endpoint |
| `POST /v1/sessions/intent` | Optional rotating path (`session-intent` / token) |
| Session usage routes already under `/v1` | Display only |

**Add (control-api, same JWT audience or a device token):**

```
POST /v1/extension/pair/start     # logged-in web session → one-time code
POST /v1/extension/pair/finish    # code + extension id → device JWT
GET  /v1/extension/bootstrap      # user, devices, connectable orders
POST /v1/extension/heartbeat      # optional; connected | disconnected (advisory)
GET  /v1/extension/egress-check   # returns expected check URL + signed nonce
```

`credentials` response contract (must land in Phase 0):

```json
{
  "username": "...",
  "password": "<HMAC for :8090>",
  "legacy_password": "<HMAC>",
  "auth_for_endpoint": "hmac",
  "session_capability": "phubb1....",
  "endpoint": "proxy.proxyhubb.com:8090",
  "protocol": "http"
}
```

`password` for the **published** buyer endpoint must remain HMAC while
`:8090` is the HMAC control group. Capability stays in `session_capability`.

Heartbeat is **advisory**. Edge Redis / capability expiry is SoT. A closed
laptop must not keep billing if the edge already idle-expires the session.

Real-time: **REST + 30–60s poll** for usage and expiry. WebSockets are optional
later (`useWalletWS` exists on web); the SW should not depend on a long-lived
socket in MVP.

---

## G. Session architecture

Keep the current model: **order (paid) → marketplace session (Postgres) →
edge Redis/capability (admission) → CONNECT**.

| State | Who sets it | Extension shows |
|-------|-------------|-----------------|
| purchased / active order | control-api + escrow | “Ready” |
| connected (browser) | extension local + advisory heartbeat | “On” |
| disconnected | extension `direct` | “Off” |
| expired | token `expires_at` / Redis TTL | “Expired — reconnect” |
| provider down | `onProxyError` + failed verify | “Provider unavailable” |

Do not add pause as a protocol state in MVP (disconnect is enough).

Concurrent sessions: Chrome has **one** proxy setting per profile. Switching
proxies = set new `singleProxy` + new auth credentials. Existing HTTP/2 and
WebSockets to old egress die; tabs are not magically remapped. Reload is
honest UX.

Failover: **manual Switch** in MVP. Auto-buy another listing is a billing
decision — do not auto-spend SOL.

Cleanup: expiry alarm → clear proxy → wipe secrets → badge off.

---

## H. Authentication (extension ↔ account)

Preferred UX:

1. User is already logged into proxyhubb.com.
2. Extension requests pair.
3. Site calls `pair/start`, `chrome.runtime.sendMessage(EXTENSION_ID, {type:"pair", code})`.
4. Extension calls `pair/finish`.
5. Backend issues a **device** access token (narrow scope: orders, credentials,
   usage, heartbeat) distinct from the full web JWT.

Fallback: `chrome.identity.launchWebAuthFlow` to `/extension/authorize`.

Do not paste API keys in the popup for default users.

---

## I. Extension structure

```
apps/extension/
  manifest.json
  src/sw.ts                 # proxy set/clear, onAuthRequired, alarms
  src/popup/                # React popup (reuse web design tokens if cheap)
  src/offscreen/            # verify fetch (V1)
  src/lib/api.ts            # control-api client
  src/lib/proxy.ts          # chrome.proxy wrapper + levelOfControl
  src/lib/auth.ts           # pair + token
  src/lib/verify.ts         # egress IP check
  README.md
```

Monorepo: next to `apps/web`. Share TypeScript types only; do not bundle the
Next app into the extension (CWS remote-code / size).

Popup sections: Connection, Proxies (purchased), Usage (read-only), Diagnostics
(advanced), Account.

---

## J. Desktop agent decision

**Not for MVP.** Schedule after the extension is in a store and CONNECT works.

Agent job: local listener `127.0.0.1:18080` (HTTP CONNECT, no auth) → upstream
ProxyHubb with HMAC/`phubb1.`/SOCKS5 userpass; optional system proxy via
platform APIs (Windows `WinHTTP`/`netsh winhttp`, macOS `networksetup`,
Linux GNOME/`org.gnome.system.proxy` — all require user permission and are
unreliable on managed devices).

Stack later: small Go or Rust binary (we already ship Go control-api tooling).
Avoid Electron unless the UI must match the web app.

---

## K. Testing strategy

### Phase 0 (before extension UI)

- Credentials: `password` for `:8090` is HMAC; shop curl example uses it.
- Manual: `curl -x http://USER:HMAC@proxy.proxyhubb.com:8090 https://httpbin.org/ip`

### Extension unit

- `set` then `get` `levelOfControl`
- Auth listener only when `details.isProxy`
- Disconnect always reaches `direct` even if API is down (bypass list includes api.proxyhubb.com)

### Integration (Host-A lab)

- HMAC CONNECT `:8090` via unpacked extension
- Capability CONNECT `:18091` only if we expose a lab profile (not default store build)

### Adversarial

- Stolen device JWT → revoke
- Expired `phubb1.` → 407, UI “reconnect”
- Kill edge → `onProxyError`; confirm we do **not** leave Chrome on DIRECT while
  still showing “Connected”
- Second proxy extension installed → detect `controlled_by_other_extensions`
- QUIC/WebRTC IP leak check (browserleaks) — document residual leak for MVP

### E2E (the 14-step user test)

Provider already tunneled → listing active → buyer escrow → credentials →
extension pair → set proxy → tab load `https://api.ipify.org` → IP ≠ home IP →
usage bytes increase on `GET` session usage → disconnect → IP back → session
not billed from the popup.

Do not require GitHub Actions (billing-blocked). Run on a packed unpacked
extension against testnet.

---

## L. Chrome Web Store

- Manifest V3 only
- **Single purpose:** “Connect your ProxyHubb purchases in Chrome.” No social
  feed, wallet inject, or new-tab hijack in this ID
- Justify `proxy`, `webRequestAuthProvider`, `<all_urls>`
- Privacy policy: we collect account id, session ids, egress check results;
  **not** page content or history
- No remote JS (`eval`, CDN scripts)
- All extension code in the CRX
- Limited Use / user-data policies; disclose communication with
  `api.proxyhubb.com`
- Unpacked + enterprise policy install for testnet before public listing

---

## M. Implementation roadmap

### Phase 0 — Unblock testers (do this first)

1. `GET /v1/orders/:id/credentials` keeps HMAC in `password` for public `:8090`;
   `session_capability` / `legacy_password` / `auth_for_endpoint` are explicit.
2. Shop UI: curl example uses HMAC; show capability as advanced.
3. Document CONNECT-only + Chrome auth model in `apps/docs`.

### Phase 1 — Extension shell

MV3, pair/finish, popup signed-in state, no proxy set yet.

### Phase 2 — Connect / disconnect

`fixed_servers` + `onAuthRequired` + wipe on off. Badge on/off.

### Phase 3 — Verify

Offscreen or tab: egress IP, latency to check URL, “healthy / failed”.

### Phase 4 — Marketplace handoff

Success page **Connect with ProxyHubb**; install CTA; `externally_connectable`.

### Phase 5 — Reliability

Expiry alarm, `onProxyError` UX, switch proxy, SW keep-alive, incognito note.

### Phase 6 — Advanced (optional)

PAC allowlists, WebRTC policy, rotation **of credentials** not silent listing
auto-buy.

### Phase 7 — Desktop agent

Only after store listing and a real demand for OS-wide / SOCKS5-auth.

---

## Complexity, risks, UX, scale

| | |
|--|--|
| Complexity (MVP) | Medium. Chrome APIs are small; CWS permissions and auth-SW lifetime are the work |
| Major risks | DIRECT fallback, wrong password vs `:8090`, `<all_urls>` review, SW sleep missing 407 |
| Security | Extension is a credential custodian. Minimize TTL. Edge remains admission SoT |
| UX | “Turn on / Turn off” is achievable for HTTP CONNECT in Chrome |
| Scale | One Chrome proxy per profile. N buyers = N CONNECT sessions on existing edges — no new data plane |
| Extensibility | Desktop agent later without rewriting control-api |

---

## What not to build

- A second session blockchain (`programs/session`)
- Client-authoritative billing
- Auto-failover that spends the user’s SOL
- SOCKS5 as the Chrome default
- Claiming DePIN or “VPN” or “no leaks”
- Reading browsing history to “optimize routing”
