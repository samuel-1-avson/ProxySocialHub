import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// Base URL for the Control API
// Use local IP for Android emulator (10.0.2.2) or machine IP for physical device
// For iOS simulator, localhost works
const BASE_URL = 'http://10.0.2.2:8080/v1';

const client = axios.create({
    baseURL: BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Add auth token to requests
client.interceptceptors.request.use(async (config) => {
    const token = await SecureStore.getItemAsync('auth_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

export default client;
