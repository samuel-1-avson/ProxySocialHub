// Use relative /api/* path — Next.js rewrites proxy this server-side to the backend.
// This avoids CORS entirely since the browser only talks to localhost:3002.
const API_BASE = "/api";
const TOKEN_KEY = "proxyhubb_admin_token";
const ADMIN_KEY = "proxyhubb_admin_identity";

export interface AdminIdentity {
  username: string;
  role: "superadmin" | "sysops" | "support";
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getIdentity(): AdminIdentity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ADMIN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  const token = getToken();
  if (!token) return false;
  // Decode payload to check expiry (JWT is base64url encoded)
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export async function login(username: string, password: string): Promise<AdminIdentity> {
  const res = await fetch(`${API_BASE}/v1/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Invalid credentials");
  }

  const data = await res.json();
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(ADMIN_KEY, JSON.stringify(data.admin));
  return data.admin as AdminIdentity;
}

export async function logout(): Promise<void> {
  const token = getToken();
  if (token) {
    // Best-effort server logout (stateless JWT — mainly for audit log)
    await fetch(`${API_BASE}/v1/admin/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ADMIN_KEY);
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
