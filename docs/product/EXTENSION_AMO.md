# Firefox Add-ons (AMO) listing

Same extension as Chrome, built for Firefox 128 or newer (desktop and Android).
Its add-on id is `extension@proxyhubb.com` (set in `manifest.json`).

## Pack

```bash
cd apps/extension
npm test
npm run lint:firefox      # Mozilla's validator; must report 0 errors
npm run pack:firefox
```

This writes two files to `apps/extension/web-store/` (gitignored):

- `proxyhubb-extension-firefox-<version>.zip`: the add-on to upload.
- `proxyhubb-extension-firefox-<version>-source.zip`: the source AMO asks for,
  because the add-on is bundled with esbuild. Build steps are in
  `apps/extension/AMO_SOURCE.md`.

## Submit

1. Sign in at https://addons.mozilla.org/developers/ (free Mozilla account).
2. Click **Submit a New Add-on**, choose **On this site**, and upload the add-on zip.
3. When asked whether the add-on uses a bundler or minifier, say yes and upload the source zip.
4. Listing fields: reuse the name, summary, description and privacy policy URL
   from [EXTENSION_CWS.md](EXTENSION_CWS.md). Name it **ProxyHubb** (other add-ons
   already use "ProxyHub").
5. Data collection: the manifest declares `authenticationInfo` and
   `browsingActivity` (pairing tokens, and the sites a buyer opens travel
   through the proxy). Keep the listing answers consistent with that.

## After the listing is live

Put the listing URL in `.env` as `NEXT_PUBLIC_EXTENSION_AMO_URL` and rebuild the
web image. The order page then shows **Add to Firefox** to Firefox users.

## Testing before review

On the tunnel test site (`scripts/tunnel/start.ps1`), the order page links to
`/proxyhubb-extension-firefox.zip`. In Firefox open `about:debugging`, choose
**This Firefox**, click **Load Temporary Add-on**, and pick that zip. Temporary
add-ons are removed when Firefox closes.
