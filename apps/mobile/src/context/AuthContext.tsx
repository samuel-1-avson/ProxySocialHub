import React, { createContext, useState, useEffect, useContext } from 'react';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../lib/supabase';
import { User, Session } from '@supabase/supabase-js';

interface AuthContextData {
    user: User | null;
    loading: boolean;
    logout: () => Promise<void>;
    isAuthenticated: boolean;
    walletLogin: (address: string, signature: string, message: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextData>({} as AuthContextData);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Check active session
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
                setUser(session.user);
            }
            setLoading(false);
        });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
        });

        return () => subscription.unsubscribe();
    }, []);

    async function logout() {
        await supabase.auth.signOut();
        // Also clear any custom wallet token if we used one separately (handled by supabase if custom token login)
    }

    async function walletLogin(address: string, signature: string, message: string) {
        // Call backend to verify signature and get custom JWT
        // Then set session using supabase.auth.setSession if possible, or just Use custom token
        // For now, we will assume backend returns a JWT that supabase can accept OR we store it manually
        // But since Supabase is the source of truth, we should exchange custom token for Supabase session if possible
        // OR simpler: Backend returns valid Supabase JWT? 
        // Actually, existing backend returns a custom JWT signed by itself.
        // We should treat "Wallet User" as a user in our app.
        // Currently `AuthContext` relies on `supabase.auth.onAuthStateChange`.
        // If we login via wallet, Supabase might not know about it unless we use Custom Auth (JWT).
        // Let's implement the backend call and then figure out how to update state.

        // This is a placeholder for now, to be implemented in login.tsx or here
        console.log("Wallet login not fully implemented in AuthContext yet", address);
    }

    return (
        <AuthContext.Provider value={{ user, loading, logout, isAuthenticated: !!user, walletLogin }}>
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
