import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const supabaseUrl = "https://jkrypzxbnwdcdvhtjxgx.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprcnlwenhibndkY2R2aHRqeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg1MDcxNTcsImV4cCI6MjA4NDA4MzE1N30.7HjMFgimIhNNmBlEBSX_1U_EM6MUZJcXKNHQhYJLcvg";



const LargeSecureStore = {
    _chunkSize: 2048,
    async setItem(key: string, value: string) {
        try {
            if (value.length < this._chunkSize) {
                await SecureStore.setItemAsync(key, value);
            } else {
                // For large items, store in AsyncStorage but validness/security trade-off
                // Alternatively, split into chunks in SecureStore. 
                // Best approach for auth tokens (which are sensitive) is SecureStore.
                // But tokens themselves shouldn't be > 2KB. The 'session' object might be.
                // We will store just the sensitive parts if possible, but Supabase expects full store.
                // Let's implement chunking for SecureStore.
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

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        storage: ExpoSecureStoreAdapter,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
    },
});

AppState.addEventListener('change', (state) => {
    if (state === 'active') {
        supabase.auth.startAutoRefresh();
    } else {
        supabase.auth.stopAutoRefresh();
    }
});
