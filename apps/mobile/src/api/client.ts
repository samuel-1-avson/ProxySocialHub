import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// Base URL for the Control API
// UPDATE THIS to your Cloudflare Tunnel URL for testing on physical devices!
const BASE_URL = 'http://172.20.10.5:8080/v1';

const client = axios.create({
    baseURL: BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Add auth token to requests
client.interceptors.request.use(async (config) => {
    const token = await SecureStore.getItemAsync('auth_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

export default client;
