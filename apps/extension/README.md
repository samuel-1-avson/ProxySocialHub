# ProxyHubb browser extension

See [docs/product/EXTENSION_UNPACKED.md](../../docs/product/EXTENSION_UNPACKED.md) for load-unpacked steps.

This build can Turn on HTTP CONNECT from the popup or from **Connect with ProxyHubb** on the shop (pair + connect for that order). HMAC `proxy.proxyhubb.com:8090` only. Device JWT stays on disconnect; re-pair after a browser restart.

While connected, a 1-minute alarm keeps the service worker able to answer 407 HMAC. Marketplace session `expires_at` warns ~5 minutes before, then Turn off locally. Switch in the popup replaces the one Chrome-profile proxy (reload tabs). Enable **Allow in incognito** on `chrome://extensions` if you need private windows.
