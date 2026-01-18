// Social API - ProxySocialHub marketplace features
import { fetchWithAuth } from './auth';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// ============== Types ==============
export interface User {
    id: string;
    email: string;
    role: string;
    username?: string;
    display_name?: string;
    bio?: string;
    avatar_url?: string;
    location?: string;
    website?: string;
    verified: boolean;
    followers_count: number;
    following_count: number;
    reviews_count: number;
    avg_rating: number;
    total_bandwidth_sold: number;
    trust_tier: string;
    created_at: string;
    is_following?: boolean;
}

export interface Listing {
    id: string;
    seller_id: string;
    title: string;
    description: string;
    proxy_type: 'residential' | 'mobile' | 'datacenter';
    protocol: string;
    price_per_gb: number;
    min_purchase_gb: number;
    bulk_discounts: BulkDiscount[];
    available_bandwidth_gb: number;
    max_concurrency: number;
    avg_latency_ms: number;
    uptime_percent: number;
    success_rate: number;
    views_count: number;
    saves_count: number;
    orders_count: number;
    status: string;
    seller?: User;
    created_at: string;
}

export interface BulkDiscount {
    min_gb: number;
    price_per_gb: number;
}

export interface Order {
    id: string;
    buyer_id: string;
    seller_id: string;
    listing_id: string;
    bandwidth_gb: number;
    price_per_gb: number;
    total_price: number;
    status: string;
    session_id?: string;
    buyer?: User;
    seller?: User;
    listing?: Listing;
    created_at: string;
}

export interface Review {
    id: string;
    reviewer_id: string;
    seller_id: string;
    listing_id?: string;
    order_id?: string;
    rating: number;
    title: string;
    content: string;
    helpful_count: number;
    seller_response?: string;
    verified_purchase: boolean;
    reviewer?: User;
    created_at: string;
}

export interface Conversation {
    id: string;
    participant1: string;
    participant2: string;
    last_message_at: string;
    other_participant?: User;
    last_message?: Message;
    unread_count?: number;
}

export interface Message {
    id: string;
    conversation_id: string;
    sender_id: string;
    content: string;
    read_at?: string;
    sender?: User;
    created_at: string;
}

export interface FeedEvent {
    id: string;
    actor_id?: string;
    event_type: string;
    content: string;
    actor?: User;
    created_at: string;
}

// ============== Notifications API ==============
export async function getNotifications(): Promise<{ notifications: any[] }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/notifications`);
    if (!res.ok) {
        if (res.status === 404) return { notifications: [] };
        throw new Error('Failed to fetch notifications');
    }
    return res.json();
}

// ============== Profile API ==============
export async function getMyProfile(): Promise<User> {
    const res = await fetchWithAuth(`${API_BASE}/v1/profile`);
    if (!res.ok) throw new Error('Failed to fetch profile');
    return res.json();
}

export async function updateProfile(data: Partial<User>): Promise<User> {
    const res = await fetchWithAuth(`${API_BASE}/v1/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update profile');
    return res.json();
}

export async function getPublicProfile(identifier: string): Promise<User> {
    const res = await fetchWithAuth(`${API_BASE}/v1/users/${identifier}`);
    if (!res.ok) throw new Error('User not found');
    return res.json();
}

export async function followUser(userId: string): Promise<void> {
    const res = await fetchWithAuth(`${API_BASE}/v1/users/${userId}/follow`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to follow');
}

export async function unfollowUser(userId: string): Promise<void> {
    const res = await fetchWithAuth(`${API_BASE}/v1/users/${userId}/follow`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to unfollow');
}

// ============== Listings API ==============
export async function getListings(params: {
    proxy_type?: string;
    sort_by?: string;
    page?: number;
} = {}): Promise<{ listings: Listing[]; total: number }> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined) query.set(k, String(v));
    });
    const res = await fetchWithAuth(`${API_BASE}/v1/listings?${query}`);
    if (!res.ok) throw new Error('Failed to fetch listings');
    return res.json();
}

export async function getListing(id: string): Promise<{ listing: Listing; is_saved: boolean }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/listings/${id}`);
    if (!res.ok) throw new Error('Listing not found');
    return res.json();
}

export async function createListing(data: {
    title: string;
    description: string;
    proxy_type: string;
    protocol: string;
    price_per_gb: number;
    available_bandwidth_gb: number;
    min_purchase_gb?: number;
    max_concurrency?: number;
}): Promise<Listing> {
    const res = await fetchWithAuth(`${API_BASE}/v1/listings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create listing');
    return res.json();
}

