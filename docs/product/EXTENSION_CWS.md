# Chrome Web Store listing

The repo prepares the package; it only reaches the store when someone uploads it
in the Chrome Web Store developer dashboard. Firefox: see
[EXTENSION_AMO.md](EXTENSION_AMO.md).

## Check the current status

1. Open https://chrome.google.com/webstore/devconsole and sign in with the
   Google account that owns the listing.
2. Find **ProxyHubb** (item id `icapeackjloaiggfedmfeaoadioiiljn` in older notes).
   The **Status** column says Draft, Pending review, Rejected, or Published.
3. If there is no item, click **New item** and upload the zip below.

## Pack

```bash
cd apps/extension
npm test
npm run pack
```

Upload `apps/extension/web-store/proxyhubb-extension-chrome-<version>.zip`
(gitignored). The zip root holds `manifest.json`. The store build drops
localhost entries and source maps, and refuses to run if `PROXYHUBB_SITE` is set.
Bump `version` in both `manifest.json` and `package.json` before each upload;
the store rejects a version it has already seen.

Never commit `*.pem`, `*.crx`, or the zip. Chrome "Pack extension" writes a
private key next to the folder: delete it or keep it outside the repo.

## Dashboard fields (paste)

**Name:** ProxyHubb

**Summary:** Turn on your ProxyHubb proxy in one click. Not a VPN.

**Category:** Productivity

**Language:** English

**Visibility:** Unlisted while testing, Public for launch

**Homepage:** https://proxyhubb.com

**Privacy policy:** https://proxyhubb.com/privacy/extension

**Single purpose:** Turn the browser's proxy on and off for a ProxyHubb purchase the user already paid for.

**Description:**

ProxyHubb lets you use a residential proxy you bought on proxyhubb.com in this browser, with one click.

How it works:

1. Buy a proxy on proxyhubb.com.
2. Add this extension.
3. On your order page, click "Turn on proxy". The sites you open now use that proxy.
4. Click "Turn off" (on the page or in the toolbar popup) to go back to your normal connection. This works even if ProxyHubb is unreachable.

The popup shows your IP so you can confirm the proxy is on. It also protects your real IP from leaking through WebRTC while the proxy is on.

This is not a VPN: it changes the browser's proxy only, and your device still looks up site names itself. The extension does not read your history or the content of pages you visit. One browser profile uses one proxy at a time.

**Permission justifications**

- `proxy`: Turn the browser proxy on for the purchased ProxyHubb proxy, and back to direct when turned off.
- `storage`: Keep the device session and the proxy login in session storage only (cleared when the browser closes).
- `alarms`: Keep the extension able to answer the proxy's login request after the browser is idle, and warn before a purchase expires.
- `scripting`: Read the text of a short-lived IP check tab (api.ipify.org or httpbin.org/ip) to confirm the proxy works. Not used on other sites.
- `webRequest` + `webRequestAuthProvider`: Answer the ProxyHubb proxy's login request. The listener ignores every non-proxy request and never reads request bodies.
- `privacy`: Stop WebRTC from exposing the user's real IP while the proxy is on; reset when it is turned off.
- Host access to all URLs: Needed so the browser can log in to the proxy on any site the user opens while it is on. The extension does not read or change those pages.
- Content script on proxyhubb.com: Lets the "Turn on proxy" button on the order page reach the extension. Runs only on proxyhubb.com.

## Assets in this repo

- Icons: `apps/extension/src/icons/icon{16,32,48,128}.png`
- Screenshot: `apps/extension/store-assets/screenshot-1280x800.png` (replace with a real capture of the popup and the order page before a public launch)

## After the listing is live

1. Put the store URL in `.env` as `NEXT_PUBLIC_EXTENSION_CWS_URL` and rebuild
   the web image. The order page then shows **Add to Chrome**.
2. No extension id is needed any more: the site reaches the extension through
   its content script.

Review for `<all_urls>` + proxy can take several days. If it is rejected, answer
with the justifications above; do not add history, cookies or page-content permissions.
