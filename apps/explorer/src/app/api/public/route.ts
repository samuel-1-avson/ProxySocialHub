import { NextRequest, NextResponse } from "next/server";
import {
  projectPublicData,
  publicResources,
  publicResourcePath,
  type PublicResource,
} from "../../../lib/public-data";
export const dynamic = "force-dynamic";
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
    if (!response.ok)
      return NextResponse.json(
        {
          error:
            response.status === 404
              ? "This public record was not found."
              : `The public source returned ${response.status}. Try again when it is available.`,
        },
        { status: response.status === 404 ? 404 : 502 },
      );
    const data = projectPublicData(
      resource as PublicResource,
      await response.json(),
    );
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Network data is temporarily unavailable. Try again shortly." },
      { status: 503 },
    );
  }
}
