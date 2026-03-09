
'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { User, Session } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import bs58 from 'bs58';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// Singleton Supabase client — instantiated once at module scope to avoid
// multiple GoTrue instances and redundant auth listener registrations.
const supabase = createClient();

export interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, role: 'buyer' | 'provider') => Promise<void>;
  loginWithOAuth: (provider: 'google' | 'github') => Promise<void>;
  walletLogin: (address: string, signer: any) => Promise<void>;
  logout: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const hasSupabase = isSupabaseConfigured();
  const router = useRouter();

  useEffect(() => {
    const checkUser = async () => {
      try {
        // 1. Check Supabase Session (only if Supabase is configured)
        if (hasSupabase && supabase) {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            setUser(session.user);
            return;
          }
        }

        // 2. Check Local Token (Wallet Login)
        if (typeof window !== 'undefined') {
          const token = localStorage.getItem('proxyhubb_token');
          if (token) {
            // Validate token with backend
            const res = await fetch(`${API_URL}/v1/auth/me`, {
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

    // Listen for Supabase auth changes (only if Supabase is configured)
    if (hasSupabase && supabase) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user) {
          setUser(session.user);
        }
      });

      return () => subscription.unsubscribe();
    }
  }, [hasSupabase, router]);

  const login = async (email: string, password: string) => {
    if (!hasSupabase || !supabase) {
      throw new Error('Email/password login requires Supabase configuration');
    }
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  };

  const register = async (email: string, password: string, role: 'buyer' | 'provider') => {
    if (!hasSupabase || !supabase) {
      throw new Error('Email/password registration requires Supabase configuration');
    }
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { role }
      }
    });
    if (error) throw error;
  };

  const loginWithOAuth = async (provider: 'google' | 'github') => {
    if (!hasSupabase || !supabase) {
      throw new Error('OAuth login requires Supabase configuration');
    }
    
    const redirectUrl = typeof window !== 'undefined' 
      ? `${window.location.origin}/auth/callback`
      : `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4001'}/auth/callback`;
    
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: redirectUrl,
        queryParams: {
          // Pass role hint for new users
          role: 'buyer'
        }
      }
    });
    
    if (error) throw error;
  };

  const logout = async () => {
    if (hasSupabase && supabase) {
      await supabase.auth.signOut();
    }
    if (typeof window !== 'undefined') {
      localStorage.removeItem('proxyhubb_token');
    }
    setUser(null);
    router.push('/login');
  };

  const getAccessToken = async () => {
    if (hasSupabase && supabase) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) return session.access_token;
    }
    return typeof window !== 'undefined' ? localStorage.getItem('proxyhubb_token') : null;
  };

  const walletLogin = async (address: string, signer: any) => {
    try {
      // 1. Get Challenge
      const challengeRes = await fetch(`${API_URL}/v1/auth/wallet/challenge`, {
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
      const loginRes = await fetch(`${API_URL}/v1/auth/wallet/login`, {
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
      // Don't push here - let the caller handle navigation after state is set
    } catch (err) {
      console.error("Wallet login error:", err);
      throw err;
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated: !!user, login, register, loginWithOAuth, logout, getAccessToken, walletLogin }}>
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

  // Try Supabase first (if configured)
  if (supabase) {
    const { data: { session } } = await supabase.auth.getSession();
    token = session?.access_token;
  }

  // Fallback to local token
  if (!token && typeof window !== 'undefined') {
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
