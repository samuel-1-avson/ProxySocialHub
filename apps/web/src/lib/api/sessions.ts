/**
 * Sessions API Module
 * All session-related API calls and types
 */

import { apiGet, apiPost, apiDelete } from "./client";

// ============ Types ============

export interface Session {
  id: string;
  user_id: string;
  type: "rotating" | "sticky" | "universal";
  status:
    | "active"
    | "disabled"
    | "activation_pending"
    | "activation_failed"
    | "terminated"
    | "expired";
  node_id?: string;
  listing_id?: string;
  credentials_user: string;
  credentials_pass: string;
  proxy_endpoint?: string;
  bytes_used: number;
  bytes_limit: number;
  tx_hash?: string;
  session_pda?: string;
  amount_locked_sol?: number;
  created_at: string;
  expires_at?: string;
  terminated_at?: string;
  listing?: {
    id: string;
    price_per_gb?: number;
    price_per_hour?: number;
  };
  escrow_address?: string;
}

export interface ProxyCredentials {
  username: string;
  password: string;
  endpoint: string;
  port: number;
  protocol: "http" | "socks5";
}

export interface CreateSessionRequest {
  type: "rotating" | "sticky";
  node_id?: string;
  duration_hours?: number;
  bandwidth_gb?: number;
  preferred_tier?: string;
}

export interface CreateSessionIntentRequest {
  type: "rotating" | "sticky";
  listing_id?: string;
  bandwidth_limit?: number;
  target_geo?: string;
  target_isp?: string;
  routing_profile?: string;
  allowed_domains?: string[];
  blocked_domains?: string[];
  rotation_type?: string;
  rotation_interval_seconds?: number;
  time_limit_minutes?: number;
  preferred_tier?: string;
  max_price_per_gb?: number;
}

export interface CreateSessionResponse {
  session: Session;
  proxy_credentials: ProxyCredentials;
}

export interface SessionIntent {
  intent_id: string;
  user_id: string;
  listing_id?: string;
  session_type: "rotating" | "sticky";
  trust_tier: string;
  bandwidth_limit: number;
  target_geo?: string;
  target_isp?: string;
  routing_profile?: string;
  allowed_domains: string[];
  blocked_domains: string[];
  rotation_type?: string;
  rotation_interval_seconds?: number;
  time_limit_minutes?: number;
  preferred_tier?: string;
  requests_per_minute: number;
  max_concurrency: number;
  max_price_per_gb?: number;
  billing_price_per_gb?: number;
  billing_price_per_gb_sol?: number;
  billing_price_source?: string;
  provider_node_id?: string;
  target_host?: string;
  total_bytes_up?: number;
  total_bytes_down?: number;
  last_bytes_up_delta?: number;
  last_bytes_down_delta?: number;
  usage_update_count?: number;
}

export interface SessionIntentUsageSnapshot {
  total_bytes: number;
  total_bytes_up: number;
  total_bytes_down: number;
  last_bytes_up_delta: number;
  last_bytes_down_delta: number;
  total_gb: number;
  percent_used: number;
  bytes_remaining: number;
  unlimited: boolean;
}

export interface SessionIntentBillingSnapshot {
  currency: "SOL";
  price_source: string;
  unit_price_per_gb: number;
  unit_price_sol_per_gb: number;
  estimated_cost: number;
  estimated_cost_sol: number;
  projected_full_limit_cost: number;
  projected_full_limit_cost_sol: number;
}

export type SessionIntentLifecycle =
  | "authorized"
  | "routed"
  | "active"
  | "closing"
  | "ledger_committed"
  | "batched"
  | "chain_committed"
  | "archived"
  | "expired";

export interface CreateSessionIntentResponse {
  token: string;
  expires_at: string;
  lifecycle_state: SessionIntentLifecycle;
  intent: SessionIntent;
}

