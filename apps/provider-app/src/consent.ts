// The consent wording, in one place. DRAFT v1: it needs your / legal review before any public
// release (docs/plans/provider-tray-app.md records which claims were checked against the code).
//
// Bump CONSENT_VERSION whenever the wording changes. It must equal CONSENT_VERSION in
// src-tauri/src/settings.rs (a Rust test pins that), so everyone is asked again.

export const CONSENT_VERSION = 1;

export const CONSENT_INTRO =
  'ProxyHubb Provider lets people who buy bandwidth on ProxyHubb browse the internet through your connection. Please read what that means:';

export const CONSENT_POINTS: readonly string[] = [
  'Websites they visit will see your home internet address, not theirs.',
  'Their traffic uses your internet speed and data allowance. You can pause sharing any time.',
  'Only web traffic is allowed (ports 80, 443, 8080 and 8443), and connections to private or local addresses on your own network are blocked.',
  "ProxyHubb's rules say buyers must use the service lawfully, but you are the owner of the connection. If someone misuses it, your internet provider may contact you. Sharing is not risk-free.",
];

export const CONSENT_CHECKBOX =
  'I own this internet connection, or I have permission from whoever does, and I understand the above.';
