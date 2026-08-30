# ProxyHubb browser extension (unpacked)

Use this while the Chrome Web Store item is in review. Do **not** set
`NEXT_PUBLIC_EXTENSION_CWS_URL` or the store extension ID until Google approves
and hosts the listing.

1. `cd apps/extension && npm install && npm run build`
2. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → `apps/extension/dist`
3. Copy the 32-character ID shown on that page
4. Buy on https://proxyhubb.com (Phantom on **Devnet**, buyer wallet ≠ seller)
5. After purchase, either:
   - Paste a pairing code from the shop into the popup → **Pair this browser** → select the order → **Turn on**, or
   - Paste the unpacked ID into **Local unpacked extension ID** on the order page (needs the shop build that includes that field) → **Connect with ProxyHubb**
6. Popup **Check IP** should show a non-home address. **Turn off** restores direct.

Keep the popup API URL as `https://api.proxyhubb.com`.

The unpacked ID is unique to this Chrome profile and folder. It is **not** the
store item `icapeackjloaiggfedmfeaoadioiiljn`. Leave that store submission alone.

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

See [EXTENSION_IMPLEMENTATION_PLAN.md](EXTENSION_IMPLEMENTATION_PLAN.md) PR-G and [EXTENSION_CWS.md](EXTENSION_CWS.md) for Chrome Web Store packing.

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

See [EXTENSION_IMPLEMENTATION_PLAN.md](EXTENSION_IMPLEMENTATION_PLAN.md) PR-G and [EXTENSION_CWS.md](EXTENSION_CWS.md) for Chrome Web Store packing.
