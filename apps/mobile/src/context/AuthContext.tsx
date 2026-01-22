import React, { createContext, useState, useEffect, useContext } from 'react';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../lib/supabase';
import { User, Session } from '@supabase/supabase-js';
import client from '../api/client';
import { ErrorHandler } from '../lib/errorHandler';

interface AuthContextData {
    user: User | null;
    loading: boolean;
    isAuthenticated: boolean;
    authMethod: 'email' | 'oauth' | 'wallet' | null;
    logout: () => Promise<void>;
    login: (token: string, user: any) => Promise<void>;
    walletLogin: (address: string, signature: string, message: string) => Promise<void>;
    refreshToken: () => Promise<void>;
    getAuthHeaders: () => Promise<Record<string, string>>;
}

const AuthContext = createContext<AuthContextData>({} as AuthContextData);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [authMethod, setAuthMethod] = useState<'email' | 'oauth' | 'wallet' | null>(null);

    useEffect(() => {
        // Check active session on startup
        initializeAuth();

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            console.log('Auth state changed:', event, session?.user?.email);

            if (session?.user) {
                setUser(session.user);
                // Determine auth method based on user metadata or provider
                const provider = session.user.app_metadata?.provider;
                if (provider === 'google' || provider === 'github') {
                    setAuthMethod('oauth');
                } else if (session.user.user_metadata?.wallet_address) {
                    setAuthMethod('wallet');
                } else {
                    setAuthMethod('email');
                }
            } else {
                setUser(null);
                setAuthMethod(null);
                // Clear any stored wallet tokens
                await SecureStore.deleteItemAsync('wallet_token');
            }

            setLoading(false);
        });

        return () => subscription.unsubscribe();
    }, []);

    const initializeAuth = async () => {
        try {
            // First check for Supabase session
            const { data: { session }, error } = await supabase.auth.getSession();

            if (error) {
                console.error('Error getting session:', error);
            }

            if (session?.user) {
                setUser(session.user);
                const provider = session.user.app_metadata?.provider;
                if (provider === 'google' || provider === 'github') {
                    setAuthMethod('oauth');
                } else if (session.user.user_metadata?.wallet_address) {
                    setAuthMethod('wallet');
                } else {
                    setAuthMethod('email');
                }
            } else {
                // Check for wallet token as fallback
                const walletToken = await SecureStore.getItemAsync('wallet_token');
                if (walletToken) {
                    // Verify wallet token with backend
                    try {
                        const response = await client.get('/auth/verify-wallet');
                        if (response.data.user) {
                            // Create a pseudo-user object for wallet authentication
                            const walletUserData = {
                                id: response.data.user.id,
                                email: response.data.user.wallet_address,
                                user_metadata: { wallet_address: response.data.user.wallet_address },
                                app_metadata: { provider: 'wallet' },
                            };
                            setUser(walletUserData as unknown as User);
                            setAuthMethod('wallet');
                        }
                    } catch (error) {
                        console.error('Wallet token verification failed:', error);
                        await SecureStore.deleteItemAsync('wallet_token');
                    }
                }
            }
        } catch (error) {
            console.error('Auth initialization error:', error);
        } finally {
            setLoading(false);
        }
    };

    const login = async (token: string, userData: any) => {
        try {
            await SecureStore.setItemAsync('auth_token', token);
            setUser(userData as User);
            setAuthMethod('email');
        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    };

    const logout = async () => {
        try {
            // Sign out from Supabase
            await supabase.auth.signOut();

            // Clear wallet token if exists
            await SecureStore.deleteItemAsync('wallet_token');

            // Clear any other stored auth data
            await SecureStore.deleteItemAsync('auth_token');

            setUser(null);
            setAuthMethod(null);
        } catch (error) {
            console.error('Logout error:', error);
            ErrorHandler.handleAuthError(error, 'AuthContext', 'logout');
        }
    };

    const walletLogin = async (address: string, signature: string, message: string) => {
        try {
            setLoading(true);

            // Call backend to verify signature and get custom JWT
            const response = await client.post('/auth/wallet-login', {
                address,
                signature,
                message,
            });

            const { token, user: walletUser } = response.data;

            // Store wallet token
            await SecureStore.setItemAsync('wallet_token', token);
            await SecureStore.setItemAsync('auth_token', token);

            // Create a pseudo-user object for wallet authentication
            const userObj = {
                id: walletUser.id,
                email: address,
                user_metadata: { wallet_address: address },
                app_metadata: { provider: 'wallet' },
            };

            setUser(userObj as unknown as User);
            setAuthMethod('wallet');

        } catch (error) {
            console.error('Wallet login error:', error);
            ErrorHandler.handleWalletError(error, 'AuthContext', 'walletLogin');
            throw error;
        } finally {
            setLoading(false);
        }
    };

    const refreshToken = async () => {
        try {
            if (authMethod === 'wallet') {
                // For wallet auth, verify the token is still valid
                const walletToken = await SecureStore.getItemAsync('wallet_token');
                if (walletToken) {
                    const response = await client.get('/auth/verify-wallet');
                    if (!response.data.user) {
                        await logout();
                    }
                }
            } else {
                // For Supabase auth, use built-in refresh
                const { error } = await supabase.auth.refreshSession();
                if (error) {
                    console.error('Token refresh error:', error);
                    await logout();
                }
            }
        } catch (error) {
            console.error('Token refresh failed:', error);
            await logout();
        }
    };

    const getAuthHeaders = async (): Promise<Record<string, string>> => {
        try {
            if (authMethod === 'wallet') {
                const walletToken = await SecureStore.getItemAsync('wallet_token');
                return walletToken ? { Authorization: `Bearer ${walletToken}` } : {};
            } else {
                const { data: { session } } = await supabase.auth.getSession();
                return session?.access_token
                    ? { Authorization: `Bearer ${session.access_token}` }
                    : {};
            }
        } catch (error) {
            console.error('Error getting auth headers:', error);
            return {};
        }
    };

    return (
        <AuthContext.Provider value={{
            user,
            loading,
            isAuthenticated: !!user,
            authMethod,
            logout,
            login,
            walletLogin,
            refreshToken,
            getAuthHeaders
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
