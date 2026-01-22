import { fetchWithAuth } from './auth-util';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8081/v1';

// ============== Types ==============
export interface User {
    id: string;
    email: string;
    role: string;
    username?: string;
    display_name?: string;
    bio?: string;
    avatar_url?: string;
    verified: boolean;
    avg_rating: number;
    total_bandwidth_sold: number;
}

export interface Listing {
    id: string;
    seller_id: string;
    title: string;
    proxy_type: 'residential' | 'mobile' | 'datacenter';
    price_per_gb: number;
    available_bandwidth_gb: number;
    orders_count: number;
    seller?: User;
}

export interface FeedEvent {
    id: string;
    actor_id?: string;
    event_type: string;
    content: string;
    created_at: string;
}

// ============== Feed API ==============
export async function getFeed(page = 1): Promise<{ events: FeedEvent[] }> {
    const res = await fetchWithAuth(`${API_BASE}/feed?page=${page}`);
    if (!res.ok) return { events: [] };
    return res.json();
}

export async function discoverProviders(page = 1): Promise<{ providers: User[] }> {
    const res = await fetchWithAuth(`${API_BASE}/discover?page=${page}`);
    if (!res.ok) return { providers: [] };
    return res.json();
}

export async function getTrendingListings(page = 1): Promise<{ listings: Listing[] }> {
    const res = await fetchWithAuth(`${API_BASE}/trending?page=${page}`);
    if (!res.ok) return { listings: [] };
    return res.json();
}

// ============== Listings API ==============
export async function getListings(params: any = {}): Promise<{ listings: Listing[]; total: number }> {
    const query = new URLSearchParams(params);
    const res = await fetchWithAuth(`${API_BASE}/listings?${query}`);
    if (!res.ok) return { listings: [], total: 0 };
    return res.json();
}
