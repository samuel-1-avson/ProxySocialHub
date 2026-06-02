import { StaticInfoPage } from "@/components/StaticInfoPage";

export default function ContactPage() {
    return (
        <StaticInfoPage
            eyebrow="Support"
            title="Contact ProxyHubb"
            summary="Use this page as the public support entry point for marketplace, wallet, provider, account, and network issues."
            sections={[
                {
                    title: "Marketplace and sessions",
                    body: "For listing, order, credential, or session problems, collect the listing ID, order ID, session ID, and the time the issue happened.",
                },
                {
                    title: "Provider operations",
                    body: "For provider node issues, include the node ID, CLI version, token status, and recent health or heartbeat behavior from the provider dashboard.",
                },
                {
                    title: "Security and wallet",
                    body: "For wallet, account, or security issues, avoid sending secrets. Share only identifiers, timestamps, and relevant transaction references.",
                },
            ]}
        />
    );
}
