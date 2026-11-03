// Minimal example agent: talks to the ProxyHubb MCP server over stdio the
// way Claude, Cursor or any MCP client would.
//
//   npm run example                     # read-only: list regions (live API)
//   PROXYHUBB_ACCESS_TOKEN=<jwt> npm run example
//                                       # also get a GH session and verify its exit: an active
//                                       # order you already paid for if there is one, otherwise
//                                       # a newly minted capped session intent
//   PROXYHUBB_API_KEY=<phub_ key with orders:create> npm run example
//                                       # orders only, without your JWT
//   EXAMPLE_COUNTRY=US npm run example  # pick another country
//   EXAMPLE_URL=https://example.com npm run example
//                                       # also fetch_url that page through the exit (refused
//                                       # unless verified; EXAMPLE_REQUIRE_VERIFIED=0 fetches
//                                       # anyway, labelled unverified)
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

  const hasToken = Boolean(process.env.PROXYHUBB_ACCESS_TOKEN?.trim());
  const hasKey = Boolean(process.env.PROXYHUBB_API_KEY?.trim());
  let proxyUrl: string | null = null;

  if (hasToken || hasKey) {
    // Prefer an order the owner already paid for: it carries traffic even where new sessions need funding.
    const mine = structured(await client.callTool({ name: "list_my_orders", arguments: { country } }));
    const orders = Array.isArray(mine.orders) ? (mine.orders as Record<string, unknown>[]) : [];
    console.log(`Active ${country} orders: ${orders.length}`);
    const first = orders[0];
    if (first) {
      const used = structured(
        await client.callTool({ name: "use_my_order", arguments: { order_id: first.order_id, expected_country: country } }),
      );
      console.log(`Order ${String(first.order_id)}: ${String(used.status)}${used.code ? ` (${String(used.code)}: ${String(used.message)})` : ""}`);
      if (typeof used.proxy_url === "string") proxyUrl = used.proxy_url;
    }
  }

  if (!proxyUrl && hasToken) {
    const session = structured(
      await client.callTool({
        name: "create_agent_session",
        arguments: { country, session_type: "sticky", max_mb: 25, time_limit_minutes: 10 },
      }),
    );
    console.log(`Session status: ${String(session.status)} (intent ${String(session.intent_id)})`);
    if (session.status === "funding_required") console.log(`Fund first: ${String(session.next_step)}`);
    if (typeof session.proxy_url === "string") proxyUrl = session.proxy_url;
  }

  if (proxyUrl) {
    console.log(`Proxy: ${maskProxyUrl(proxyUrl)}`);
    const verdict = structured(
      await client.callTool({ name: "verify_exit", arguments: { proxy_url: proxyUrl, expected_country: country } }),
    );
    console.log(
      `Exit check: assurance=${String(verdict.assurance)} ip=${String(verdict.observed_ip)} geoip=${String(verdict.geoip_country)}`,
    );
    console.log("Hand proxy_url to your browser/fetch now — and only trust the region if assurance=verified.");
  } else if (!hasToken && !hasKey) {
    console.log("Set PROXYHUBB_ACCESS_TOKEN (or an orders:create PROXYHUBB_API_KEY) to also get a session and verify its exit.");
  }

  const pageUrl = process.env.EXAMPLE_URL?.trim();
  if (pageUrl && (hasToken || hasKey)) {
    // What a chat agent would call: no credential comes back, only the page.
    const page = structured(
      await client.callTool({
        name: "fetch_url",
        arguments: { url: pageUrl, country, require_verified: process.env.EXAMPLE_REQUIRE_VERIFIED !== "0" },
      }),
    );
    const exit = (page.exit ?? {}) as Record<string, unknown>;
    console.log(
      `fetch_url: ${String(page.status)}${page.http_status ? ` (HTTP ${String(page.http_status)})` : ""} exit=${String(exit.assurance ?? "-")}${page.code ? ` code=${String(page.code)}` : ""}`,
    );
    if (page.status === "fetched") {
      console.log(`Title: ${String(page.title)}`);
      console.log(`Text: ${String(page.text ?? "").slice(0, 200).replace(/\s+/g, " ")}…`);
    } else if (page.message) {
      console.log(String(page.message));
    }
  }
} finally {
  await client.close();
}
