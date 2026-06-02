import { StaticInfoPage } from "@/components/StaticInfoPage";

export default function HelpPage() {
    return (
        <StaticInfoPage
            eyebrow="Support"
            title="Help Center"
            summary="Find the core paths for buying proxy bandwidth, running provider nodes, wallet setup, and community support."
            sections={[
                {
                    title: "Buying proxy bandwidth",
                    body: "Start in the marketplace, review price, capacity, location, trust signals, and listing status, then create a session from the listing detail page.",
                },
                {
                    title: "Running provider nodes",
                    body: "Providers should use the provider dashboard to complete setup, create API tokens, register nodes, and publish listings tied to healthy infrastructure.",
                },
                {
                    title: "Getting help",
                    body: "For account, billing, node, or marketplace issues, include the affected listing, order, session, or wallet reference when contacting support.",
                },
            ]}
        />
    );
}
