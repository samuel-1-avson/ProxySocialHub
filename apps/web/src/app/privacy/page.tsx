import { StaticInfoPage } from "@/components/StaticInfoPage";

export default function PrivacyPage() {
    return (
        <StaticInfoPage
            eyebrow="Legal"
            title="Privacy Policy"
            summary="This working privacy page explains the categories of data ProxyHubb expects to process for marketplace, provider, and network workflows."
            sections={[
                {
                    title: "Account and profile data",
                    body: "ProxyHubb may process account identifiers, profile details, provider metadata, wallet references, and settings required to operate the application.",
                },
                {
                    title: "Marketplace and network data",
                    body: "ProxyHubb may process listing, order, session, usage, telemetry, node health, and explorer data to support buying, selling, billing, and trust features.",
                },
                {
                    title: "Security data",
                    body: "ProxyHubb may process authentication, audit, notification, and security event data to protect users, providers, and the marketplace.",
                },
                {
                    title: "Chrome extension",
                    body: "The ProxyHubb Chrome extension has a dedicated policy at /privacy/extension. It holds device and HMAC credentials in session storage, talks to api.proxyhubb.com and proxy.proxyhubb.com:8090, and does not read browsing history or page content.",
                },
            ]}
        />
    );
}