export async function updateListing(id: string, data: Partial<Listing>): Promise<Listing> {
    const res = await fetchWithAuth(`${API_BASE}/v1/listings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update listing');
    return res.json();
}

export async function deleteListing(id: string): Promise<void> {
    const res = await fetchWithAuth(`${API_BASE}/v1/listings/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete listing');
}

export async function saveListing(id: string): Promise<void> {
    const res = await fetchWithAuth(`${API_BASE}/v1/listings/${id}/save`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to save listing');
}

export async function unsaveListing(id: string): Promise<void> {
    const res = await fetchWithAuth(`${API_BASE}/v1/listings/${id}/save`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to unsave listing');
}

export async function getMyListings(page = 1): Promise<{ listings: Listing[]; total: number }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/listings/my?page=${page}`);
    if (!res.ok) throw new Error('Failed to fetch listings');
    return res.json();
}

// ============== Orders API ==============
export async function createOrder(listingId: string, bandwidthGb: number): Promise<Order> {
    const res = await fetchWithAuth(`${API_BASE}/v1/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: listingId, bandwidth_gb: bandwidthGb }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Purchase failed');
    }
    return res.json();
}

export async function getMyOrders(page = 1): Promise<{ orders: Order[]; total: number }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/orders?page=${page}`);
    if (!res.ok) throw new Error('Failed to fetch orders');
    return res.json();
}

export async function getMySales(page = 1): Promise<{ sales: Order[]; total: number }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/sales?page=${page}`);
    if (!res.ok) throw new Error('Failed to fetch sales');
    return res.json();
}

// ============== Reviews API ==============
export async function createReview(data: {
    order_id: string;
    rating: number;
    title?: string;
    content?: string;
}): Promise<Review> {
    const res = await fetchWithAuth(`${API_BASE}/v1/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create review');
    return res.json();
}

export async function getUserReviews(userId: string, page = 1): Promise<{ reviews: Review[]; avg_rating: number }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/users/${userId}/reviews?page=${page}`);
    if (!res.ok) throw new Error('Failed to fetch reviews');
    return res.json();
}

export async function getListingReviews(listingId: string, page = 1): Promise<{ reviews: Review[] }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/listings/${listingId}/reviews?page=${page}`);
    if (!res.ok) throw new Error('Failed to fetch reviews');
    return res.json();
}

// ============== Messaging API ==============
export async function getConversations(): Promise<{ conversations: Conversation[] }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/conversations`);
    if (!res.ok) throw new Error('Failed to fetch conversations');
    return res.json();
}

export async function startConversation(recipientId: string, message: string): Promise<Conversation> {
    const res = await fetchWithAuth(`${API_BASE}/v1/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient_id: recipientId, message }),
    });
    if (!res.ok) throw new Error('Failed to start conversation');
    return res.json();
}

export async function getMessages(conversationId: string): Promise<{ messages: Message[] }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/conversations/${conversationId}/messages`);
    if (!res.ok) throw new Error('Failed to fetch messages');
    return res.json();
}

export async function sendMessage(conversationId: string, content: string): Promise<Message> {
    const res = await fetchWithAuth(`${API_BASE}/v1/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error('Failed to send message');
    return res.json();
}

// ============== Feed API ==============
export async function getFeed(page = 1): Promise<{ events: FeedEvent[] }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/feed?page=${page}`);
    if (!res.ok) throw new Error('Failed to fetch feed');
    return res.json();
}

export async function discoverProviders(page = 1): Promise<{ providers: User[] }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/discover?page=${page}`);
    if (!res.ok) throw new Error('Failed to fetch providers');
    return res.json();
}

export async function getTrendingListings(page = 1): Promise<{ listings: Listing[] }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/trending?page=${page}`);
    if (!res.ok) throw new Error('Failed to fetch trending');
    return res.json();
}

// ============== Clans API ==============
export interface Circle {
    id: string;
    name: string;
    description: string;
    owner_id: string;
    visibility: 'public' | 'private';
    member_count: number;
    revenue_share_percent: number;
    created_at: string;
}

export async function createCircle(data: { name: string; description: string; visibility: string; revenue_share_percent: number }): Promise<Circle> {
    const res = await fetchWithAuth(`${API_BASE}/v1/circles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create clan');
    return res.json();
}

export async function getMyCircles(): Promise<{ circles: Circle[] }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/circles/my`);
    if (!res.ok) throw new Error('Failed to fetch clans');
    return res.json();
}

export async function getCircle(id: string): Promise<Circle> {
    const res = await fetchWithAuth(`${API_BASE}/v1/circles/${id}`);
    if (!res.ok) throw new Error('Clan not found');
    return res.json();
}

// ============== Provider Onboarding API ==============
export interface ProviderApplication {
    id: string;
    user_id: string;
    status: 'pending' | 'approved' | 'rejected';
    reason: string;
    isp: string;
    location: string;
    bandwidth: string;
    created_at: string;
}

export async function applyForProvider(data: {
    reason: string;
    isp: string;
    location: string;
    bandwidth: string;
}): Promise<ProviderApplication> {
    const res = await fetchWithAuth(`${API_BASE}/v1/provider/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to submit application');
    }
    return res.json();
}

export async function getProviderApplicationStatus(): Promise<{ status: string; application: ProviderApplication }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/provider/status`);
    if (!res.ok) {
        if (res.status === 404) return { status: 'none', application: null as any };
        throw new Error('Failed to check status');
    }
    return res.json();
}
