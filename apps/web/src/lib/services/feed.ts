import { API_BASE_URL, fetchWithAuth } from './client';
import { UserPublicProfile } from './profile';

export interface FeedEvent {
    id: string;
    actor_id?: string;
    event_type: 'new_node' | 'whale_alert' | 'governance_proposal' | 'node_purchase' | 'review' | 'system';
    content: string;
    actor?: UserPublicProfile;
    metadata?: any;
    created_at: string;
}

export async function getFeed(page = 1): Promise<{ events: FeedEvent[] }> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/feed?page=${page}`);
    if (!response.ok) throw new Error('Failed to fetch feed');
    return response.json();
}

type FeedCallback = (event: FeedEvent) => void;

// Simple polling simulation for Real-time if WS not available
// In production, replace with Supabase Realtime or WS connection
export function subscribeToFeed(callback: FeedCallback): () => void {
    const interval = setInterval(async () => {
        try {
            // In a real polling scenario, we'd ask for events since last known ID.
            // For now, we'll just re-fetch the latest and see if there's anything new 
            // coupled with a local cache check (omitted for brevity)
            // or just rely on manual refresh for now to avoid spamming.

            // To properly simulate "push", we might just return.
            // Or we can implement a lightweight poll.
        } catch (e) {
            console.error(e);
        }
    }, 10000);

    return () => clearInterval(interval);
}

export async function getWhaleAlerts(): Promise<FeedEvent[]> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/feed/whales`);
    if (!response.ok) throw new Error('Failed to fetch whale alerts');
    const data = await response.json();
    return data.alerts || [];
}
