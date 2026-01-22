import axios, { AxiosError, AxiosRequestConfig, AxiosInstance } from 'axios';
import * as SecureStore from 'expo-secure-store';
import NetInfo from '@react-native-community/netinfo';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Dynamic API configuration
interface APIConfig {
    baseURL: string;
    timeout: number;
    retryAttempts: number;
}

class APIClient {
    private client: AxiosInstance;
    private config: APIConfig;
    private isOnline: boolean = true;
    private initialized: boolean = false;

    constructor() {
        // Dynamic base URL logic
        const getBaseUrl = () => {
            if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
            if (Constants.expoConfig?.extra?.apiUrl) return Constants.expoConfig.extra.apiUrl;

            // Platform specific localhost
            if (Platform.OS === 'android') return 'http://10.0.2.2:8081/v1';
            return 'http://localhost:8081/v1';
        };

        // Set default config immediately
        this.config = {
            baseURL: getBaseUrl(),
            timeout: 10000,
            retryAttempts: 3,
        };

        // Create axios instance immediately
        this.client = axios.create({
            baseURL: this.config.baseURL,
            timeout: this.config.timeout,
            headers: {
                'Content-Type': 'application/json',
            },
        });

        this.setupInterceptors();
        this.setupNetworkMonitoring();
        this.initialized = true;
    }

    private setupNetworkMonitoring() {
        NetInfo.addEventListener(state => {
            this.isOnline = state.isConnected ?? false;
            console.log('Network status:', this.isOnline ? 'online' : 'offline');
        });
    }

    private setupInterceptors() {
        // Request interceptor for auth tokens
        this.client.interceptors.request.use(async (config) => {
            // Add auth token
            try {
                const token = await SecureStore.getItemAsync('auth_token');
                if (token) {
                    config.headers = config.headers || {};
                    config.headers.Authorization = `Bearer ${token}`;
                }
            } catch (error) {
                console.warn('Failed to get auth token:', error);
            }

            // Add network status check
            if (!this.isOnline) {
                throw new Error('No internet connection');
            }

            return config;
        });

        // Response interceptor for error handling and retries
        this.client.interceptors.response.use(
            (response) => response,
            async (error: AxiosError) => {
                const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean; _retryCount?: number };

                if (!originalRequest._retryCount) {
                    originalRequest._retryCount = 0;
                }

                // Retry logic for network errors
                if (this.shouldRetry(error) && originalRequest._retryCount < (this.config?.retryAttempts || 3)) {
                    originalRequest._retryCount++;

                    // Exponential backoff
                    const delay = Math.pow(2, originalRequest._retryCount) * 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));

                    return this.client(originalRequest);
                }

                // Handle specific error cases
                if (error.response?.status === 401) {
                    // Token expired - attempt refresh
                    await this.handleTokenRefresh();
                }

                return Promise.reject(this.formatError(error));
            }
        );
    }

    private shouldRetry(error: AxiosError): boolean {
        // Retry on network errors or 5xx server errors
        return !error.response ||
            error.code === 'NETWORK_ERROR' ||
            error.code === 'ECONNABORTED' ||
            (error.response.status >= 500 && error.response.status < 600);
    }

    private async handleTokenRefresh() {
        try {
            // Try to refresh wallet token
            const walletToken = await SecureStore.getItemAsync('wallet_token');
            if (walletToken) {
                const response = await this.client.get('/auth/verify-wallet');
                if (!response.data.user) {
                    await SecureStore.deleteItemAsync('wallet_token');
                    await SecureStore.deleteItemAsync('auth_token');
                }
            }
        } catch (error) {
            console.error('Token refresh failed:', error);
            await SecureStore.deleteItemAsync('wallet_token');
            await SecureStore.deleteItemAsync('auth_token');
        }
    }

    private formatError(error: AxiosError) {
        return {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data,
            isNetworkError: !error.response,
            isRetryable: this.shouldRetry(error),
        };
    }

    // Public methods
    public async setBaseURL(url: string) {
        this.config.baseURL = url;
        this.client.defaults.baseURL = url;
    }

    public async getHealthStatus() {
        try {
            const response = await this.client.get('/health');
            return { healthy: true, data: response.data };
        } catch (error) {
            return { healthy: false, error };
        }
    }

    // Expose axios methods with proper binding
    public get = (url: string, config?: any) => this.client.get(url, config);
    public post = (url: string, data?: any, config?: any) => this.client.post(url, data, config);
    public put = (url: string, data?: any, config?: any) => this.client.put(url, data, config);
    public delete = (url: string, config?: any) => this.client.delete(url, config);
}

const client = new APIClient();
export default client;
