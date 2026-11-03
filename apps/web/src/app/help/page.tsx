import type { Metadata } from "next";
import { StaticInfoPage } from "@/components/StaticInfoPage";

export const metadata: Metadata = {
  title: "Help Center",
  description:
    "Find the core paths for buying proxy bandwidth, running provider nodes, wallet setup, and community support.",
};

export default function HelpPage() {
  return (
    <StaticInfoPage
      eyebrow="Support"
      title="Help Center"
      summary="Find the core paths for buying proxy bandwidth, running provider nodes, wallet setup, and community support."
      sections={[
        {
          title: "Test network status",
          body: "Use Solana Devnet only. Test SOL, balances, and inventory can reset; never send mainnet funds. The current deployment runs on a single server and is not highly available. Marketplace discovery and gateway access are operated by ProxyHubb. A complete funded purchase, verified traffic, and accepted earnings run has not yet been confirmed end to end.",
        },
        {
          title: "Technical documentation",
          body: "API, SDKs, buyer proxy, marketplace, and provider CLI docs live at https://docs.proxyhubb.com. Use that site for integration guides. This Help Center covers product support paths.",
        },
        {
          title: "Buying proxy bandwidth",
          body: "Start in the marketplace, review price, capacity, location, trust signals, and listing status, then create a session from the listing detail page. Use a Solana wallet set to Devnet. Payment and session states are shown in Activity and Connections.",
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
          title: "AI agents (MCP)",
          body: "Connect Claude Desktop, Claude Code, Cursor or VS Code to ProxyHubb with the MCP server, then ask your agent to read a page as seen from another country. It uses orders you already bought and checks where each exit really is. Setup guide: docs.proxyhubb.com/docs/agents/mcp. Today it uses your website session token, which is your full login for up to 24 hours: never paste it into a chat or share it.",
        },
        {
          title: "Getting help",
          body: "For account, billing, node, or marketplace issues, include the affected listing, order, session, or wallet reference when contacting support.",
        },
      ]}
    />
  );
}
