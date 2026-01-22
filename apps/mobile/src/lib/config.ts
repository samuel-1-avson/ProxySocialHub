import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

export interface AppConfig {
    api: {
        baseURL: string;
        timeout: number;
        retryAttempts: number;
    };
    auth: {
        supabaseURL: string;
        supabaseAnonKey: string;
        enableWallet: boolean;
        enableOAuth: boolean;
    };
    wallet: {
        network: 'mainnet-beta' | 'devnet' | 'testnet';
        rpcEndpoint: string;
        supportedWallets: string[];
    };
    features: {
        enableOfflineMode: boolean;
        enablePushNotifications: boolean;
        enableAnalytics: boolean;
    };
}

class ConfigManager {
    private config: AppConfig | null = null;
    private readonly CONFIG_KEY = 'app_config';

    async getConfig(): Promise<AppConfig> {
        if (this.config) {
            return this.config;
        }

        // Try to load from secure storage first
        const storedConfig = await this.loadStoredConfig();
        if (storedConfig) {
            this.config = storedConfig;
            return this.config;
        }

        // Generate default config
        this.config = this.generateDefaultConfig();
        await this.saveConfig(this.config);
        return this.config;
    }

    private async loadStoredConfig(): Promise<AppConfig | null> {
        try {
            const configStr = await SecureStore.getItemAsync(this.CONFIG_KEY);
            if (configStr) {
                return JSON.parse(configStr);
            }
        } catch (error) {
            console.error('Failed to load stored config:', error);
        }
        return null;
    }

    private generateDefaultConfig(): AppConfig {
        const isDevelopment = __DEV__;
        const isExpoGo = Constants.appOwnership === 'expo';

        let apiBaseURL: string;
        if (isDevelopment) {
            if (isExpoGo) {
                // Use tunnel URL for Expo Go
                apiBaseURL = process.env.EXPO_PUBLIC_API_URL || 'https://your-tunnel-url.trycloudflare.com/v1';
            } else {
                // Use local network IP for development builds
                apiBaseURL = process.env.EXPO_PUBLIC_API_URL || 'http://172.20.10.5:8080/v1';
            }
        } else {
            // Production
            apiBaseURL = process.env.EXPO_PUBLIC_API_URL || 'https://api.proxyhub.app/v1';
        }

        return {
            api: {
                baseURL: apiBaseURL,
                timeout: 10000,
                retryAttempts: 3,
            },
            auth: {
                supabaseURL: process.env.EXPO_PUBLIC_SUPABASE_URL || "https://jkrypzxbnwdcdvhtjxgx.supabase.co",
                supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprcnlwenhibndkY2R2aHRqeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg1MDcxNTcsImV4cCI6MjA4NDA4MzE1N30.7HjMFgimIhNNmBlEBSX_1U_EM6MUZJcXKNHQhYJLcvg",
                enableWallet: true,
                enableOAuth: true,
            },
            wallet: {
                network: isDevelopment ? 'devnet' : 'mainnet-beta',
                rpcEndpoint: isDevelopment 
                    ? 'https://api.devnet.solana.com'
                    : 'https://api.mainnet-beta.solana.com',
                supportedWallets: ['phantom', 'solflare'],
            },
            features: {
                enableOfflineMode: true,
                enablePushNotifications: !isDevelopment,
                enableAnalytics: !isDevelopment,
            },
        };
    }

    async updateConfig(updates: Partial<AppConfig>): Promise<void> {
        const currentConfig = await this.getConfig();
        this.config = this.deepMerge(currentConfig, updates);
        await this.saveConfig(this.config);
    }

    private async saveConfig(config: AppConfig): Promise<void> {
        try {
            await SecureStore.setItemAsync(this.CONFIG_KEY, JSON.stringify(config));
        } catch (error) {
            console.error('Failed to save config:', error);
        }
    }

    private deepMerge(target: any, source: any): any {
        const result = { ...target };
        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = this.deepMerge(target[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }
        return result;
    }

    async validateConfig(): Promise<{ valid: boolean; errors: string[] }> {
        const config = await this.getConfig();
        const errors: string[] = [];

        // Validate API configuration
        if (!config.api.baseURL) {
            errors.push('API base URL is required');
        }

        // Validate auth configuration
        if (!config.auth.supabaseURL) {
            errors.push('Supabase URL is required');
        }
        if (!config.auth.supabaseAnonKey) {
            errors.push('Supabase anonymous key is required');
        }

        // Validate wallet configuration
        if (!config.wallet.rpcEndpoint) {
            errors.push('Wallet RPC endpoint is required');
        }

        return {
            valid: errors.length === 0,
            errors,
        };
    }

    async getDebugInfo(): Promise<Record<string, any>> {
        const config = await this.getConfig();
        return {
            environment: __DEV__ ? 'development' : 'production',
            appOwnership: Constants.appOwnership,
            apiBaseURL: config.api.baseURL,
            supabaseURL: config.auth.supabaseURL,
            walletNetwork: config.wallet.network,
            // Don't expose sensitive keys in debug info
            hasSupabaseKey: !!config.auth.supabaseAnonKey,
        };
    }
}

export const configManager = new ConfigManager();