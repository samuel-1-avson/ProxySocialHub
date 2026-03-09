// Friends API - Social connections
import { fetchWithAuth } from "./auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

// ============== Types ==============

export interface FriendRequest {
    id: string;
    sender_id: string;
    receiver_id: string;
    status: "pending" | "accepted" | "rejected";
    created_at: string;
    updated_at: string;
    sender?: {
        id: string;
        username: string;
        display_name?: string;
        avatar_url?: string;
    };
    receiver?: {
        id: string;
        username: string;
        display_name?: string;
        avatar_url?: string;
    };
}

export interface Friendship {
    id: string;
    user_id: string;
    friend_id: string;
    created_at: string;
    friend?: {
        id: string;
        username: string;
        display_name?: string;
        avatar_url?: string;
        is_online?: boolean;
        last_seen_at?: string;
    };
}

export interface SuggestedUser {
    id: string;
    username: string;
    display_name?: string;
    avatar_url?: string;
    bio?: string;
    reason: string;
    score: number;
    mutual_count?: number;
    is_following?: boolean;
}

// ============== Friend Requests ==============

export async function sendFriendRequest(userId: string): Promise<FriendRequest> {
    const res = await fetchWithAuth(`${API_BASE}/v1/friends/request/${userId}`, {
        method: "POST",
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to send friend request");
    }
    return res.json();
}

export async function acceptFriendRequest(requestId: string): Promise<{ message: string }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/friends/request/${requestId}/accept`, {
        method: "PUT",
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to accept friend request");
    }
    return res.json();
}

export async function rejectFriendRequest(requestId: string): Promise<{ message: string }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/friends/request/${requestId}/reject`, {
        method: "PUT",
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to reject friend request");
    }
    return res.json();
}

export async function cancelFriendRequest(requestId: string): Promise<{ message: string }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/friends/request/${requestId}`, {
        method: "DELETE",
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to cancel friend request");
    }
    return res.json();
}

export async function getFriendRequests(): Promise<{
    incoming: FriendRequest[];
    outgoing: FriendRequest[];
}> {
    const res = await fetchWithAuth(`${API_BASE}/v1/friends/requests`);
    if (!res.ok) {
        if (res.status === 404) return { incoming: [], outgoing: [] };
        throw new Error("Failed to fetch friend requests");
    }
    return res.json();
}

// ============== Friends ==============

export async function getFriends(): Promise<{ friends: Friendship[] }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/friends`);
    if (!res.ok) {
        if (res.status === 404) return { friends: [] };
        throw new Error("Failed to fetch friends");
    }
    return res.json();
}

export async function removeFriend(friendId: string): Promise<{ message: string }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/friends/${friendId}`, {
        method: "DELETE",
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to remove friend");
    }
    return res.json();
}

export async function getFriendshipStatus(userId: string): Promise<{
    status: "none" | "friends" | "request_sent" | "request_received";
    request_id?: string;
}> {
    const res = await fetchWithAuth(`${API_BASE}/v1/friends/status/${userId}`);
    if (!res.ok) {
        if (res.status === 404) return { status: "none" };
        throw new Error("Failed to fetch friendship status");
    }
    return res.json();
}

// ============== Discovery ==============

export async function getPeopleYouMayKnow(limit = 10): Promise<{ suggestions: SuggestedUser[] }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/discover/people?limit=${limit}`);
    if (!res.ok) {
        if (res.status === 404) return { suggestions: [] };
        throw new Error("Failed to fetch suggestions");
    }
    return res.json();
}

export async function getMutualFriends(userId: string): Promise<{ friends: Friendship[]; count: number }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/users/${userId}/mutual-friends`);
    if (!res.ok) {
        if (res.status === 404) return { friends: [], count: 0 };
        throw new Error("Failed to fetch mutual friends");
    }
    return res.json();
}
