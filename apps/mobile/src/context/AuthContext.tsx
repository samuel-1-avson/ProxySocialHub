import React, { createContext, useState, useEffect, useContext } from 'react';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../lib/supabase';
import { User } from '@supabase/supabase-js';

interface AuthContextData {
    user: User | null;
    loading: boolean;
    logout: () => Promise<void>;
    isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextData>({} as AuthContextData);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Check active session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setUser(session?.user ?? null);
            setLoading(false);
        });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
            if (session?.access_token) {
                SecureStore.setItemAsync('auth_token', session.access_token);
            } else {
                SecureStore.deleteItemAsync('auth_token');
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    async function logout() {
        await supabase.auth.signOut();
        await SecureStore.deleteItemAsync('auth_token');
        setUser(null);
    }

    return (
        <AuthContext.Provider value={{ user, loading, logout, isAuthenticated: !!user }}>
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