export interface SessionIntentStatusResponse {
  lifecycle_state: SessionIntentLifecycle;
  expires_at: string;
  created_at: string;
  updated_at: string;
  routed_at?: string;
  activated_at?: string;
  closing_at?: string;
  ledger_committed_at?: string;
  batched_at?: string;
  chain_committed_at?: string;
  archived_at?: string;
  expired_at?: string;
  last_seen_at?: string;
  last_metered_at?: string;
  usage_snapshot: SessionIntentUsageSnapshot;
  billing_snapshot: SessionIntentBillingSnapshot;
  intent: SessionIntent;
}

export interface UsageStats {
  session_id: string;
  bytes_used: number;
  bytes_limit: number;
  percent_used: number;
  gb_used: number;
  cost_sol: number;
}

// ============ API Functions ============

/**
 * Get all user sessions
 */
export async function getSessions(
  status: "active" | "all" | unknown = "active",
) {
  const query = status === "all" ? "?status=all" : "";
  const data = await apiGet<{
    sessions: (
      | Session
      | { session: Session; bandwidth_used?: number; bandwidth_limit?: number }
    )[];
  }>(`/v1/sessions${query}`);
  if (data && Array.isArray(data.sessions)) {
    return data.sessions.map((item) => {
      const session = "session" in item ? { ...item.session } : { ...item };
      const liveBytes = Number(
        ("session" in item ? item.bandwidth_used : undefined) ??
          session.bytes_used ??
          0,
      );
      if (liveBytes > (session.bytes_used || 0)) {
        session.bytes_used = liveBytes;
      }
      if (
        "session" in item &&
        item.bandwidth_limit != null &&
        Number(item.bandwidth_limit) > 0
      ) {
        session.bytes_limit = Number(item.bandwidth_limit);
      }
      return session;
    });
  }
  return [] as Session[];
}

/**
 * Get a specific session
 */
export async function getSession(id: string) {
  const data = await apiGet<
    | Session
    | { session: Session; bandwidth_used?: number; bandwidth_limit?: number }
  >(`/v1/sessions/${encodeURIComponent(id)}`);
  const session = "session" in data ? { ...data.session } : { ...data };
  if ("session" in data) {
    const live = Number(data.bandwidth_used);
    if (Number.isFinite(live) && live > (session.bytes_used || 0))
      session.bytes_used = live;
    const limit = Number(data.bandwidth_limit);
    if (Number.isFinite(limit) && limit > 0) session.bytes_limit = limit;
  }
  return session;
}

/**
 * @deprecated Public direct session creation is disabled. Use createSessionIntent
 * for short-lived gateway access or marketplace order APIs for paid sessions.
 */
export function createSession(data: CreateSessionRequest) {
  return apiPost<CreateSessionResponse>("/v1/sessions", data);
}

/**
 * Issue a short-lived V2 session intent token for gateway admission.
 */
export function createSessionIntent(data: CreateSessionIntentRequest) {
  return apiPost<CreateSessionIntentResponse>("/v1/sessions/intent", data);
}

/**
 * Re-issue JWT for an authorized/expired intent (same intent_id / jti).
 */
export function remintSessionIntent(id: string) {
  return apiPost<CreateSessionIntentResponse & { reminted?: boolean }>(
    `/v1/sessions/intents/${id}/remint`,
    {},
  );
}

export function getSessionIntentStatus(id: string) {
  return apiGet<SessionIntentStatusResponse>(`/v1/sessions/intents/${id}`);
}

export async function listSessionIntents() {
  const data = await apiGet<{ intents: SessionIntentStatusResponse[] }>(
    "/v1/sessions/intents",
  );
  return Array.isArray(data?.intents) ? data.intents : [];
}

/**
 * Terminate a session
 */
export function terminateSession(id: string) {
  return apiDelete(`/v1/sessions/${id}`);
}

// ============ Query Keys ============

export const sessionKeys = {
  all: ["sessions"] as const,
  lists: () => [...sessionKeys.all, "list"] as const,
  detail: (id: string) => [...sessionKeys.all, "detail", id] as const,
  intents: () => [...sessionKeys.all, "intents"] as const,
  intentDetail: (id: string) => [...sessionKeys.all, "intent", id] as const,
  usage: (id: string) => [...sessionKeys.all, "usage", id] as const,
  totalUsage: () => [...sessionKeys.all, "totalUsage"] as const,
};
