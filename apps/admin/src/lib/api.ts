import { authHeaders } from "./auth";

// All requests go through the Next.js rewrite proxy (/api/* → backend).
// This avoids CORS — the browser only ever talks to localhost:3002.
const API_BASE = "/api";
const ADMIN_BASE = `${API_BASE}/v1/admin`;

async function adminFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${ADMIN_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  if (res.status === 401) {
    // Token expired — redirect to login
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new Error("Session expired");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export const getDashboardStats = () => adminFetch<DashboardStats>("/stats/dashboard");
export const getSystemStats = () => adminFetch<SystemStats>("/stats");
export const getSystemHealth = () => adminFetch<SystemHealth>("/system/health");
export const getSystemAlerts = () => adminFetch<SystemAlerts>("/system/alerts");

// ── Users ─────────────────────────────────────────────────────────────────────

export const listUsers = (params?: {
  page?: number;
  per_page?: number;
  role?: string;
  status?: string;
  search?: string;
}) => {
  const q = new URLSearchParams();
  if (params?.page) q.set("page", String(params.page));
  if (params?.per_page) q.set("per_page", String(params.per_page));
  if (params?.role) q.set("role", params.role);
  if (params?.status) q.set("status", params.status);
  if (params?.search) q.set("search", params.search);
  return adminFetch<UserList>(`/users?${q}`);
};

export const getUser = (id: string) => adminFetch<UserDetail>(`/users/${id}`);
export const banUser = (id: string) => adminFetch(`/users/${id}/ban`, { method: "POST" });
export const unbanUser = (id: string) => adminFetch(`/users/${id}/unban`, { method: "POST" });
export const suspendUser = (id: string) => adminFetch(`/users/${id}/suspend`, { method: "POST" });
export const activateUser = (id: string) => adminFetch(`/users/${id}/activate`, { method: "POST" });
export const updateUserTier = (id: string, tier: string) =>
  adminFetch(`/users/${id}/tier`, { method: "PUT", body: JSON.stringify({ tier }) });
export const forceLogout = (id: string) => adminFetch(`/users/${id}/force-logout`, { method: "POST" });

// Admin notes
export const getUserNotes = (id: string) => adminFetch<{ notes: AdminNote[] }>(`/users/${id}/notes`);
export const addUserNote = (id: string, content: string) =>
  adminFetch(`/users/${id}/notes`, { method: "POST", body: JSON.stringify({ content }) });
export const deleteUserNote = (userId: string, noteId: string) =>
  adminFetch(`/users/${userId}/notes/${noteId}`, { method: "DELETE" });

// ── Sessions ──────────────────────────────────────────────────────────────────

export const getActiveSessions = () =>
  fetch(`${API_BASE}/v1/sessions`, {
    headers: { ...authHeaders(), "Content-Type": "application/json" },
  }).then((r) => r.json());

// ── Nodes ─────────────────────────────────────────────────────────────────────

export const listNodes = () => adminFetch<NodeList>("/nodes");
export const getNodeStats = () => adminFetch<NodeStats>("/nodes/stats");

// ── Proxy Pools ───────────────────────────────────────────────────────────────

export const listProxyPools = () => adminFetch<PoolList>("/proxies/pools");
export const disablePool = (id: string) =>
  adminFetch(`/proxies/pools/${id}/disable`, { method: "PUT" });

// ── Treasury ──────────────────────────────────────────────────────────────────

export const getTreasuryOverview = () => adminFetch<TreasuryOverview>("/treasury/overview");
export const getPendingPayouts = () => adminFetch<PayoutList>("/payouts/pending");
export const getPayoutHistory = (page = 1) => adminFetch<PayoutHistory>(`/payouts/history?page=${page}`);
export const processPayout = (id: string, phone: string, amount: number) =>
  adminFetch(`/payouts/${id}/process`, { method: "POST", body: JSON.stringify({ phone, amount }) });

// ── Blockchain ────────────────────────────────────────────────────────────────

export const getExplorerTransactions = (params?: { page?: number; type?: string }) => {
  const q = new URLSearchParams();
  if (params?.page) q.set("page", String(params.page));
  if (params?.type) q.set("type", params.type);
  return fetch(`${API_BASE}/v1/explorer/transactions?${q}`, {
    headers: { ...authHeaders() },
  }).then((r) => r.json());
};

// ── Audit Logs ────────────────────────────────────────────────────────────────

export const getAuditLogs = (params?: {
  page?: number;
  action?: string;
  entity?: string;
  actor_id?: string;
}) => {
  const q = new URLSearchParams();
  if (params?.page) q.set("page", String(params.page));
  if (params?.action) q.set("action", params.action);
  if (params?.entity) q.set("entity", params.entity);
  if (params?.actor_id) q.set("actor_id", params.actor_id);
  return adminFetch<AuditLogList>(`/audit-logs?${q}`);
};

// ── Feature Flags & Config ────────────────────────────────────────────────────

export const getFeatureFlags = () => adminFetch<FlagList>("/feature-flags");
export const updateFeatureFlag = (key: string, enabled: boolean) =>
  adminFetch(`/feature-flags/${key}`, { method: "PUT", body: JSON.stringify({ enabled }) });
export const getSystemConfig = () => adminFetch<ConfigList>("/config");
export const updateSystemConfig = (key: string, value: string) =>
  adminFetch(`/config/${key}`, { method: "PUT", body: JSON.stringify({ value }) });

// ── Disputes ──────────────────────────────────────────────────────────────────

export const listDisputes = () => adminFetch<DisputeList>("/disputes");
export const forceResolveDispute = (id: string, resolution: string, reason: string) =>
  adminFetch(`/disputes/${id}/force-resolve`, {
    method: "POST",
    body: JSON.stringify({ resolution, reason }),
  });

// ── Governance ────────────────────────────────────────────────────────────────

export const listProposals = () => adminFetch<ProposalList>("/governance/proposals");
export const cancelProposal = (id: string) =>
  adminFetch(`/governance/proposals/${id}/cancel`, { method: "POST" });

// ── Pricing ───────────────────────────────────────────────────────────────────

export const triggerPricingAdjustment = () =>
  adminFetch("/pricing/adjust", { method: "POST" });

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DashboardStats {
  total_users: number;
  new_users_today: number;
  new_users_week: number;
  active_users: number;
  suspended_users: number;
  active_sessions: number;
  sessions_today: number;
  online_nodes: number;
  total_nodes: number;
  healthy_percent: number;
  today_revenue_ghs: number;
  week_revenue_ghs: number;
  month_revenue_ghs: number;
  pending_kyc: number;
}

export interface SystemStats {
  total_users: number;
  total_providers: number;
  total_buyers: number;
  total_sessions: number;
  active_sessions: number;
  total_nodes: number;
  online_nodes: number;
  total_revenue_ghs: number;
}

export interface ServiceHealth {
  name: string;
  status: "ok" | "degraded" | "down";
  message?: string;
  checked_at: string;
}

export interface SystemHealth {
  overall: "ok" | "degraded" | "down";
  services: ServiceHealth[];
  time: string;
}

export interface SystemAlerts {
  anomalies: SecurityAnomaly[];
  active_lockouts: AccountLockout[];
  count: { anomalies: number; lockouts: number };
}

export interface SecurityAnomaly {
  id: string;
  user_id: string;
  type: string;
  description: string;
  severity: string;
  created_at: string;
}

export interface AccountLockout {
  id: string;
  user_id: string;
  reason: string;
  locked_until: string;
}

export interface AdminUser {
  id: string;
  email: string;
  role: string;
  status: string;
  trust_tier: string;
  created_at: string;
  username?: string;
}

export interface UserList {
  users: AdminUser[];
  total_count: number;
  page: number;
  per_page: number;
}

export interface UserDetail {
  user: AdminUser;
  session_count: number;
  kyc_status: string;
}

export interface AdminNote {
  id: string;
  user_id: string;
  admin_username: string;
  content: string;
  created_at: string;
}

export interface NodeList {
  nodes: ProxyNode[];
  count: number;
}

export interface NodeStats {
  total_nodes: number;
  online_nodes: number;
  offline_nodes: number;
  total_bandwidth_gb: number;
  avg_latency_ms: number;
  avg_success_rate: number;
}

export interface ProxyNode {
  id: string;
  ip_address: string;
  country_code: string;
  region: string;
  is_healthy: boolean;
  active_connections: number;
  max_connections: number;
  latency_ms: number;
  uptime_percent: number;
  last_seen: string;
}

export interface PoolList {
  pools: ProxyPool[];
  count: number;
}

export interface ProxyPool {
  id: string;
  name: string;
  is_active: boolean;
  max_sessions: number;
  created_at: string;
}

export interface TreasuryOverview {
  revenue: {
    total: number;
    today: number;
    this_week: number;
    this_month: number;
  };
  payouts: {
    pending_total_sol: number;
    processed_total: number;
  };
  escrows: {
    active_count: number;
  };
}

export interface PendingPayout {
  user_id: string;
  email: string;
  role: string;
  earnings_ghs: number;
}

export interface PayoutList {
  payouts: PendingPayout[];
  count: number;
}

export interface PayoutHistory {
  payouts: LedgerEntry[];
  count: number;
  page: number;
}

export interface LedgerEntry {
  id: string;
  wallet_id: string;
  type: string;
  amount: number;
  description: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  actor_id: string;
  actor_email: string;
  action: string;
  entity_type: string;
  entity_id: string;
  ip_address: string;
  created_at: string;
}

export interface AuditLogList {
  audit_logs: AuditLog[];
  total_count: number;
  page: number;
  per_page: number;
}

export interface FlagList {
  flags: SystemConfig[];
  count: number;
}

export interface ConfigList {
  config: SystemConfig[];
  count: number;
}

export interface SystemConfig {
  id: string;
  key: string;
  value: string;
  updated_at: string;
}

export interface DisputeJury {
  id: string;
  session_id: string;
  status: string;
  verdict?: string;
  created_at: string;
}

export interface DisputeList {
  disputes: DisputeJury[];
  count: number;
}

export interface Proposal {
  id: string;
  title: string;
  description: string;
  status: string;
  yes_votes: number;
  no_votes: number;
  created_at: string;
}

export interface ProposalList {
  proposals: Proposal[];
  count: number;
}
