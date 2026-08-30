// Social API - ProxySocialHub marketplace features
import { fetchWithAuth } from './auth';

const API_BASE = ''; // relative — proxied by Next.js rewrite in next.config.ts

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
    proxy_type: 'residential' | 'mobile' | 'datacenter' | 'rotating' | 'sticky' | 'both';
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
    // Enhanced messaging fields
    type?: "text" | "image" | "file" | "system";
    reply_to_id?: string;
    edited_at?: string;
    is_deleted?: boolean;
    attachments?: Attachment[];
    reactions?: Reaction[];
}

export interface Attachment {
    id: string;
    type: "image" | "document" | "contract";
    url: string;
    file_name?: string;
    file_size?: number;
    mime_type?: string;
}

export interface Reaction {
    user_id: string;
    emoji: string;
    created_at: string;
}

export interface FeedEvent {
    id: string;
    actor_id?: string;
    event_type: string;
    target_type?: string;
    target_id?: string;
    content: string;
    metadata?: Record<string, unknown>;
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

// Profile reads/writes: import from @/lib/api/profile

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
    const data = await res.json();
    return {
        listings: Array.isArray(data?.listings) ? data.listings : [],
        total: data?.total || 0
    };
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

// ============== Messaging API (canonical transport: @/lib/api/social) ==============
export {
    getConversationsNormalized as getConversations,
    getMessagesNormalized as getMessages,
    sendMessageNormalized as sendMessage,
    startConversationNormalized as startConversation,
} from '@/lib/messaging/social-messaging';

// Enhanced Messaging API
export async function editMessage(conversationId: string, messageId: string, content: string): Promise<Message> {
    const res = await fetchWithAuth(`${API_BASE}/v1/conversations/${conversationId}/messages/${messageId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error('Failed to edit message');
    return res.json();
}

export async function deleteMessage(conversationId: string, messageId: string): Promise<{ message: string }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/conversations/${conversationId}/messages/${messageId}`, {
        method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete message');
    return res.json();
}

export async function addReaction(messageId: string, emoji: string): Promise<Reaction> {
    const res = await fetchWithAuth(`${API_BASE}/v1/messages/${messageId}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
    });
    if (!res.ok) throw new Error('Failed to add reaction');
    return res.json();
}

export async function removeReaction(messageId: string, emoji: string): Promise<{ message: string }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/messages/${messageId}/reactions/${emoji}`, {
        method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to remove reaction');
    return res.json();
}

export async function uploadAttachment(conversationId: string, file: File): Promise<Attachment> {
    const formData = new FormData();
    formData.append('file', file);
    
    const res = await fetchWithAuth(`${API_BASE}/v1/conversations/${conversationId}/attachments`, {
        method: 'POST',
        body: formData,
    });
    if (!res.ok) throw new Error('Failed to upload attachment');
    return res.json();
}

export async function searchMessages(conversationId: string, query: string): Promise<{ messages: Message[] }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/conversations/${conversationId}/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('Failed to search messages');
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

export interface CircleMember {
    user_id: string;
    circle_id: string;
    role: 'owner' | 'admin' | 'member';
    status: 'active' | 'pending';
    joined_at: string;
    user?: User;
}

export async function getCircleMembers(id: string): Promise<{ members: CircleMember[]; count: number }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/circles/${id}/members`);
    if (!res.ok) throw new Error('Failed to fetch members');
    return res.json();
}

export async function inviteToCircle(circleId: string, userId: string): Promise<{ invite_id: string }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/circles/${circleId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
    });
    if (!res.ok) throw new Error('Failed to invite user');
    return res.json();
}

export async function joinCircle(circleId: string): Promise<void> {
    const res = await fetchWithAuth(`${API_BASE}/v1/circles/${circleId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });

    if (!res.ok) throw new Error('Failed to join circle');
}

export interface CirclePost {
    id: string;
    circle_id: string;
    author_id: string;
    content: string;
    pinned: boolean;
    created_at: string;
    author?: User;
}

export async function getCircleFeed(id: string): Promise<{ posts: CirclePost[] }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/circles/${id}/feed`);
    if (!res.ok) throw new Error('Failed to fetch feed');
    return res.json();
}

export async function postToCircleFeed(id: string, content: string): Promise<{ post: CirclePost }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/circles/${id}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error('Failed to post to feed');
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

// ============== Governance API ==============
export interface Proposal {
    id: string;
    title: string;
    description: string;
    proposer_id: string;
    start_time: string;
    end_time: string;
    status: 'active' | 'passed' | 'rejected' | 'executed';
    yes_votes: number;
    no_votes: number;
    proposer?: User;
    created_at: string;
    ipfs_hash?: string;
}

export async function getProposals(status?: string): Promise<{ proposals: Proposal[] }> {
    const query = status ? `?status=${status}` : '';
    const res = await fetchWithAuth(`${API_BASE}/v1/governance/proposals${query}`);
    if (!res.ok) throw new Error('Failed to fetch proposals');
    return res.json();
}

export async function getProposal(id: string): Promise<Proposal> {
    const res = await fetchWithAuth(`${API_BASE}/v1/governance/proposals/${id}`);
    if (!res.ok) throw new Error('Proposal not found');
    return res.json();
}

export async function createProposal(data: { title: string; description: string; duration_days: number }): Promise<Proposal> {
    const res = await fetchWithAuth(`${API_BASE}/v1/governance/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create proposal');
    return res.json();
}

export async function castVote(id: string, choice: 'yes' | 'no' | 'abstain'): Promise<{ message: string; power: number }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/governance/proposals/${id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice }),
    });
    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to cast vote');
    }
    return res.json();
}
