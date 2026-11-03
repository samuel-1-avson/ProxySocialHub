import { NextRequest, NextResponse } from "next/server";
import {
  projectPublicData,
  publicResources,
  publicResourcePath,
  publicResourceTtlMs,
  type PublicResource,
} from "../../../lib/public-data";
import { createPublicCache, type Loaded } from "../../../lib/public-cache";
export const dynamic = "force-dynamic";
// Every visitor reaches the API through this one process, so share answers between them.
// Failures are only held for a moment, to calm a burst without hiding a recovery.
const serve = createPublicCache();
const NOT_FOUND_TTL_MS = 10_000;
const ERROR_TTL_MS = 2_000;
const reply = (status: number, body: unknown, source?: string) =>
  NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(source ? { "X-Public-Cache": source } : {}),
    },
  });
async function load(
  resource: PublicResource,
  endpoint: string,
): Promise<Loaded> {
  try {
    const url = new URL(
      endpoint,
      process.env.API_URL?.trim() || "http://127.0.0.1:18080",
    );
    // Deliberately forward no incoming cookies, authorization, or wallet data.
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404)
      return {
        status: 404,
        body: { error: "This public record was not found." },
        ttlMs: NOT_FOUND_TTL_MS,
      };
    if (!response.ok)
      return {
        status: 502,
        body: {
          error: `The public source returned ${response.status}. Try again when it is available.`,
        },
        ttlMs: ERROR_TTL_MS,
      };
    return {
      status: 200,
      body: projectPublicData(resource, await response.json()),
      ttlMs: publicResourceTtlMs(resource),
    };
  } catch {
    return {
      status: 503,
      body: { error: "Network data is temporarily unavailable. Try again shortly." },
      ttlMs: ERROR_TTL_MS,
    };
  }
}
export async function GET(request: NextRequest) {
  const resource = request.nextUrl.searchParams.get("resource");
  if (!publicResources.includes(resource as PublicResource))
    return NextResponse.json(
      { error: "Unknown public resource." },
      { status: 400 },
    );
  let endpoint: string;
  try {
    endpoint = publicResourcePath(
      resource as PublicResource,
      request.nextUrl.searchParams,
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid identifier." },
      { status: 400 },
    );
  }
  const served = await serve(`${resource}|${endpoint}`, () =>
    load(resource as PublicResource, endpoint),
  );
  return reply(served.status, served.body, served.source);
}
