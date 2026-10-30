import { StaticInfoPage } from "@/components/StaticInfoPage";

export default function ExtensionPrivacyPage() {
    return (
        <StaticInfoPage
            eyebrow="Legal"
            title="Browser extension privacy"
            summary="This is the privacy policy for the ProxyHubb extension for Chrome, Edge, Brave and Firefox. It does not read your browsing history or the content of the pages you visit. It is not a VPN."
            sections={[
                {
                    title: "What the extension does",
                    body: "After you buy a proxy on proxyhubb.com, the extension connects this browser to your account and turns the proxy on for that purchase. Turning it off sets the browser back to a direct connection on your device, and works even if ProxyHubb is unreachable.",
                },
                {
                    title: "Data we process",
                    body: "The extension keeps a device access token, a refresh token, your account name, your purchased order ids, the proxy username and password for the order you turn on, and the last IP address seen by a short check (a background tab to api.ipify.org or httpbin.org/ip). These stay in the browser's session storage and are cleared when the browser closes. Nothing is synced to other devices. We do not collect page content, form entries or browsing history.",
                },
                {
                    title: "Who it talks to",
                    body: "The extension talks to ProxyHubb (proxyhubb.com and api.proxyhubb.com) to connect your browser, list your purchases, fetch the proxy login, and renew its token. While the proxy is on, the sites you open travel through the ProxyHubb proxy and the provider you bought from, which is how a proxy works. The IP check tabs only load the public IP check pages named above.",
                },
                {
                    title: "On ProxyHubb pages",
                    body: "The extension runs a small script on proxyhubb.com pages only. It lets the \"Turn on proxy\" button on your order page talk to the extension. It does not read or change anything else on the page, and it does not run on other websites.",
                },
                {
                    title: "Permissions",
                    body: "proxy turns the browser's proxy on and off. storage holds the session described above. alarms keep the extension ready to answer the proxy's login request after the browser has been idle, and warn before a purchase expires. webRequest (with webRequestAuthProvider in Chrome, webRequestBlocking in Firefox) answers the ProxyHubb proxy's login request only, and ignores every other request. scripting reads the IP check tab's text, and no other page. privacy stops WebRTC from revealing your real IP while the proxy is on, and is reset when you turn it off. Access to all sites is needed so the browser can log in to the proxy on any site you open while it is on; the extension does not read those pages.",
                },
                {
                    title: "What we do not do",
                    body: "We do not sell extension data or use it for advertising. The extension cannot buy anything or spend money on its own.",
                },
                {
                    title: "Contact",
                    body: "Questions about this policy: use the Contact page on proxyhubb.com. The general ProxyHubb privacy policy also applies to your account on the website.",
                },
            ]}
        />
    );
}
