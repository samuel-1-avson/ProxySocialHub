
'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { User, Session } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';

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
        const { data: { session } } = await supabase.auth.getSession();
        setUser(session?.user ?? null);
      } catch (error) {
        console.error('Error checking auth session:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setIsLoading(false);
      if (_event === 'SIGNED_OUT') {
        router.push('/login');
        router.refresh();
      }
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
      if (!signer || !signer.signRaw) throw new Error('Signer does not support signRaw');
      const { signature } = await signer.signRaw({
        address,
        data: message,
        type: 'bytes'
      });

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
        user_metadata: {},
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
