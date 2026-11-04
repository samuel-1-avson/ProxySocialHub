
'use client';

import { createContext, useCallback, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import bs58 from 'bs58';
import { MfaChallengeDialog } from '@/components/auth/MfaChallengeDialog';
import { captureReferralCodeFromSearch, clearReferralCode, peekReferralCode } from '@/lib/referral';
import { decodeJwtPayload, isTokenRoleStale } from '@/lib/auth-token-role';

// Browser auth calls should stay same-origin and flow through the Next.js
// /v1 rewrite layer. That keeps Docker/internal backend origins out of the
// client bundle and avoids direct browser calls to localhost-style API hosts.
const API_BASE_URL = '';
const ACCESS_TOKEN_STORAGE_KEY = 'proxyhubb_token';
const REFRESH_TOKEN_STORAGE_KEY = 'proxyhubb_refresh_token';
const LEGACY_ACCESS_TOKEN_STORAGE_KEY = 'token';
const ACCESS_TOKEN_REFRESH_LEEWAY_MS = 60_000;

let refreshPromise: Promise<string | null> | null = null;
let accessTokenCache: string | null = null;

function apiUrl(path: string): string {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

type AuthLoginResponse = { token?: string; refresh_token?: string; user?: Record<string, unknown>; error?: string; mfa_required?: boolean; challenge_token?: string };

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

function clearCookie(name: string) {
  if (typeof window === 'undefined') {
    return;
  }

  const secure = window.location.protocol === 'https:' ? '; secure' : '';
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax${secure}`;
}

function readCookie(name: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const prefix = `${name}=`;
  const cookie = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));

  if (!cookie) {
    return null;
  }

  return decodeURIComponent(cookie.slice(prefix.length));
}

function hasSessionMarker(): boolean {
  return readCookie('proxyhubb_session') === '1' || hasCookie(REFRESH_TOKEN_STORAGE_KEY);
}

function hasCookie(name: string): boolean {
  return readCookie(name) !== null;
}

function removeLegacyLocalStorageAuth() {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  localStorage.removeItem(LEGACY_ACCESS_TOKEN_STORAGE_KEY);
  localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  sessionStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
}

function rememberAccessToken(token: string) {
  // Memory-only access token — never write secrets to document.cookie / sessionStorage.
  accessTokenCache = token;
  if (typeof window !== 'undefined') {
    localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    localStorage.removeItem(LEGACY_ACCESS_TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  }
}

function migrateLegacyAccessToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const legacyToken =
    sessionStorage.getItem(ACCESS_TOKEN_STORAGE_KEY) ||
    localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY) ||
    localStorage.getItem(LEGACY_ACCESS_TOKEN_STORAGE_KEY);
  if (!legacyToken) {
    return null;
  }

  rememberAccessToken(legacyToken);
  return legacyToken;
}

function migrateLegacyRefreshToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  // One-time migration: send body refresh once, then rely on HttpOnly Set-Cookie.
  const legacyRefreshToken = localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY) || readCookie(REFRESH_TOKEN_STORAGE_KEY);
  if (!legacyRefreshToken) {
    return null;
  }

  localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  // Clear any legacy non-HttpOnly refresh cookie written by older clients.
  clearCookie(REFRESH_TOKEN_STORAGE_KEY);
  return legacyRefreshToken;
}

export function getStoredAccessTokenSync(): string | null {
  if (accessTokenCache) {
    return accessTokenCache;
  }

  if (typeof window === 'undefined') {
    return null;
  }

  return migrateLegacyAccessToken();
}

export async function getAccessTokenSilently(): Promise<string | null> {
  return refreshAccessToken();
}

function persistAuthTokens(token: string, _refreshToken?: string) {
  if (typeof window === 'undefined') {
    accessTokenCache = token;
    return;
  }

  rememberAccessToken(token);
  // Refresh token is stored as HttpOnly by the API Set-Cookie; do not mirror in JS.
  localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
}

function clearStoredAuth() {
  if (typeof window === 'undefined') {
    accessTokenCache = null;
    return;
  }

  accessTokenCache = null;
  removeLegacyLocalStorageAuth();
  clearCookie(ACCESS_TOKEN_STORAGE_KEY);
  clearCookie(REFRESH_TOKEN_STORAGE_KEY);
  clearCookie('proxyhubb_session');
}

async function refreshAccessToken(force = false): Promise<string | null> {
  if (typeof window === 'undefined') {
    return null;
  }

  const existingToken = getStoredAccessTokenSync();
  if (!force && existingToken && !isTokenExpired(existingToken, ACCESS_TOKEN_REFRESH_LEEWAY_MS)) {
    rememberAccessToken(existingToken);
    return existingToken;
  }

  const migratedRefreshToken = migrateLegacyRefreshToken();
  // HttpOnly refresh cookie is invisible to JS; try refresh whenever a session marker
  // exists, a legacy token was migrated, or we simply have no valid access token.
  const shouldAttemptRefresh =
    !!migratedRefreshToken || hasSessionMarker() || !existingToken || isTokenExpired(existingToken);

  if (!shouldAttemptRefresh) {
    if (existingToken && !isTokenExpired(existingToken)) {
      rememberAccessToken(existingToken);
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
      const requestInit: RequestInit = {
        method: 'POST',
        credentials: 'include',
      };

      if (migratedRefreshToken) {
        requestInit.headers = { 'Content-Type': 'application/json' };
        requestInit.body = JSON.stringify({ refresh_token: migratedRefreshToken });
      }

      const response = await fetch(apiUrl('/v1/auth/refresh'), requestInit);

      const data = await parseJsonResponse<AuthRefreshResponse>(response, 'Token refresh');
      if (!response.ok || !data.token) {
        clearStoredAuth();
        return null;
      }

      persistAuthTokens(data.token, data.refresh_token);
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
  /** Set when ProxyHubb created and holds this user's wallet (Google sign-up). */
  managed_wallet?: { address: string; chain: string };
}

function mapApiUser(apiUser: any): WalletUser {
  return {
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
    managed_wallet: apiUser.managed_wallet,
  };
}

// ---------- Auth Context ----------

export interface AuthContextType {
  user: WalletUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  walletLogin: (address: string, signer: any) => Promise<void>;
  /** Sign in with a Google Identity Services ID token (credential). */
  googleLogin: (credential: string) => Promise<void>;
  logout: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  refreshUser: () => Promise<WalletUser | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<WalletUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null);
  const mfaPending = useRef<{ resolve: (value: AuthLoginResponse) => void; reject: (error: Error) => void } | null>(null);
  const resolveLogin = async (data: AuthLoginResponse): Promise<AuthLoginResponse> => {
    if (!data.mfa_required) return data;
    if (!data.challenge_token) throw new Error("Verification request missing");
    mfaPending.current?.reject(new Error("Sign-in restarted"));
    setMfaChallenge(data.challenge_token);
    return new Promise<AuthLoginResponse>((resolve, reject) => { mfaPending.current = { resolve, reject }; });
  };
  const cancelMFA = () => { mfaPending.current?.reject(new Error("Sign-in cancelled")); mfaPending.current = null; setMfaChallenge(null); };
  const verifyMFA = async (code: string) => {
    const response = await fetch(apiUrl("/v1/auth/mfa/verify"), { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challenge_token: mfaChallenge, code }) });
    const data = await parseJsonResponse<AuthLoginResponse>(response, "Sign-in verification");
    if (!response.ok || !data.token) throw new Error(data.error || "Verification failed");
    const pending = mfaPending.current; mfaPending.current = null; setMfaChallenge(null); pending?.resolve(data);
  };
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    captureReferralCodeFromSearch();
  }, []);

  // Cached queries (wallet, orders, history) are not keyed by user. When the signed-in
  // account changes, drop everything so one account never sees another's data.
  const lastUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    const current = user?.id ?? null;
    const previous = lastUserIdRef.current;
    lastUserIdRef.current = current;
    if (!previous || previous === current) return;
    if (current) {
      void queryClient.resetQueries();
    } else {
      queryClient.clear();
    }
  }, [user?.id, queryClient]);

  const refreshUser = useCallback(async (): Promise<WalletUser | null> => {
    try {
      if (typeof window === 'undefined') {
        return null;
      }

      const token = await refreshAccessToken();
      if (!token) {
        setUser(null);
        return null;
      }

      const res = await fetch(apiUrl('/v1/auth/me'), {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include',
      });

      if (!res.ok) {
        clearStoredAuth();
        setUser(null);
        return null;
      }

      const apiUser = await parseJsonResponse<any>(res, 'Auth session check');
      // The role changed since this token was issued (e.g. the provider application was just
      // approved). Reissue it now: the page guard reads the role from the token cookie and
      // would otherwise send the new provider to /403 until the token expired.
      if (isTokenRoleStale(token, apiUser?.role)) {
        await refreshAccessToken(true);
      }
      const nextUser = mapApiUser(apiUser);
      setUser(nextUser);
      return nextUser;
    } catch (error) {
      console.error('Error refreshing auth session:', error);
      clearStoredAuth();
      setUser(null);
      return null;
    }
  }, []);

  // On mount, check for existing JWT token and validate it
  useEffect(() => {
    const checkUser = async () => {
      try {
        await refreshUser();
      } catch (error) {
        console.error('Error checking auth session:', error);
        clearStoredAuth();
      } finally {
        setIsLoading(false);
      }
    };

    void checkUser();
  }, [refreshUser]);

  const walletLogin = async (address: string, signer: any) => {
    try {
      captureReferralCodeFromSearch();
      const referralCode = peekReferralCode();

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

      // 3. Login (optional referral_code attributed only for brand-new users server-side)
      const loginRes = await fetch(apiUrl('/v1/auth/wallet/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          signature,
          nonce: message, // Full message as expected by backend
          ...(referralCode ? { referral_code: referralCode } : {}),
        }),
        credentials: 'include',
      });

      let loginData = await parseJsonResponse<AuthLoginResponse>(loginRes, 'Wallet login');
      if (!loginRes.ok) {
        throw new Error(loginData.error || 'Login failed');
      }

      loginData = await resolveLogin(loginData);
      const { token, refresh_token: refreshToken, user: apiUser } = loginData;
      if (!token || !apiUser) {
        throw new Error('Wallet login response missing token or user payload');
      }

      // 4. Store Token
      persistAuthTokens(token, refreshToken);
      clearReferralCode();

      // 5. Update State
      setUser(mapApiUser(apiUser));
    } catch (err) {
      console.error("Wallet login error:", err);
      throw err;
    }
  };

  const googleLogin = async (credential: string) => {
    try {
      captureReferralCodeFromSearch();
      const referralCode = peekReferralCode();

      const loginRes = await fetch(apiUrl('/v1/auth/google'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential,
          ...(referralCode ? { referral_code: referralCode } : {}),
        }),
        credentials: 'include',
      });

      let loginData = await parseJsonResponse<AuthLoginResponse>(loginRes, 'Google login');
      if (!loginRes.ok) {
        throw new Error(loginData.error || 'Google sign-in failed');
      }

      loginData = await resolveLogin(loginData);
      const { token, refresh_token: refreshToken } = loginData;
      if (!token) {
        throw new Error('Google login response missing token');
      }

      persistAuthTokens(token, refreshToken);
      clearReferralCode();
      // /auth/me carries managed_wallet, which the login payload does not.
      await refreshUser();
    } catch (err) {
      console.error("Google login error:", err);
      throw err;
    }
  };

  const logout = async () => {
    cancelMFA();
    try {
      await fetch(apiUrl('/v1/auth/logout'), { method: 'POST', credentials: 'include' });
    } catch {
      // Best-effort cookie clear; local state still wiped below.
    }
    clearStoredAuth();
    queryClient.clear();
    setUser(null);
    try {
      const { clearSolanaWalletAdapterSession, forgetRememberedWalletName } = await import('@/lib/solana-wallet-session');
      clearSolanaWalletAdapterSession();
      forgetRememberedWalletName();
      window.dispatchEvent(new CustomEvent('proxyhubb:auth-logout'));
    } catch {
      // ignore
    }
    router.push('/login');
  };

  const getAccessToken = async () => {
    return refreshAccessToken();
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated: !!user, walletLogin, googleLogin, logout, getAccessToken, refreshUser }}>
      {children}
      {mfaChallenge && <MfaChallengeDialog onVerify={verifyMFA} onCancel={cancelMFA} />}
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
  return !!getStoredAccessTokenSync();
}

// Helper to make authenticated API calls
export async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const token = await refreshAccessToken();

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
