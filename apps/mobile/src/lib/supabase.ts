import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import * as Linking from 'expo-linking';

const supabaseUrl = "https://jkrypzxbnwdcdvhtjxgx.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprcnlwenhibndkY2R2aHRqeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg1MDcxNTcsImV4cCI6MjA4NDA4MzE1N30.7HjMFgimIhNNmBlEBSX_1U_EM6MUZJcXKNHQhYJLcvg";

const LargeSecureStore = {
    _chunkSize: 2048,
    async setItem(key: string, value: string) {
        try {
            if (value.length < this._chunkSize) {
                await SecureStore.setItemAsync(key, value);
            } else {
                // For large items, store in chunks in SecureStore
                const chunkCount = Math.ceil(value.length / this._chunkSize);
                await SecureStore.setItemAsync(`${key}_chunks`, chunkCount.toString());
                for (let i = 0; i < chunkCount; i++) {
                    const chunk = value.slice(i * this._chunkSize, (i + 1) * this._chunkSize);
                    await SecureStore.setItemAsync(`${key}_${i}`, chunk);
                }
            }
        } catch (e) {
            console.error("SecureStore setItem failed", e);
        }
    },
    async getItem(key: string) {
        try {
            const chunkCountStr = await SecureStore.getItemAsync(`${key}_chunks`);
            if (chunkCountStr) {
                const count = parseInt(chunkCountStr, 10);
                let fullValue = '';
                for (let i = 0; i < count; i++) {
                    const chunk = await SecureStore.getItemAsync(`${key}_${i}`);
                    if (chunk) fullValue += chunk;
                }
                return fullValue;
            }
            return await SecureStore.getItemAsync(key);
        } catch (e) {
            return null;
        }
    },
    async removeItem(key: string) {
        try {
            const chunkCountStr = await SecureStore.getItemAsync(`${key}_chunks`);
            if (chunkCountStr) {
                const count = parseInt(chunkCountStr, 10);
                for (let i = 0; i < count; i++) {
                    await SecureStore.deleteItemAsync(`${key}_${i}`);
                }
                await SecureStore.deleteItemAsync(`${key}_chunks`);
            }
            await SecureStore.deleteItemAsync(key);
        } catch (e) {
            // ignore
        }
    }
};

const ExpoSecureStoreAdapter = {
    getItem: (key: string) => {
        return LargeSecureStore.getItem(key);
    },
    setItem: (key: string, value: string) => {
        return LargeSecureStore.setItem(key, value);
    },
    removeItem: (key: string) => {
        return LargeSecureStore.removeItem(key);
    },
};

// Get the proper redirect URL for OAuth
const getRedirectUrl = () => {
    return Linking.createURL('/auth/callback');
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        storage: ExpoSecureStoreAdapter,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: 'pkce', // Use PKCE flow for better security
    },
});

// Enhanced session management with automatic refresh
let refreshTimer: NodeJS.Timeout | null = null;

const setupAutoRefresh = () => {
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }
    
    // Check and refresh token every 30 minutes
    refreshTimer = setInterval(async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
                const expiresAt = session.expires_at;
                const now = Math.floor(Date.now() / 1000);
                
                // Refresh if token expires in the next 5 minutes
                if (expiresAt && (expiresAt - now) < 300) {
                    await supabase.auth.refreshSession();
                }
            }
        } catch (error) {
            console.error('Auto refresh failed:', error);
        }
    }, 30 * 60 * 1000); // 30 minutes
};

// Handle app state changes for proper session management
AppState.addEventListener('change', (state) => {
    if (state === 'active') {
        supabase.auth.startAutoRefresh();
        setupAutoRefresh();
    } else {
        supabase.auth.stopAutoRefresh();
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }
    }
});

// Initialize auto refresh on startup
setupAutoRefresh();

// Export helper functions
export { getRedirectUrl };
