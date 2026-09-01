# ProxyHubb Browser Extension: Packaging & Store Publishing Guide

**Target Stores**: Chrome Web Store, Brave / Edge Web Store, Mozilla Firefox Add-ons (AMO)  
**Manifest Version**: Manifest v3  
**Package Version**: 0.6.1  
**Source Directory**: `apps/extension/`  

---

## 1. Overview & Architecture

The **ProxyHubb Browser Extension** provides buyers with instant, 1-click proxy routing directly in their browser without manual network setting configurations.

### Key Capabilities
- **1-Click Connect**: Switches the browser into proxy mode (`proxy.proxyhubb.com:8090`) with single-click toggle.
- **WebRTC IP Leak Shield**: Restricts WebRTC STUN/UDP traffic via `chrome.privacy.network.webRTCIPHandlingPolicy` (`disable_non_proxied_udp`), ensuring real residential/ISP IP addresses never leak.
- **HMAC Credential Auto-Injection**: Handles proxy authentication automatically via `chrome.webRequest.onAuthRequired` using temporary session tokens.
- **Zero-Friction Pairing**: Syncs with active marketplace orders on `proxyhubb.com` via pairing codes or direct `externally_connectable` messages.

---

## 2. Build & Packaging Commands

All build scripts are automated through `apps/extension`:

### 1. Build Local Unpacked Extension:
```powershell
npm.cmd --prefix apps/extension run build
```
*Output*: `apps/extension/dist/` (Loadable via `chrome://extensions` → **Load unpacked**).

### 2. Package for Web Store Submission:
```powershell
npm.cmd --prefix apps/extension run pack
```
*Output*: `apps/extension/web-store/proxyhubb-extension-0.6.1.zip`

---

## 3. Chrome Web Store Submission Checklist

### Step 1: Access Developer Dashboard
1. Go to the **[Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devcenter)**.
2. Click **Add new item** and upload `apps/extension/web-store/proxyhubb-extension-0.6.1.zip`.

### Step 2: Store Listing Details
- **Item Name**: `ProxyHubb`
- **Short Description**: `Turn on HTTP CONNECT for your ProxyHubb purchases. HMAC proxy.proxyhubb.com:8090 — not a VPN.`
- **Category**: `Productivity` or `Developer Tools`
- **Homepage URL**: `https://proxyhubb.com`
- **Privacy Policy URL**: `https://proxyhubb.com/privacy`

### Step 3: Permissions Justification (CWS Reviewer Prompts)

When prompted by the review system for permission justifications, provide the following standard answers:

| Permission | Review Justification |
| :--- | :--- |
| **`proxy`** | Used to configure HTTP CONNECT proxy settings to the ProxyHubb gateway (`proxy.proxyhubb.com:8090`) when the user toggles the Connect button. |
| **`privacy`** | Used to configure `webRTCIPHandlingPolicy` (`disable_non_proxied_udp`) to prevent real user IP address leakage over WebRTC while the proxy is active. |
| **`storage`** | Used to persist temporary session tokens, paired user labels, and connection state in local/session memory. |
| **`webRequest`** & **`webRequestAuthProvider`** | Used to intercept HTTP 407 Proxy Authentication challenges and inject the user's purchased proxy credentials automatically. |
| **`alarms`** | Used for periodic health checking and renewal timers on active proxy leases. |

---

## 4. Firefox Add-ons (AMO) Submission Guide

The extension includes built-in Gecko settings in `manifest.json`:
```json
"browser_specific_settings": {
  "gecko": {
    "id": "extension@proxyhubb.com",
    "strict_min_version": "109.0"
  }
}
```

### Steps:
1. Log in to the **[Mozilla Add-on Developer Hub (AMO)](https://addons.mozilla.org/developers/)**.
2. Click **Submit a New Add-on** → **On this site**.
3. Upload `apps/extension/web-store/proxyhubb-extension-0.6.1.zip`.
4. Provide source code links and submit for automated signing.

---

## 5. Local Developer Verification

### In Google Chrome / Brave / Edge:
1. Navigate to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select `f:\project\proxyhubb\apps\extension\dist`.
4. Click the ProxyHubb toolbar icon, verify the **🛡️ WebRTC IP Leak Shield: Active** badge, and test connection.

### In Mozilla Firefox:
1. Navigate to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on...**
3. Select `apps/extension/dist/manifest.json`.
