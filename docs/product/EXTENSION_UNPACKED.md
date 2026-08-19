# ProxyHubb browser extension (unpacked)

Load this folder after `npm run build`:

1. `cd apps/extension && npm install && npm run build`
2. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → `apps/extension/dist`
3. Copy the extension ID into `apps/web/.env.local` as `NEXT_PUBLIC_EXTENSION_ID=...` (optional; paste-code still works)
4. Sign in on https://proxyhubb.com or `http://localhost:4011`, open an active order, **Authorize this browser**
5. Popup should show the signed-in email. Choose the purchase and **Turn on**, or click **Connect with ProxyHubb** on the order / purchase-success page (needs `NEXT_PUBLIC_EXTENSION_ID`).

Default API is `https://api.proxyhubb.com`. For a local control-api, set the API field in the popup to `http://localhost:18080`.

**Connect** sets Chrome HTTP CONNECT to HMAC `proxy.proxyhubb.com:8090`. It never uses Host-A soak `:18091` or a `phubb1.` password. If live credentials still put `phubb1.` in `password`, the extension uses `legacy_password`.

**Turn off** sets Chrome proxy to `direct` locally. It does not call the API, so it still works if `api.proxyhubb.com` is down. It does not unpair (device JWT stays in session storage until the browser restarts).

Chrome uses **local DNS**. QUIC and WebRTC can bypass the HTTP proxy. This is not a VPN.

**Incognito:** the manifest is `spanning` (one proxy for regular + private windows). Chrome still hides the extension from incognito until you enable **Allow in incognito** on `chrome://extensions`. The popup says whether that is on.

While connected, a 1-minute alarm wakes the service worker so `onAuthRequired` can still return HMAC after idle. Marketplace session `expires_at` (when present) schedules a warn ~5 minutes before expiry; at expiry the extension sets `direct`, wipes HMAC secrets, and shows **Session expired. Turn on to reconnect.** Device JWT refresh uses `POST /v1/extension/refresh` and must not drop the proxy if it fails.

**Switch:** one Chrome profile = one proxy. Choosing another purchased order and **Switch** replaces `singleProxy` + HMAC. Reload open tabs. There is no auto-buy failover.

If another extension owns Chrome proxy (`controlled_by_other_extensions`), Turn on / Switch stay disabled until that extension releases control.

After a browser restart you must pair again (JWT is session-only). The service worker clears a leftover `fixed_servers` proxy if HMAC secrets are gone.

Manual check: Turn on → popup shows a green egress IP that is not your home IP → Turn off → popup home IP matches the pre-connect baseline.

Verify loads `api.ipify.org` / `httpbin.org/ip` in a short-lived background tab. The service worker does not `fetch` those URLs (SW fetch can skip `chrome.proxy`). Offscreen is not used: Chrome has no NETWORK reason for offscreen documents.

See [EXTENSION_IMPLEMENTATION_PLAN.md](../product/EXTENSION_IMPLEMENTATION_PLAN.md) PR-G.
