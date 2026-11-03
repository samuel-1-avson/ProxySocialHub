/**
 * Session assistant (agent concierge): the browser side of POST /api/concierge/draft.
 * The route only drafts; the session is created by createSessionIntent after the buyer approves.
 */

import type { CheckedPlan, MarketListing } from "../concierge-plan";
import { authApiFetch, ApiError } from "./client";

export interface ConciergeDraftResponse {
  plan: CheckedPlan;
  /** The model's draft as returned; the card edits a copy and re-checks it locally. */
  draft: Record<string, unknown>;
  /** The active listings the plan was checked against. */
  market: MarketListing[];
  model: { id: string; dataMode: "standard" | "contributor" };
}

export async function draftSession(request: string): Promise<ConciergeDraftResponse> {
  const res = await authApiFetch("/api/concierge/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request }),
  });
  const body = (await res.json().catch(() => null)) as (ConciergeDraftResponse & { error?: { code?: string; message?: string } }) | null;
  if (!res.ok || !body) {
    throw new ApiError(res.status, body?.error?.message ?? "The session assistant could not draft a plan.", body?.error?.code);
  }
  return body;
}
