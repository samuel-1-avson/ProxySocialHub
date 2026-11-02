import { NextResponse, type NextRequest } from "next/server";
import { resolveAuditUser } from "@/lib/server/audit-auth";
import { probeThroughGateway } from "@/lib/server/proxy-probe";

export const dynamic = "force-dynamic";

/**
 * Two different questions, answered separately and never confused:
 *
 *  GET   "Is the control API answering?"  Anonymous. It does NOT touch the proxy
 *        gateway or any provider, and says so (proxy_verified is always false).
 *
 *  POST  "Does traffic actually traverse the gateway with this session?"
 *        Authenticated. Opens an HTTP CONNECT tunnel through the gateway with the
 *        caller's own session-intent token, requests a fixed echo URL over TLS
 *        and reports the response it observed. The target is server configuration,
 *        never request input, so this cannot be used to reach other hosts.
 */

function proxyEndpoint(): string {
  return (
    process.env.PROXYHUBB_PROXY_ENDPOINT?.trim() ||
    process.env.NEXT_PUBLIC_PROXY_ENDPOINT?.trim() ||
    "localhost:8090"
  ).replace(/^https?:\/\//, "");
}

export async function GET() {
  const endpoint = proxyEndpoint();
  const controlApiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:18080";
  try {
    const response = await fetch(`${controlApiUrl}/health`, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (response.ok) {
      return NextResponse.json({
        status: "api_reachable",
        proxy_verified: false,
        endpoint,
        message: "The control API is reachable. No proxy traffic was tested: this check does not use a session or contact the gateway.",
      });
    }
    return NextResponse.json(
      { status: "offline", proxy_verified: false, endpoint, message: `The control API answered HTTP ${response.status}.` },
      { status: 503 },
    );
  } catch {
    return NextResponse.json(
      { status: "offline", proxy_verified: false, endpoint, message: "The control API could not be reached." },
      { status: 503 },
    );
  }
}

// -- authenticated end-to-end test -------------------------------------------------------

const recent = new Map<string, number>();

function echoTarget(): URL | null {
  const raw = process.env.PROXY_TEST_ECHO_URL?.trim() || process.env.AUDITOR_EGRESS_ECHO_URL?.trim() || "https://api.ipify.org/?format=json";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  if (!request.headers.get("authorization")?.toLowerCase().startsWith("bearer ")) {
    return NextResponse.json({ status: "unauthorized", proxy_verified: false, message: "Sign in to test a session." }, { status: 401 });
  }
  const user = await resolveAuditUser(request);
  if (!user) return NextResponse.json({ status: "unauthorized", proxy_verified: false, message: "Sign in to test a session." }, { status: 401 });

  const last = recent.get(user.id) ?? 0;
  if (Date.now() - last < 4000) {
    return NextResponse.json({ status: "rate_limited", proxy_verified: false, message: "Wait a few seconds between tests." }, { status: 429 });
  }
  recent.set(user.id, Date.now());

  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  const token = body?.token;
  if (typeof token !== "string" || token.length < 16 || token.length > 4096 || !/^[A-Za-z0-9._~+/=-]+$/.test(token)) {
    return NextResponse.json({ status: "invalid_request", proxy_verified: false, message: "A session-intent token is required." }, { status: 400 });
  }
  const target = echoTarget();
  if (!target) {
    return NextResponse.json({ status: "not_configured", proxy_verified: false, message: "The proxy test target is not configured (PROXY_TEST_ECHO_URL must be https)." }, { status: 503 });
  }

  const endpoint = proxyEndpoint();
  const result = await probeThroughGateway(endpoint, token, target);
  if (result.ok) {
    return NextResponse.json({
      status: "proxy_verified",
      proxy_verified: true,
      endpoint,
      observed_ip: result.ip,
      target: result.target,
      elapsed_ms: result.elapsedMs,
      message: `A request reached ${result.target} through the gateway and was answered. The observed exit IP is ${result.ip}. This does not verify the exit's country.`,
    });
  }
  return NextResponse.json(
    { status: "proxy_failed", proxy_verified: false, endpoint, stage: result.stage, message: result.message },
    { status: 502 },
  );
}
