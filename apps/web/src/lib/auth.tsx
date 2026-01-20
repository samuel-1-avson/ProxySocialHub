
'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { User, Session } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import bs58 from 'bs58';

export interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, role: 'buyer' | 'provider') => Promise<void>;
  walletLogin: (address: string, signer: any) => Promise<void>;
  logout: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    const checkUser = async () => {
      try {
        // 1. Check Supabase Session
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          setUser(session.user);
          return;
        }

        // 2. Check Local Token (Wallet Login)
        if (typeof window !== 'undefined') {
          const token = localStorage.getItem('proxyhubb_token');
          if (token) {
            // Validate token with backend
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081'}/v1/auth/me`, {
              headers: {
                'Authorization': `Bearer ${token}`
              }
            });

            if (res.ok) {
              const apiUser = await res.json();
              // Map to Supabase User shape
              const mappedUser: User = {
                id: apiUser.id,
                email: apiUser.email,
                role: apiUser.role,
                app_metadata: {},
                user_metadata: {
                  username: apiUser.username,
                  avatar_url: apiUser.avatar_url,
                },
                aud: 'authenticated',
                created_at: new Date().toISOString()
              } as unknown as User;
              setUser(mappedUser);
            } else {
              // Token invalid
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

    // Listen for Supabase auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
      } else {
        // Only clear user if no local token exists either (handling "Switch to Supabase logout" vs "Wallet logout")
        // But simplified: if Supabase sign out happens, we likely want to sign out completely.
        // However, wallet login users don't trigger Supabase auth state changes.
        // So this listener is fine for Supabase users.
        // For Wallet users, logout() function clears everything.
      }

      // We don't want to auto-clear user here if they are logged in via wallet
      // Because onAuthStateChange might fire on initial load with null session.
    });

    return () => subscription.unsubscribe();
  }, [supabase, router]);

  const login = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  };

  const register = async (email: string, password: string, role: 'buyer' | 'provider') => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      // Pass role as metadata. Trigger will handle profile creation.
      options: {
        data: {
          role: role
        }
      }
    });
    if (error) throw error;
  };

  const logout = async () => {
    await supabase.auth.signOut();
    if (typeof window !== 'undefined') {
      localStorage.removeItem('proxyhubb_token');
    }
    setUser(null);
    router.push('/login');
  };

  const getAccessToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) return session.access_token;
    return typeof window !== 'undefined' ? localStorage.getItem('proxyhubb_token') : null;
  };

  const walletLogin = async (address: string, signer: any) => {
    try {
      // 1. Get Challenge
      const challengeRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081'}/v1/auth/wallet/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address })
      });
      if (!challengeRes.ok) throw new Error('Failed to get auth challenge');
      const { message, nonce } = await challengeRes.json();

      // 2. Sign Message
      let signature = '';

      // Check for Solana Wallet (Phantom/Adapter)
      if (signer && signer.signMessage) {
        const encodedMessage = new TextEncoder().encode(message);
        const signatureBytes = await signer.signMessage(encodedMessage);

        // Use bs58 to encode signature
        signature = bs58.encode(signatureBytes);
      }
      // Check for Polkadot/Substrate Wallet
      else if (signer && signer.signRaw) {
        const result = await signer.signRaw({
          address,
          data: message,
          type: 'bytes'
        });
        signature = result.signature;
      } else {
        throw new Error('Wallet does not support signing');
      }

      // 3. Login
      const loginRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081'}/v1/auth/wallet/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          signature,
          nonce: message // Sending full message as expected by backend
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
      // We need to map apiUser to Supabase User shape or allow null?
      // For now, we manually construct a simpler user object or cast it.
      const mappedUser: User = {
        id: apiUser.id,
        email: apiUser.email,
        role: apiUser.role,
        app_metadata: {},
        user_metadata: {
          username: apiUser.username,
          avatar_url: apiUser.avatar_url,
          // Map other fields if necessary
        },
        aud: 'authenticated',
        created_at: new Date().toISOString()
      } as unknown as User;

      setUser(mappedUser);
      router.push('/dashboard');
    } catch (err) {
      console.error("Wallet login error:", err);
      throw err;
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated: !!user, login, register, logout, getAccessToken, walletLogin }}>
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

// Helper to make authenticated API calls
// Compatible with previous signature
export async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();

  let token = session?.access_token;
  if (!token && typeof window !== 'undefined') {
    token = localStorage.getItem('proxyhubb_token') || undefined;
  }

  if (!token) {
    // Could redirect logic here if client-side
    throw new Error('Not authenticated');
  }

  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${token}`,
  };

  const response = await fetch(url, { ...options, headers });

  // Supabase client handles token refresh automatically so we don't need manual 401 retry logic for token expiry
  // unless Supabase fails to refresh, in which case session is null.

  return response;
}
