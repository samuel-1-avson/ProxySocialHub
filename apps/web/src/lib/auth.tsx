'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export interface User {
  id: string;
  email: string;
  role: 'buyer' | 'provider' | 'admin';
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, role: 'buyer' | 'provider') => Promise<void>;
  logout: () => void;
  getAccessToken: () => string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'proxyhubb_tokens';
const USER_KEY = 'proxyhubb_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load user from localStorage on mount
  useEffect(() => {
    const storedUser = localStorage.getItem(USER_KEY);
    const storedTokens = localStorage.getItem(TOKEN_KEY);

    if (storedUser && storedTokens) {
      try {
        setUser(JSON.parse(storedUser));
      } catch (e) {
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(TOKEN_KEY);
      }
    }
    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    const response = await fetch(`${API_BASE_URL}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Login failed');
    }

    const data = await response.json();

    // Store tokens
    const tokens: AuthTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
    };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));

    // Store user
    const userData: User = data.user;
    localStorage.setItem(USER_KEY, JSON.stringify(userData));
    setUser(userData);
  };

  const register = async (email: string, password: string, role: 'buyer' | 'provider') => {
    const response = await fetch(`${API_BASE_URL}/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, role }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Registration failed');
    }

    // Registration successful, user needs to login
    return;
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  };

  const getAccessToken = (): string | null => {
    const storedTokens = localStorage.getItem(TOKEN_KEY);
    if (!storedTokens) return null;
    try {
      const tokens: AuthTokens = JSON.parse(storedTokens);
      return tokens.access_token;
    } catch {
      return null;
    }
  };

  return (
    <AuthContext.Provider value= {{ user, isLoading, isAuthenticated: !!user, login, register, logout, getAccessToken }
}>
  { children }
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
export async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const storedTokens = localStorage.getItem(TOKEN_KEY);
  if (!storedTokens) {
    throw new Error('Not authenticated');
  }

  const tokens: AuthTokens = JSON.parse(storedTokens);

  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${tokens.access_token}`,
  };

  const response = await fetch(url, { ...options, headers });

  // If unauthorized, token might be expired
  if (response.status === 401) {
    // Try to refresh token
    const refreshResponse = await fetch(`${API_BASE_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: tokens.refresh_token }),
    });

    if (refreshResponse.ok) {
      const newTokens = await refreshResponse.json();
      localStorage.setItem(TOKEN_KEY, JSON.stringify({
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token,
        expires_in: newTokens.expires_in,
      }));

      // Retry original request with new token
      const retryHeaders = {
        ...options.headers,
        'Authorization': `Bearer ${newTokens.access_token}`,
      };
      return fetch(url, { ...options, headers: retryHeaders });
    } else {
      // Refresh failed, clear tokens
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      throw new Error('Session expired. Please login again.');
    }
  }

  return response;
}
