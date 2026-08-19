import { StaticInfoPage } from "@/components/StaticInfoPage";

export default function ExtensionPrivacyPage() {
    return (
        <StaticInfoPage
            eyebrow="Legal"
            title="Chrome extension privacy"
            summary="This page is the privacy policy for the ProxyHubb Chrome extension. It does not read your browsing history or page content. It is not a VPN."
            sections={[
                {
                    title: "What the extension does",
                    body: "After you buy a listing on proxyhubb.com, the extension can pair this browser to your account and turn on Chrome HTTP CONNECT to proxy.proxyhubb.com:8090 using HMAC credentials for that purchase. Turn off sets Chrome proxy to direct locally and does not need the API.",
                },
                {
                    title: "Data we process",
                    body: "The extension may hold a device access token, a refresh token, your account label, purchased order ids, HMAC proxy username and password, and the last egress-check IP (from a short-lived tab to api.ipify.org or httpbin.org/ip). Those secrets stay in chrome.storage.session for this browser session. We do not use chrome.storage.sync. We do not collect page contents, form fields, or browsing history.",
                },
                {
                    title: "Who we talk to",
                    body: "The extension calls https://api.proxyhubb.com for pair, bootstrap, credentials, and device-token refresh. While connected, Chrome sends HTTP CONNECT to proxy.proxyhubb.com:8090. Verify tabs load public IP check URLs only to confirm CONNECT. Pairing messages are accepted only from proxyhubb.com (and local shop during development).",
                },
                {
                    title: "Permissions",
                    body: "proxy sets or clears Chrome’s HTTP CONNECT settings. storage holds the session described above. alarms wake the service worker so proxy 407 still receives HMAC after idle, and to warn before marketplace session expiry. webRequest and webRequestAuthProvider answer proxy authentication only (isProxy). scripting reads the IP-check tab text, not other sites. Host access to all URLs is required so Chrome can prompt for proxy credentials on sites you visit while connected; the extension does not inject into those pages.",
                },
                {
                    title: "What we do not do",
                    body: "We do not sell extension data. We do not use it for advertising. We do not auto-buy listings or spend SOL from the extension. Capability soak tokens (phubb1.) are not used as the public CONNECT password.",
                },
                {
                    title: "Contact",
                    body: "Questions about this policy: use the Contact page on proxyhubb.com. The general marketplace privacy policy also applies to your account on the website.",
                },
            ]}
        />
    );
}
