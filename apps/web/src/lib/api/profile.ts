/**
 * Single profile client. Public reads use optional auth so anonymous
 * profiles work; mutations still require a session.
 */

import { apiGet, apiPatch, apiDeleteWithBody, optionalAuthGet, authApiFetch } from './client';

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
    is_online?: boolean;
    last_seen_at?: string;
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
    social_links?: Record<string, unknown>;
    skills?: string[];
    business_name?: string;
    kyc_status?: string;
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
    metadata?: unknown;
}

async function throwIfNotOk(response: Response, fallback: string): Promise<void> {
    if (response.ok) return;
    const err = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || fallback);
}

export async function getMyProfile() {
    return apiGet<UserPublicProfile>('/v1/profile');
}

export async function updateProfile(
    data: Partial<UserPublicProfile> & {
        skills?: string[];
        social_links?: Record<string, unknown>;
        business_name?: string;
        professional_title?: string;
        experience_years?: number;
        languages?: string[];
        primary_specialization?: string;
    },
) {
    return apiPatch<UserPublicProfile>('/v1/profile', data);
}

export async function getPublicProfile(identifier: string) {
    if (identifier === 'me') {
        return getMyProfile();
    }
    return optionalAuthGet<UserPublicProfile>(`/v1/users/${encodeURIComponent(identifier)}`);
}

/** Alias used by ProfileView. */
export async function getProfile(id: string): Promise<UserPublicProfile> {
    return getPublicProfile(id);
}

export async function followUser(id: string): Promise<void> {
    const response = await authApiFetch(`/v1/users/${id}/follow`, { method: 'POST' });
    await throwIfNotOk(response, 'Failed to follow user');
}

export async function unfollowUser(id: string): Promise<void> {
    const response = await authApiFetch(`/v1/users/${id}/follow`, { method: 'DELETE' });
    await throwIfNotOk(response, 'Failed to unfollow user');
}

export async function blockUser(id: string): Promise<void> {
    const response = await authApiFetch(`/v1/users/${id}/block`, { method: 'POST' });
    await throwIfNotOk(response, 'Failed to block user');
}

export async function unblockUser(id: string): Promise<void> {
    const response = await authApiFetch(`/v1/users/${id}/block`, { method: 'DELETE' });
    await throwIfNotOk(response, 'Failed to unblock user');
}

export async function getUserActivity(id: string): Promise<ActivityEvent[]> {
    const response = await authApiFetch(`/v1/users/${id}/activity`);
    await throwIfNotOk(response, 'Failed to fetch activity');
    const data = (await response.json()) as { activity?: ActivityEvent[] };
    return data.activity || [];
}

export async function getUserReviews(userId: string, page = 1): Promise<{ reviews: Review[]; avg_rating: number }> {
    return optionalAuthGet<{ reviews: Review[]; avg_rating: number }>(
        `/v1/users/${encodeURIComponent(userId)}/reviews`,
        { page: String(page) },
    );
}

export async function deleteAccount(
    confirmation: string,
    opts?: { nonce?: string; signature?: string; google_credential?: string; code?: string },
): Promise<void> {
    await apiDeleteWithBody('/v1/gdpr/delete-account', {
        confirmation,
        nonce: opts?.nonce,
        signature: opts?.signature,
        google_credential: opts?.google_credential,
        code: opts?.code,
    });
}

export async function exportAccountData(): Promise<Blob> {
    const response = await authApiFetch('/v1/gdpr/export');
    await throwIfNotOk(response, 'Failed to export account data');
    return response.blob();
}
