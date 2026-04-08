/**
 * Presence API Module
 * Real-time online status and heartbeat management
 */

import { apiGet, apiPost } from './client';

// ============ Types ============

export interface PresenceStatus {
    user_id: string;
    is_online: boolean;
    last_seen_at: string;
    last_activity_at?: string;
    status_message?: string;
}

export interface ProviderPresence extends PresenceStatus {
    provider_name: string;
    provider_avatar?: string;
    response_time_avg_min: number;
    current_sessions_count: number;
}

export interface HeartbeatResponse {
    status: string;
    server_time: string;
    next_heartbeat_seconds: number;
}

export interface PresenceBatchResponse {
    users: Record<string, PresenceStatus>;
    not_found?: string[];
}

export interface UpdatePresenceRequest {
    is_online?: boolean;
    status_message?: string;
    current_activity?: string;
}

// ============ Heartbeat APIs ============

/**
 * Send heartbeat to keep session alive and update online status
 * Should be called every 30 seconds when user is active
 */
export async function sendHeartbeat(activity?: string): Promise<HeartbeatResponse> {
    return apiPost<HeartbeatResponse>('/v1/presence/heartbeat', {
        activity: activity || 'active',
        timestamp: new Date().toISOString(),
    });
}

/**
 * Send provider-specific heartbeat (includes node metrics)
 */
export async function sendProviderHeartbeat(
    nodeId: string,
    metrics?: {
        latency_ms?: number;
        active_connections?: number;
        uptime_percent?: number;
        bandwidth_utilization?: number;
    }
): Promise<HeartbeatResponse> {
    return apiPost<HeartbeatResponse>('/v1/presence/heartbeat', {
        node_id: nodeId,
        metrics: metrics || {},
        timestamp: new Date().toISOString(),
    });
}

// ============ Status APIs ============

/**
 * Get online status for a specific user
 */
export async function getUserPresence(userId: string): Promise<PresenceStatus> {
    return apiGet<PresenceStatus>(`/v1/users/${userId}/presence`);
}

/**
 * Get online status for multiple users (batch)
 */
export async function getBatchPresence(userIds: string[]): Promise<PresenceBatchResponse> {
    const users = await Promise.all(
        userIds.map(async (userId) => {
            try {
                const presence = await getUserPresence(userId);
                return [userId, presence] as const;
            } catch {
                return null;
            }
        })
    );

    const map: Record<string, PresenceStatus> = {};
    const notFound: string[] = [];

    users.forEach((entry) => {
        if (!entry) return;
        map[entry[0]] = entry[1];
    });

    userIds.forEach((id) => {
        if (!map[id]) notFound.push(id);
    });

    return { users: map, not_found: notFound };
}

/**
 * Get provider presence info (for marketplace listings)
 */
export async function getProviderPresence(providerId: string): Promise<ProviderPresence> {
    const base = await getUserPresence(providerId);
    return {
        ...base,
        provider_name: 'Provider',
        response_time_avg_min: 0,
        current_sessions_count: 0,
    };
}

// ============ Self Status APIs ============

/**
 * Update own presence status
 */
export async function updatePresence(request: UpdatePresenceRequest): Promise<PresenceStatus> {
    await apiPost<HeartbeatResponse>('/v1/presence/heartbeat', {
        activity: request.current_activity || request.status_message || 'active',
        timestamp: new Date().toISOString(),
    });
    return getMyPresence();
}

/**
 * Go offline (explicit logout/away)
 */
export async function setOffline(): Promise<{ message: string }> {
    await apiPost<HeartbeatResponse>('/v1/presence/heartbeat', {
        activity: 'offline',
        timestamp: new Date().toISOString(),
    });
    return { message: 'Presence updated' };
}

/**
 * Get my current presence status
 */
export async function getMyPresence(): Promise<PresenceStatus> {
    const me = await apiGet<{ id: string }>('/v1/auth/me');
    return getUserPresence(me.id);
}

// ============ Query Keys ============

export const presenceKeys = {
    all: ['presence'] as const,
    user: (userId: string) => [...presenceKeys.all, 'user', userId] as const,
    provider: (providerId: string) => [...presenceKeys.all, 'provider', providerId] as const,
    batch: (userIds: string[]) => [...presenceKeys.all, 'batch', userIds.sort().join(',')] as const,
    me: () => [...presenceKeys.all, 'me'] as const,
};

// ============ WebSocket/Realtime Helpers ============

export interface PresenceWebSocketMessage {
    type: 'presence_update' | 'heartbeat_ack' | 'user_online' | 'user_offline';
    user_id: string;
    is_online: boolean;
    timestamp: string;
}

/**
 * Hook-compatible function to subscribe to presence updates
 * Returns cleanup function
 */
export function subscribeToPresenceUpdates(
    onUpdate: (update: PresenceWebSocketMessage) => void
): () => void {
    // Note: This is a placeholder. Actual implementation would use WebSocket
    // or Server-Sent Events connection to receive real-time updates
    const ws = new WebSocket(
        `${process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8081'}/v1/ws`
    );
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        onUpdate(data);
    };
    
    return () => ws.close();
}

// ============ Helpers ============

export function isUserOnline(presence: PresenceStatus | null | undefined): boolean {
    if (!presence) return false;
    return presence.is_online;
}

export function getLastSeenText(presence: PresenceStatus | null | undefined): string {
    if (!presence) return 'Unknown';
    if (presence.is_online) return 'Online now';
    
    const lastSeen = new Date(presence.last_seen_at);
    const now = new Date();
    const diffMinutes = Math.floor((now.getTime() - lastSeen.getTime()) / (1000 * 60));
    
    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)}h ago`;
    return `${Math.floor(diffMinutes / 1440)}d ago`;
}

export function getOnlineStatusColor(isOnline: boolean): string {
    return isOnline ? 'text-emerald-400' : 'text-gray-400';
}

export function getOnlineStatusBg(isOnline: boolean): string {
    return isOnline ? 'bg-emerald-500' : 'bg-gray-500';
}

/**
 * Auto-send heartbeat at regular intervals
 * Returns cleanup function to stop the interval
 */
export function startHeartbeatInterval(
    intervalSeconds = 30,
    onHeartbeat?: (response: HeartbeatResponse) => void,
    onError?: (error: Error) => void
): () => void {
    const triggerHeartbeat = async () => {
        try {
            const response = await sendHeartbeat();
            onHeartbeat?.(response);
        } catch (error) {
            onError?.(error as Error);
        }
    };
    
    // Send initial heartbeat
    triggerHeartbeat();
    
    // Set up interval
    const intervalId = setInterval(triggerHeartbeat, intervalSeconds * 1000);
    
    // Return cleanup function
    return () => clearInterval(intervalId);
}
