import { getAccessTokenSilently } from '@/lib/auth';
import { authApiPost, publicApiGet } from '@/lib/api/client';
import type { ForumThread } from '@/lib/forum-api';

export interface ListingSocialProvider {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string;
    is_online: boolean;
    last_seen_at?: string;
    avg_rating: number;
    reviews_count: number;
    total_bandwidth_sold: number;
    response_time_min: number;
}

export interface ListingSocialContext {
    listing_id: string;
    active_sessions_count: number;
    total_sessions_count: number;
    allow_direct_message: boolean;
    provider: ListingSocialProvider;
    is_followed: boolean;
    has_existing_session: boolean;
    existing_session_id?: string;
}

export async function fetchListingSocialContext(
    listingId: string
): Promise<ListingSocialContext | null> {
    if (!listingId) return null;

    const headers: HeadersInit = {};
    try {
        const token = await getAccessTokenSilently();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
    } catch {
        // Public context still works without auth (follow state omitted).
    }

    const response = await fetch(`/v1/listings/${listingId}/social`, { headers });
    if (!response.ok) {
        return null;
    }
    return response.json();
}

export interface ListingQAResponse {
    questions: ForumThread[];
    count: number;
}

export async function fetchListingQA(listingId: string): Promise<ListingQAResponse> {
    return publicApiGet<ListingQAResponse>(`/v1/listings/${listingId}/qa`);
}

export async function askListingQuestion(
    listingId: string,
    payload: { title: string; content: string }
): Promise<ForumThread> {
    return authApiPost<ForumThread>(`/v1/listings/${listingId}/qa`, payload);
}
