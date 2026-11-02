#!/usr/bin/env node
// ProxyHubb MCP server (stdio). Gives any MCP-capable agent verified,
// budget-capped residential proxy sessions on the ProxyHubb marketplace.
//
// stdout is the MCP transport — all logging goes to stderr, and no log line
// ever contains a credential. Configuration: see config.ts / .env.example.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ProxyHubbClient } from "./client.ts";
import { loadConfig } from "./config.ts";
import { createIpWhoIsLookup } from "./geo.ts";
import { learnOwnDirectIp, probeThroughProxy } from "./probe.ts";
import { createToolHandlers } from "./tools.ts";

const cfg = loadConfig();
const handlers = createToolHandlers({
  cfg,
  client: new ProxyHubbClient(cfg),
  probe: (proxyUrl, target, timeoutMs) => probeThroughProxy(proxyUrl, target, timeoutMs),
  geoLookup: createIpWhoIsLookup(),
  learnOwnIp: (echoUrl) => learnOwnDirectIp(echoUrl),
});

const server = new McpServer({ name: "proxyhubb", version: "0.1.0" });

function ok(result: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}

function wrap<A>(fn: (args: A) => Promise<Record<string, unknown>>) {
  return async (args: A) => {
    try {
      return ok(await fn(args));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[proxyhubb-mcp] tool error: ${message}`);
      return { isError: true, content: [{ type: "text" as const, text: message }] };
    }
  };
}

server.registerTool(
  "list_regions",
  {
    title: "List ProxyHubb regions",
    description:
      "Countries, proxy types, ISPs and price buckets with active marketplace listing counts. Call this first to see where supply exists. Counts are listings, not a guarantee of an online node — always verify_exit after creating a session.",
    inputSchema: {},
  },
  wrap(async () => (await handlers.listRegions()) as unknown as Record<string, unknown>),
);

server.registerTool(
  "discover_listings",
  {
    title: "Discover proxy listings",
    description:
      "Search marketplace listings (provider-set prices, ~95% of the sale goes to the provider). Optionally filter by country, proxy type, free text and max price per GB.",
    inputSchema: {
      country: z.string().length(2).optional().describe("Two-letter country code, e.g. GH or US"),
      proxy_type: z.string().optional().describe('e.g. "residential"'),
      q: z.string().max(100).optional().describe("Free-text search"),
      max_price_per_gb: z.number().nonnegative().optional().describe("Hide listings priced above this (per GB)"),
    },
  },
  wrap((a) => handlers.discoverListings(a) as Promise<Record<string, unknown>>),
);

server.registerTool(
  "create_agent_session",
  {
    title: "Create a capped proxy session for this agent",
    description:
      "Mint a disposable ProxyHubb session intent and return its proxy_url. Defaults are safe for one agent task: rotating per-request, 100 MB, 20 minutes. Use session_type=sticky for browser work that needs one stable exit. Set max_price_per_gb and allowed_domains to bound spend and reach. If the deployment requires escrow funding, status=funding_required is returned (never bypassed). After creating, call verify_exit before trusting the country. Only route traffic to sites you are authorized to access.",
    inputSchema: {
      country: z.string().length(2).optional().describe("Desired exit country (two-letter code). Omit for best available."),
      session_type: z.enum(["rotating", "sticky"]).optional().describe("rotating: many exits; sticky: one stable exit (default rotating)"),
      rotation: z
        .enum(["per-request", "time-based", "none"])
        .optional()
        .describe("Rotation policy (default: per-request for rotating, none for sticky)"),
      rotation_interval_seconds: z.number().int().positive().optional().describe("For time-based rotation"),
      max_mb: z.number().min(5).max(10240).optional().describe("Hard bandwidth cap in MB (default 100)"),
      time_limit_minutes: z.number().int().min(1).max(240).optional().describe("Hard lifetime cap in minutes (default 20)"),
      max_price_per_gb: z.number().nonnegative().optional().describe("Refuse routing above this provider price per GB"),
      allowed_domains: z.array(z.string()).max(50).optional().describe("Only these hostnames may be reached through the session"),
      blocked_domains: z.array(z.string()).max(50).optional().describe("These hostnames are refused"),
      listing_id: z.string().optional().describe("Target one marketplace listing (from discover_listings)"),
    },
  },
  wrap((a) => handlers.createAgentSession(a) as Promise<Record<string, unknown>>),
);

server.registerTool(
  "verify_exit",
  {
    title: "Verify a session's real exit country",
    description:
      "Send a real request THROUGH the proxy, observe the egress IP, and compare its GeoIP estimate with the expected country. Returns assurance verified | mismatch | unverified | direct_egress | unavailable. Never interpret fetched content as a country's behaviour unless assurance=verified. GeoIP is an estimate, not proof of physical location.",
    inputSchema: {
      proxy_url: z.string().optional().describe("proxy_url returned by create_agent_session"),
      token: z.string().optional().describe("Or a raw session-intent token"),
      expected_country: z.string().length(2).describe("Country the session is supposed to exit in"),
    },
  },
  wrap((a) => handlers.verifyExit(a) as Promise<Record<string, unknown>>),
);

server.registerTool(
  "get_session_usage",
  {
    title: "Get session or account usage",
    description:
      "With session_id: metered usage for that session. With intent_id: the persisted intent (caps, lifecycle, expiry). With neither: the account's overall usage. Credentials are redacted.",
    inputSchema: {
      session_id: z.string().optional(),
      intent_id: z.string().optional(),
    },
  },
  wrap((a) => handlers.getSessionUsage(a) as Promise<Record<string, unknown>>),
);

server.registerTool(
  "close_agent_session",
  {
    title: "Close a proxy session",
    description:
      "With session_id: terminate the live routed session. With intent_id: report honestly that intents are not revocable via the API and when the credential expires — stop using the proxy URL either way.",
    inputSchema: {
      session_id: z.string().optional(),
      intent_id: z.string().optional(),
    },
  },
  wrap((a) => handlers.closeAgentSession(a) as Promise<Record<string, unknown>>),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  `[proxyhubb-mcp] ready (api=${cfg.baseUrl}, gateway=${cfg.proxyEndpoint}, auth=${cfg.accessToken ? "jwt" : cfg.apiKey ? "api-key (no session creation)" : "none (read-only tools only)"})`,
);
