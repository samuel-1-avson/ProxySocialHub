import client from './client';

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
    wallet_address?: string;
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
    quality_score: number;
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

// ============== Listings API ==============
export async function getListings(params: {
    proxy_type?: string;
    sort_by?: string;
    page?: number;
    country?: string;
    min_price?: string;
    max_price?: string;
} = {}): Promise<{ listings: Listing[]; total: number }> {
    const res = await client.get('/listings', { params });
    return {
        listings: Array.isArray(res.data?.listings) ? res.data.listings : [],
        total: res.data?.total || 0,
    };
}

export async function getListing(id: string): Promise<{ listing: Listing; is_saved: boolean }> {
    const res = await client.get(`/listings/${id}`);
    return res.data;
}

// ============== Orders API ==============
export async function createOrder(listingId: string, bandwidthGb: number): Promise<Order> {
    const res = await client.post('/orders', { listing_id: listingId, bandwidth_gb: bandwidthGb });
    return res.data;
}

// ============== Social Types ==============
export interface FeedEvent {
    id: string;
    actor_id?: string;
    event_type: string;
    content: string;
    actor?: User;
    created_at: string;
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

export interface Conversation {
    id: string;
    participant1: string;
    participant2: string;
    last_message_at: string;
    other_participant?: User;
    last_message?: Message;
    unread_count?: number;
}

// ============== Feed API ==============
export async function getFeed(page = 1): Promise<{ events: FeedEvent[] }> {
    const res = await client.get(`/feed?page=${page}`);
    return res.data;
}

// ============== Messaging API ==============
export async function getConversations(): Promise<{ conversations: Conversation[] }> {
    const res = await client.get('/conversations');
    return res.data;
}

export async function getMessages(conversationId: string): Promise<{ messages: Message[] }> {
    const res = await client.get(`/conversations/${conversationId}/messages`);
    return res.data;
}

export async function sendMessage(conversationId: string, content: string): Promise<Message> {
    const res = await client.post(`/conversations/${conversationId}/messages`, { content });
    return res.data;
}

export async function startConversation(recipientId: string, message: string): Promise<Conversation> {
    const res = await client.post('/conversations', { recipient_id: recipientId, message });
    return res.data;
}
