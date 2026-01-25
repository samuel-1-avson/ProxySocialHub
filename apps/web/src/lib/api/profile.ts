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
    bio?: string;
    rating: number;
    verified: boolean;
    created_at: string;
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
