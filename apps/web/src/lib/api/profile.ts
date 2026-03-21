/**
 * Profile API Module
 * User authentication and public identity management
 */

import { apiGet, apiPatch } from './client';

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
}

/**
 * Get authenticated user's private profile
 */
export async function getMyProfile() {
    return apiGet<UserPublicProfile>('/v1/profile');
}

/**
 * Update user's profile metadata
 */
export async function updateProfile(data: Partial<UserPublicProfile>) {
    return apiPatch<UserPublicProfile>('/v1/profile', data);
}

/**
 * Fetch a public profile by username or ID
 */
export async function getPublicProfile(identifier: string) {
    return apiGet<UserPublicProfile>(`/v1/users/${identifier}`);
}
