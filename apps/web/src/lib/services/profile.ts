import { API_BASE_URL, fetchWithAuth } from './client';

export interface UserPublicProfile {
    id: string;
    username: string;
    display_name?: string;
    avatar_url?: string;
    cover_image_url?: string;
    location?: string;
    website?: string;
    bio?: string;
    role: string;
    verified: boolean;
    followers_count: number;
    following_count: number;
    reviews_count: number;
    avg_rating: number;
    provider_since?: string;
    total_bandwidth_sold: number;
    trust_tier: string;
    created_at: string;
    is_following?: boolean;
    is_blocked?: boolean;
    professional_title?: string;
    experience_years: number;
    languages?: string[];
    primary_specialization?: string;
    social_links?: Record<string, any>;
    skills?: string[];
    business_name?: string;
    tax_id?: string;
    isp?: string;
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
    reviewer?: UserPublicProfile;
    created_at: string;
}

export interface ActivityEvent {
    id: string;
    actor_id: string;
    event_type: string;
    content: string;
    created_at: string;
    target_type?: string;
    target_id?: string;
    metadata?: any;
}

export async function getProfile(id: string): Promise<UserPublicProfile> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/users/${id}`);
    if (!response.ok) throw new Error('Failed to fetch profile');
    return response.json();
}

export async function getMyProfile(): Promise<UserPublicProfile> {
    return getProfile('me');
}

export async function updateProfile(data: Partial<UserPublicProfile> & { 
    skills?: string[], 
    social_links?: any, 
    business_name?: string,
    tax_id?: string,
    professional_title?: string,
    experience_years?: number,
    languages?: string[],
    primary_specialization?: string,
    isp?: string
}): Promise<UserPublicProfile> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to update profile');
    return response.json();
}

export async function followUser(id: string): Promise<void> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/users/${id}/follow`, { method: 'POST' });
    if (!response.ok) throw new Error('Failed to follow user');
}

export async function unfollowUser(id: string): Promise<void> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/users/${id}/follow`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Failed to unfollow user');
}

export async function blockUser(id: string): Promise<void> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/users/${id}/block`, { method: 'POST' });
    if (!response.ok) throw new Error('Failed to block user');
}

export async function unblockUser(id: string): Promise<void> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/users/${id}/block`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Failed to unblock user');
}

export async function getUserActivity(id: string): Promise<ActivityEvent[]> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/users/${id}/activity`);
    if (!response.ok) throw new Error('Failed to fetch activity');
    const data = await response.json();
    return data.activity || [];
}

export async function getUserReviews(userId: string, page = 1): Promise<{ reviews: Review[]; avg_rating: number }> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/users/${userId}/reviews?page=${page}`);
    if (!response.ok) throw new Error('Failed to fetch reviews');
    return response.json();
}
