import axios from 'axios';

// Create a configured axios instance
export const api = axios.create({
    // In development, this might point to localhost:8080.
    // referencing the environment variable or hardcoding for now.
    baseURL: import.meta.env.VITE_API_URL || "http://localhost:8081/v1",
    headers: {
        "Content-Type": "application/json",
    },
});

// Add interceptor to inject token
api.interceptors.request.use((config) => {
    const token = localStorage.getItem("auth_token");
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

export const auth = {
    login: async (_email: string, _password: string) => {
        // For Native Client MVP, we use the Dev Login endpoint which returns a valid token
        // In production, this should integrate with Supabase Auth or Wallet Sign-in
        const response = await api.post("/auth/dev/login", {});
        if (response.data.token) {
            localStorage.setItem("auth_token", response.data.token);
            localStorage.setItem("user", JSON.stringify(response.data.user));
        }
        return response.data;
    },

    register: async (data: any) => {
        // Assuming /auth/register endpoint
        const response = await api.post("/auth/register", data);
        return response.data;
    },

    logout: () => {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("user");
    },

    getUser: () => {
        const userStr = localStorage.getItem("user");
        return userStr ? JSON.parse(userStr) : null;
    },

    isAuthenticated: () => {
        return !!localStorage.getItem("auth_token");
    }
};

// Types
export interface Circle {
    id: string;
    name: string;
    description: string;
    visibility: 'public' | 'private';
    owner_id: string;
    member_count: number;
    created_at: string;
}

export interface Listing {
    id: string;
    title: string;
    proxy_type: string;
    price_per_gb: number;
    available_bandwidth_gb: number;
    protocol: string;
    seller: {
        username: string;
        display_name?: string;
        verified?: boolean;
        is_verified_agent?: boolean;
        avg_rating?: number;
    };
    orders_count?: number;
    uptime_percent?: number;
    avg_latency_ms?: number;
}

export const circles = {
    getAll: async () => {
        const response = await api.get<Circle[]>("/circles");
        return response.data;
    },
    get: async (id: string) => {
        const response = await api.get<Circle>(`/circles/${id}`);
        return response.data;
    },
    create: async (data: Partial<Circle>) => {
        const response = await api.post<Circle>("/circles", data);
        return response.data;
    },
    join: async (id: string) => {
        const response = await api.post(`/circles/${id}/join`);
        return response.data;
    },
    leave: async (id: string) => {
        const response = await api.post(`/circles/${id}/leave`);
        return response.data;
    },
    delete: async (id: string) => {
        await api.delete(`/circles/${id}`);
    },
};

export const marketplace = {
    getListings: async (params: any) => {
        const response = await api.get<{ listings: Listing[]; total: number }>("/listings", { params });
        return response.data;
    },
    buy: async (listingId: string, amount: number) => {
        const response = await api.post("/orders", { listing_id: listingId, bandwidth_gb: amount });
        return response.data;
    },
};

export const wallet = {
    getBalance: async () => {
        const response = await api.get("/wallet/balance");
        return response.data; // { balance_eth: number }
    },
    withdraw: async () => {
        const response = await api.post("/wallet/withdraw");
        return response.data;
    }
};
