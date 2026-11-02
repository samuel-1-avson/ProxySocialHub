// Minimal example agent: talks to the ProxyHubb MCP server over stdio the
// way Claude, Cursor or any MCP client would.
//
//   npm run example                     # read-only: list regions (live API)
//   PROXYHUBB_ACCESS_TOKEN=<jwt> npm run example
//                                       # also mint a capped GH session and verify its exit
//   EXAMPLE_COUNTRY=US npm run example  # pick another country
//
// The full proxy URL is never printed (masked via redact.ts). In a real agent
// you would now hand proxy_url to Playwright/fetch and do the task — then
// check get_session_usage for the receipt.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { maskProxyUrl } from "../src/redact.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, "..", "src", "server.ts");
const country = (process.env.EXAMPLE_COUNTRY ?? "GH").toUpperCase();

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...(process.env as Record<string, string>) },
});
const client = new Client({ name: "proxyhubb-example-agent", version: "0.1.0" });
await client.connect(transport);

function structured(result: unknown): Record<string, unknown> {
  const r = result as { structuredContent?: Record<string, unknown>; isError?: boolean; content?: { text?: string }[] };
  if (r.isError) throw new Error(r.content?.[0]?.text ?? "tool call failed");
  return r.structuredContent ?? {};
}

try {
  const tools = await client.listTools();
  console.log(`Tools: ${tools.tools.map((t) => t.name).join(", ")}`);

  const regions = structured(await client.callTool({ name: "list_regions", arguments: {} }));
  console.log("Regions:", JSON.stringify(regions.countries));

  if (!process.env.PROXYHUBB_ACCESS_TOKEN?.trim()) {
    console.log("Set PROXYHUBB_ACCESS_TOKEN to also create a capped session and verify its exit.");
  } else {
    const session = structured(
      await client.callTool({
        name: "create_agent_session",
        arguments: { country, session_type: "sticky", max_mb: 25, time_limit_minutes: 10 },
      }),
    );
    console.log(`Session status: ${String(session.status)} (intent ${String(session.intent_id)})`);
    if (session.status === "funding_required") {
      console.log(`Fund first: ${String(session.next_step)}`);
    } else if (typeof session.proxy_url === "string") {
      console.log(`Proxy: ${maskProxyUrl(session.proxy_url)}`);
      const verdict = structured(
        await client.callTool({
          name: "verify_exit",
          arguments: { proxy_url: session.proxy_url, expected_country: country },
        }),
      );
      console.log(
        `Exit check: assurance=${String(verdict.assurance)} ip=${String(verdict.observed_ip)} geoip=${String(verdict.geoip_country)}`,
      );
      console.log("Hand proxy_url to your browser/fetch now — and only trust the region if assurance=verified.");
    }
  }
} finally {
  await client.close();
}
