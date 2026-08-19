# Chrome Web Store listing (testers)

The extension is **not** on the store until you upload the zip in the Chrome
Web Store developer dashboard. This repo only prepares the package.

Publish as **Unlisted** so testers with the link can install it. Do not set
`NEXT_PUBLIC_EXTENSION_CWS_URL` until that listing URL exists.

## Pack

```bash
cd apps/extension
npm test
npm run pack
```

Upload `apps/extension/web-store/proxyhubb-extension-*.zip` (gitignored).
The zip root must contain `manifest.json`. Store build strips localhost hosts
and source maps.

Never commit `*.pem`, `*.crx`, or the zip. Chrome “Pack extension” writes a
private key next to the folder — delete it or keep it outside the repo.

## Dashboard fields (paste)

**Name:** ProxyHubb

**Summary:** Turn on HTTP CONNECT for ProxyHubb purchases you already paid for. HMAC to proxy.proxyhubb.com:8090 — not a VPN.

**Category:** Productivity

**Language:** English

**Visibility:** Unlisted (testers)

**Homepage:** https://proxyhubb.com

**Privacy policy:** https://proxyhubb.com/privacy/extension

**Single purpose:** Connect Chrome HTTP CONNECT to a ProxyHubb purchase the user already paid for.

**Description:**

ProxyHubb lets you turn on Chrome HTTP CONNECT for a residential proxy you bought on proxyhubb.com.

This is not a VPN. Chrome still uses local DNS. QUIC and WebRTC can bypass HTTP CONNECT. The extension does not read your history or page content.

How it works:

1. Buy a listing on proxyhubb.com.
2. Install this extension.
3. Click Connect with ProxyHubb on the order page (or pair with a one-time code in the popup).
4. Turn on. Chrome sends HTTP CONNECT to proxy.proxyhubb.com:8090 with HMAC.
5. Turn off sets the browser back to direct. That still works if the API is down.

One Chrome profile = one proxy. Switch purchases in the popup and reload tabs.

**Permission justifications**

- `proxy`: Set or clear Chrome HTTP CONNECT for the purchased ProxyHubb edge.
- `storage`: Hold device session and HMAC credentials in session storage only.
- `alarms`: Keep the service worker able to answer proxy 407 after idle, and warn before session expiry.
- `scripting`: Read text from a short-lived public IP check tab (api.ipify.org / httpbin.org/ip) to confirm CONNECT. Not used on other sites.
- `webRequest` + `webRequestAuthProvider`: Answer proxy 407 with HMAC. The listener ignores non-proxy challenges and does not read request bodies.
- Host access to all URLs: Required so Chrome can ask for proxy credentials on sites you visit while connected. The extension does not inject into those pages or read their content.

## Assets in this repo

- Icons: `apps/extension/src/icons/icon{16,32,48,128}.png`
- Promo screenshot (replace with a real popup capture before submit): `apps/extension/store-assets/screenshot-1280x800.png`

Store listing also needs a 128×128 icon upload (same as `icon128.png`).

## After Google approves

1. Copy the store URL into shop `NEXT_PUBLIC_EXTENSION_CWS_URL`.
2. Copy the 32-character extension id into `NEXT_PUBLIC_EXTENSION_ID`.
3. Roll Host-A `control-api` with existing overlays so live credentials match HMAC `password` (do not recreate `edge-a`).

Review for `<all_urls>` + proxy can take days. If rejected, answer with the justifications above; do not add history, cookies, or page-content permissions.
