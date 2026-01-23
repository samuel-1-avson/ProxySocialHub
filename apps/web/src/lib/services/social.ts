import { API_BASE_URL, fetchWithAuth } from './client';

// Circles
export interface Circle {
    id: string;
    name: string;
    description: string;
    visibility: 'public' | 'private';
    member_count: number;
}

export async function getCircles(): Promise<Circle[]> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/circles/`);
    if (!response.ok) throw new Error('Failed to fetch circles');
    const data = await response.json();
    return data.circles;
}

export async function getCircle(id: string): Promise<Circle> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/circles/${id}`);
    if (!response.ok) throw new Error('Failed to fetch circle');
    const data = await response.json();
    return data.circle;
}

// Forum
export interface ForumThread {
    id: string;
    title: string;
    content: string;
    created_at: string;
    author: any;
}

export async function getForumCategories(): Promise<any> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/forum/categories`);
    if (!response.ok) throw new Error('Failed to fetch categories');
    return response.json();
}

// Friends
export interface Friendship {
    id: string;
    user_id: string;
    friend_id: string;
    status: 'pending' | 'accepted';
    created_at: string;
    friend?: any; // UserPublicProfile
}

export async function listFriends(): Promise<Friendship[]> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/social/friends`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.friends || [];
}

export async function getFriendRequests(): Promise<Friendship[]> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/social/friends/requests`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.requests || [];
}

// Chat / Messaging
export interface Message {
    id: string;
    conversation_id: string;
    sender_id: string;
    content: string;
    created_at: string;
    is_read: boolean;
}

export interface Conversation {
    id: string;
    participants: string[];
    created_at: string;
    updated_at: string;
}

export interface ConversationWithPreview {
    conversation: Conversation;
    last_message?: Message;
    unread_count: number;
    other_participant?: {
        id: string;
        display_name: string;
        avatar_url?: string;
    };
}

export async function getConversations(): Promise<ConversationWithPreview[]> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/social/conversations`);
    if (!response.ok) throw new Error('Failed to fetch conversations');
    const data = await response.json();
    return data.conversations || [];
}

export async function startConversation(userId: string): Promise<Conversation> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/social/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
    });
    if (!response.ok) throw new Error('Failed to start conversation');
    const data = await response.json();
    return data.conversation;
}

export async function getMessages(conversationId: string, page = 1): Promise<Message[]> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/social/conversations/${conversationId}/messages?page=${page}`);
    if (!response.ok) throw new Error('Failed to fetch messages');
    const data = await response.json();
    return data.messages || [];
}

export async function sendMessage(conversationId: string, content: string): Promise<Message> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/social/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
    });
    if (!response.ok) throw new Error('Failed to send message');
    const data = await response.json();
    return data.message;
}
