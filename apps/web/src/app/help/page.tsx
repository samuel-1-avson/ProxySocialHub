import { StaticInfoPage } from "@/components/StaticInfoPage";

export default function HelpPage() {
    return (
        <StaticInfoPage
            eyebrow="Support"
            title="Help Center"
            summary="Find the core paths for buying proxy bandwidth, running provider nodes, wallet setup, and community support."
            sections={[
                {
                    title: "This is a Solana Devnet Testnet",
                    body: "ProxyHubb currently runs on Solana devnet with free/test SOL. Balances and inventory can reset. The stack runs on a single server (not HA). Settlement is wallet-native and escrowed on-chain, but the marketplace, discovery, and gateway are operated by the platform — not a trustless network. Do not send mainnet SOL.",
                },
                {
                    title: "Technical documentation",
                    body: "API, SDKs, buyer proxy, marketplace, and provider CLI docs live at https://docs.proxyhubb.com — use that site for integration guides. This Help Center covers product support paths.",
                },
                {
                    title: "Buying proxy bandwidth",
                    body: "Start in the marketplace, review price, capacity, location, trust signals, and listing status, then create a session from the listing detail page. Use a Phantom (or similar) wallet set to Devnet.",
                },
                {
                    title: "Running provider nodes",
                    body: "Providers should use the provider dashboard to complete setup, create API tokens, register nodes, and publish listings tied to healthy infrastructure.",
                },
                {
                    title: "SDKs & Connect",
                    body: "Install proxyhubb (Python), @proxyhubb/sdk (Node), or the Go module from Connect Integration Matrices or docs.proxyhubb.com/docs/sdks. Use a dashboard JWT for session intents and order credentials; use a phub_ API key for bulk pools. Buyer traffic uses HTTP CONNECT / SOCKS5 on proxy.proxyhubb.com:8090.",
                },
                {
                    title: "Getting help",
                    body: "For account, billing, node, or marketplace issues, include the affected listing, order, session, or wallet reference when contacting support.",
                },
            ]}
        />
    );
}
