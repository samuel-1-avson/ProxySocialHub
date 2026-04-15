
'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import bs58 from 'bs58';

// Browser auth calls should stay same-origin and flow through the Next.js
// /v1 rewrite layer. That keeps Docker/internal backend origins out of the
// client bundle and avoids direct browser calls to localhost-style API hosts.
const API_BASE_URL = '';
const ACCESS_TOKEN_STORAGE_KEY = 'proxyhubb_token';
const REFRESH_TOKEN_STORAGE_KEY = 'proxyhubb_refresh_token';
const ACCESS_TOKEN_REFRESH_LEEWAY_MS = 60_000;

let refreshPromise: Promise<string | null> | null = null;

function apiUrl(path: string): string {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

type AuthRefreshResponse = {
  token?: string;
  refresh_token?: string;
  error?: string;
};

async function parseJsonResponse<T>(response: Response, context: string): Promise<T> {
  const contentType = response.headers.get('content-type') || '';
  const raw = await response.text();

  if (!contentType.toLowerCase().includes('application/json')) {
    const snippet = raw.slice(0, 140).replace(/\s+/g, ' ').trim();
    throw new Error(`${context} returned non-JSON response (status ${response.status}). ${snippet || 'Empty response body.'}`);
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${context} returned invalid JSON (status ${response.status}).`);
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getTokenExpiryMs(token: string): number | null {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') {
    return null;
  }

  return payload.exp * 1000;
}

function isTokenExpired(token: string, leewayMs = 0): boolean {
  const expiryMs = getTokenExpiryMs(token);
  if (!expiryMs) {
    return false;
  }

  return Date.now() >= expiryMs - leewayMs;
}

function writeCookie(name: string, value: string, maxAgeSeconds: number) {
  if (typeof window === 'undefined') {
    return;
  }

  const secure = window.location.protocol === 'https:' ? '; secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${Math.max(0, maxAgeSeconds)}; samesite=lax${secure}`;
}

function clearCookie(name: string) {
  if (typeof window === 'undefined') {
    return;
  }

  const secure = window.location.protocol === 'https:' ? '; secure' : '';
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax${secure}`;
}

function syncAccessTokenCookie(token: string) {
  const expiryMs = getTokenExpiryMs(token);
  const maxAgeSeconds = expiryMs
    ? Math.floor(Math.max(0, expiryMs - Date.now()) / 1000)
    : 24 * 60 * 60;

  writeCookie(ACCESS_TOKEN_STORAGE_KEY, token, maxAgeSeconds);
}

function persistAuthTokens(token: string, refreshToken?: string) {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
  syncAccessTokenCookie(token);

  if (refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, refreshToken);
    writeCookie(REFRESH_TOKEN_STORAGE_KEY, refreshToken, 30 * 24 * 60 * 60);
  }
}

function clearStoredAuth() {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  clearCookie(ACCESS_TOKEN_STORAGE_KEY);
  clearCookie(REFRESH_TOKEN_STORAGE_KEY);
}

async function refreshAccessToken(force = false): Promise<string | null> {
  if (typeof window === 'undefined') {
    return null;
  }

  const existingToken = localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
  if (!force && existingToken && !isTokenExpired(existingToken, ACCESS_TOKEN_REFRESH_LEEWAY_MS)) {
    syncAccessTokenCookie(existingToken);
    return existingToken;
  }

  const refreshToken = localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
  if (!refreshToken) {
    if (existingToken && !isTokenExpired(existingToken)) {
      syncAccessTokenCookie(existingToken);
      return existingToken;
    }

    clearStoredAuth();
    return null;
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const response = await fetch(apiUrl('/v1/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
        credentials: 'include',
      });

      const data = await parseJsonResponse<AuthRefreshResponse>(response, 'Token refresh');
      if (!response.ok || !data.token) {
        clearStoredAuth();
        return null;
      }

      persistAuthTokens(data.token, data.refresh_token ?? refreshToken);
      return data.token;
    } catch (error) {
      console.error('Token refresh error:', error);
      clearStoredAuth();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// ---------- User type (no longer depends on Supabase User) ----------

export interface WalletUser {
  id: string;
  email?: string;
  role: string;
  username?: string;
  avatar_url?: string;
  wallet_address?: string;
  trust_tier?: string;
  verified?: boolean;
  display_name?: string;
  created_at?: string;
}

// ---------- Auth Context ----------

export interface AuthContextType {
  user: WalletUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  walletLogin: (address: string, signer: any) => Promise<void>;
  logout: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<WalletUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  // On mount, check for existing JWT token and validate it
  useEffect(() => {
    const checkUser = async () => {
      try {
        if (typeof window !== 'undefined') {
          const token = await refreshAccessToken();
          if (token) {
            const res = await fetch(apiUrl('/v1/auth/me'), {
              headers: {
                'Authorization': `Bearer ${token}`
              },
              credentials: 'include',
            });

            if (res.ok) {
              const apiUser = await parseJsonResponse<any>(res, 'Auth session check');
              setUser({
                id: apiUser.id,
                email: apiUser.email,
                role: apiUser.role,
                username: apiUser.username,
                avatar_url: apiUser.avatar_url,
                wallet_address: apiUser.wallet_address,
                trust_tier: apiUser.trust_tier,
                verified: apiUser.verified,
                display_name: apiUser.display_name,
                created_at: apiUser.created_at,
              });
            } else {
              clearStoredAuth();
            }
          }
        }
      } catch (error) {
        console.error('Error checking auth session:', error);
        clearStoredAuth();
      } finally {
        setIsLoading(false);
      }
    };

    checkUser();
  }, []);

  const walletLogin = async (address: string, signer: any) => {
    try {
      // 1. Get Challenge
      const challengeRes = await fetch(apiUrl('/v1/auth/wallet/challenge'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
        credentials: 'include',
      });

      const challengeData = await parseJsonResponse<{ message?: string; error?: string }>(challengeRes, 'Wallet challenge');
      if (!challengeRes.ok) {
        throw new Error(challengeData.error || 'Failed to get auth challenge');
      }
      const { message } = challengeData;
      if (!message) {
        throw new Error('Wallet challenge response missing message');
      }

      // 2. Sign Message
      let signature = '';

      // Solana Wallet (Phantom / Solflare / Adapter)
      if (signer && signer.signMessage) {
        const encodedMessage = new TextEncoder().encode(message);
        const signatureBytes = await signer.signMessage(encodedMessage);
        signature = bs58.encode(signatureBytes);
      } else {
        throw new Error('Wallet does not support message signing. Please use a Solana-compatible wallet.');
      }

      // 3. Login
      const loginRes = await fetch(apiUrl('/v1/auth/wallet/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          signature,
          nonce: message // Full message as expected by backend
        }),
        credentials: 'include',
      });

      const loginData = await parseJsonResponse<{ token?: string; refresh_token?: string; user?: any; error?: string }>(loginRes, 'Wallet login');
      if (!loginRes.ok) {
        throw new Error(loginData.error || 'Login failed');
      }

      const { token, refresh_token: refreshToken, user: apiUser } = loginData;
      if (!token || !apiUser) {
        throw new Error('Wallet login response missing token or user payload');
      }

      // 4. Store Token
      persistAuthTokens(token, refreshToken);

      // 5. Update State
      setUser({
        id: apiUser.id,
        email: apiUser.email,
        role: apiUser.role,
        username: apiUser.username,
        avatar_url: apiUser.avatar_url,
        wallet_address: apiUser.wallet_address,
        trust_tier: apiUser.trust_tier,
        verified: apiUser.verified,
        display_name: apiUser.display_name,
        created_at: apiUser.created_at,
      });
    } catch (err) {
      console.error("Wallet login error:", err);
      throw err;
    }
  };

  const logout = async () => {
    clearStoredAuth();
    setUser(null);
    router.push('/login');
  };

  const getAccessToken = async () => {
    return refreshAccessToken();
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated: !!user, walletLogin, logout, getAccessToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Simple check for authentication status (synchronous)
export function isAuthenticated(): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
}

// Helper to make authenticated API calls
export async function fetchWithAuth(url: string, options: RequestInit = {}) {
  let token = await refreshAccessToken();

  if (!token) {
    throw new Error('Not authenticated');
  }

  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${token}`,
  };

  let response = await fetch(url, { ...options, headers, credentials: options.credentials ?? 'include' });
  if (response.status === 401) {
    const refreshedToken = await refreshAccessToken(true);
    if (!refreshedToken) {
      throw new Error('Not authenticated');
    }

    response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${refreshedToken}`,
      },
      credentials: options.credentials ?? 'include',
    });
  }

  return response;
}
