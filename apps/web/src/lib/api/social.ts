/**
 * Social & Messaging API Module
 * Direct messaging, friendship and social feed events
 */

import { apiGet, apiPost } from './client';

export interface Message {
    id: string;
    conversation_id: string;
    sender_id: string;
    content: string;
    read_at?: string;
    created_at: string;
}

export interface ConversationWithPreview {
    id: string;
    other_participant_name: string;
    last_message?: Message;
    unread_count: number;
}

export interface Friendship {
    id: string;
    friend_id: string;
    username: string;
    avatar_url?: string;
    status: 'active' | 'pending';
}

export interface FeedEvent {
    id: string;
    actor_name: string;
    event_type: 'listing_published' | 'node_active' | 'order_completed' | string;
    content: string;
    created_at: string;
}

/**
 * Get unified social feed
 */
export async function getFeed() {
    const data = await apiGet<{ events: FeedEvent[] }>('/v1/feed');
    return data.events || [];
}

/**
 * List active user conversations
 */
export async function getConversations() {
    const data = await apiGet<{ conversations: ConversationWithPreview[] }>('/v1/conversations');
    return data.conversations || [];
}

/**
 * Fetch messages from a specific conversation
 */
export async function getMessages(conversationId: string) {
    const data = await apiGet<{ messages: Message[] }>(`/v1/conversations/${conversationId}/messages`);
    return data.messages || [];
}

/**
 * Send a message to a conversation
 */
export async function sendMessage(conversationId: string, content: string) {
    return apiPost<Message>(`/v1/conversations/${conversationId}/messages`, { content });
}

/**
 * Initialize a new chat session
 */
export async function startConversation(recipientId: string, message: string) {
    const data = await apiPost<{ id: string } | { conversation_id: string }>(
        '/v1/conversations',
        { recipient_id: recipientId, message }
    );
    if ('conversation_id' in data) {
        return { conversation_id: data.conversation_id };
    }
    return { conversation_id: data.id };
}

/**
 * List verified friends for session sharing
 */
export async function listFriends() {
    const data = await apiGet<Friendship[] | { friends: Friendship[] }>('/v1/friends');
    return Array.isArray(data) ? data : data.friends || [];
}
