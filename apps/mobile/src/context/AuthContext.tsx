import React, { createContext, useState, useEffect, useContext } from 'react';
import * as SecureStore from 'expo-secure-store';
import client from '../api/client';

interface User {
    id: string;
    email: string;
    role: string;
    display_name?: string;
    profile_image?: string;
}

interface AuthContextData {
    user: User | null;
    loading: boolean;
    login: (token: string, userData: User) => Promise<void>;
    logout: () => Promise<void>;
    isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextData>({} as AuthContextData);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadStorageData();
    }, []);

    async function loadStorageData() {
        try {
            const token = await SecureStore.getItemAsync('auth_token');
            const userData = await SecureStore.getItemAsync('user_data');

            if (token && userData) {
                // Optional: Validate token with API here
                // client.defaults.headers.Authorization = `Bearer ${token}`; // Already handled in interceptor but good for init
                setUser(JSON.parse(userData));
            }
        } catch (error) {
            console.log('Error loading auth data', error);
        } finally {
            setLoading(false);
        }
    }

    async function login(token: string, userData: User) {
        setLoading(true);
        try {
            await SecureStore.setItemAsync('auth_token', token);
            await SecureStore.setItemAsync('user_data', JSON.stringify(userData));
            setUser(userData);
        } catch (error) {
            console.log('Error saving auth data', error);
        } finally {
            setLoading(false);
        }
    }

    async function logout() {
        setUser(null);
        await SecureStore.deleteItemAsync('auth_token');
        await SecureStore.deleteItemAsync('user_data');
    }

    return (
        <AuthContext.Provider value={{ user, loading, login, logout, isAuthenticated: !!user }}>
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
