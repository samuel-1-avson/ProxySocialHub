import { getFeed as getSocialFeed, type FeedEvent } from '@/lib/social-api';
import { API_BASE_URL, fetchWithAuth } from './client';

export type { FeedEvent };

export async function getFeed(page = 1): Promise<{ events: FeedEvent[] }> {
    return getSocialFeed(page);
}

export async function getWhaleAlerts(): Promise<FeedEvent[]> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/feed/whales`);
    if (!response.ok) throw new Error('Failed to fetch whale alerts');
    const data = await response.json();
    return data.alerts || [];
}
