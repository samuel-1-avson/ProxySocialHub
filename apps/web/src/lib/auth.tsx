
'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import bs58 from 'bs58';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081';

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
          const token = localStorage.getItem('proxyhubb_token');
          if (token) {
            const res = await fetch(`${API_URL}/v1/auth/me`, {
              headers: {
                'Authorization': `Bearer ${token}`
              }
            });

            if (res.ok) {
              const apiUser = await res.json();
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
              // Token invalid or expired
              localStorage.removeItem('proxyhubb_token');
            }
          }
        }
      } catch (error) {
        console.error('Error checking auth session:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkUser();
  }, []);

  const walletLogin = async (address: string, signer: any) => {
    try {
      // 1. Get Challenge
      const challengeRes = await fetch(`${API_URL}/v1/auth/wallet/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address })
      });
      if (!challengeRes.ok) throw new Error('Failed to get auth challenge');
      const { message } = await challengeRes.json();

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
      const loginRes = await fetch(`${API_URL}/v1/auth/wallet/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          signature,
          nonce: message // Full message as expected by backend
        })
      });

      if (!loginRes.ok) {
        const errData = await loginRes.json();
        throw new Error(errData.error || 'Login failed');
      }

      const { token, user: apiUser } = await loginRes.json();

      // 4. Store Token
      if (typeof window !== 'undefined') {
        localStorage.setItem('proxyhubb_token', token);
      }

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
    if (typeof window !== 'undefined') {
      localStorage.removeItem('proxyhubb_token');
    }
    setUser(null);
    router.push('/login');
  };

  const getAccessToken = async () => {
    return typeof window !== 'undefined' ? localStorage.getItem('proxyhubb_token') : null;
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
  return !!localStorage.getItem('proxyhubb_token');
}

// Helper to make authenticated API calls
export async function fetchWithAuth(url: string, options: RequestInit = {}) {
  let token: string | undefined;

  if (typeof window !== 'undefined') {
    token = localStorage.getItem('proxyhubb_token') || undefined;
  }

  if (!token) {
    throw new Error('Not authenticated');
  }

  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${token}`,
  };

  const response = await fetch(url, { ...options, headers });
  return response;
}
