/**
 * Social & Messaging API Module
 * Direct messaging, friendship and social feed events
 */

import { apiGet, apiPost } from './client';

export interface SocialUserSummary {
    id: string;
    display_name?: string;
    username?: string;
    avatar_url?: string;
}

export interface Message {
    id: string;
    conversation_id: string;
    sender_id: string;
    content: string;
    read_at?: string;
    created_at: string;
    type?: string;
    reply_to_id?: string;
    edited_at?: string;
    is_deleted?: boolean;
    reactions?: Array<{
        message_id?: string;
        user_id: string;
        emoji: string;
        created_at: string;
    }>;
}

export interface ConversationWithPreview {
    id: string;
    /** The API sends these on the row itself, not under `conversation`. */
    participant1?: string;
    participant2?: string;
    last_message_at?: string;
    created_at?: string;
    conversation: {
        id: string;
        participants?: string[];
        created_at?: string;
        updated_at?: string;
    };
    other_participant_name: string;
    other_participant?: SocialUserSummary;
    last_message?: Message;
    unread_count: number;
}

export interface Friendship {
    id: string;
    user_id?: string;
    friend_id: string;
    username?: string;
    avatar_url?: string;
    status: 'active' | 'pending' | 'accepted';
    friend?: SocialUserSummary;
    created_at?: string;
}

export interface FeedEvent {
    id: string;
    actor_id?: string;
    actor_name: string;
    actor?: SocialUserSummary;
    event_type: 'listing_published' | 'node_active' | 'order_completed' | string;
    content: string;
    metadata?: Record<string, unknown>;
    created_at: string;
}

type RawConversation = ConversationWithPreview & {
    conversation?: ConversationWithPreview['conversation'];
    conversation_id?: string;
    other_participant?: SocialUserSummary;
};

type RawFriendship = Friendship & {
    friend?: SocialUserSummary;
};

type RawFeedEvent = FeedEvent & {
    actor?: SocialUserSummary;
};

function normalizeUserSummary(value: unknown, fallbackName = 'Unknown'): SocialUserSummary | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const record = value as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    const displayName = typeof record.display_name === 'string' ? record.display_name : undefined;
    const username = typeof record.username === 'string' ? record.username : undefined;
    const avatarUrl = typeof record.avatar_url === 'string' ? record.avatar_url : undefined;

    if (!id && !displayName && !username && !avatarUrl) {
        return undefined;
    }

    return {
        id,
        display_name: displayName ?? username ?? fallbackName,
        username,
        avatar_url: avatarUrl,
    };
}

function normalizeConversation(conversation: RawConversation): ConversationWithPreview {
    const conversationId =
        conversation.conversation?.id ||
        conversation.conversation_id ||
        conversation.id;

    const otherParticipant = normalizeUserSummary(
        conversation.other_participant,
        conversation.other_participant_name || 'Unknown'
    );

    return {
        id: conversationId,
        participant1: conversation.participant1,
        participant2: conversation.participant2,
        last_message_at: conversation.last_message_at,
        created_at: conversation.created_at,
        conversation: {
            id: conversationId,
            participants: conversation.conversation?.participants,
            created_at: conversation.conversation?.created_at,
            updated_at: conversation.conversation?.updated_at,
        },
        other_participant_name:
            conversation.other_participant_name ||
            otherParticipant?.display_name ||
            otherParticipant?.username ||
            'Unknown',
        other_participant: otherParticipant,
        last_message: conversation.last_message,
        unread_count: Number(conversation.unread_count || 0),
    };
}

function normalizeFriendship(friendship: RawFriendship): Friendship {
    const friend = normalizeUserSummary(friendship.friend, friendship.username || 'Friend');
    const friendId = friendship.friend_id || friend?.id || friendship.user_id || friendship.id;

    return {
        id: friendship.id,
        user_id: friendship.user_id || friend?.id,
        friend_id: friendId,
        username: friendship.username || friend?.username || friend?.display_name,
        avatar_url: friendship.avatar_url || friend?.avatar_url,
        status: friendship.status || 'active',
        friend,
        created_at: friendship.created_at,
    };
}

function normalizeFeedEvent(event: RawFeedEvent): FeedEvent {
    const actor = normalizeUserSummary(event.actor, event.actor_name || 'Unknown User');

    return {
        id: event.id,
        actor_id: event.actor_id || actor?.id,
        actor_name: event.actor_name || actor?.display_name || actor?.username || 'Unknown User',
        actor,
        event_type: event.event_type,
        content: event.content,
        metadata: event.metadata,
        created_at: event.created_at,
    };
}

/**
 * Get unified social feed
 */
export async function getFeed() {
    const data = await apiGet<{ events?: RawFeedEvent[] } | RawFeedEvent[]>('/v1/feed');
    const events = Array.isArray(data) ? data : data.events || [];
    return events.map(normalizeFeedEvent);
}

/**
 * List active user conversations
 */
export async function getConversations(page = 1) {
    const data = await apiGet<{ conversations?: RawConversation[]; total?: number; limit?: number } | RawConversation[]>(
        '/v1/conversations',
        page > 1 ? { page: String(page) } : undefined,
    );
    const conversations = Array.isArray(data) ? data : data.conversations || [];
    return conversations.map(normalizeConversation);
}

/** Conversations come 20 to a page; this is how far a link to one looks. */
const CONVERSATION_PAGE_SIZE = 20;
const MAX_CONVERSATION_PAGES = 10;

/** Find one conversation by id, however far down the list it is. */
export async function findConversation(id: string) {
    for (let page = 1; page <= MAX_CONVERSATION_PAGES; page += 1) {
        const rows = await getConversations(page);
        const found = rows.find((row) => row.id === id);
        if (found) return found;
        if (rows.length < CONVERSATION_PAGE_SIZE) return undefined;
    }
    return undefined;
}

/**
 * Fetch one page of messages. The API sends the newest first; they come back
 * oldest first, the order a thread reads in.
 */
export async function getMessages(conversationId: string, page = 1): Promise<MessagesPage> {
    const data = await apiGet<{ messages?: Message[]; total?: number; page?: number; limit?: number }>(
        `/v1/conversations/${conversationId}/messages`,
        page > 1 ? { page: String(page) } : undefined,
    );
    const messages = [...(data.messages || [])].reverse();
    return {
        messages,
        total: Number(data.total ?? messages.length),
        page: Number(data.page ?? page),
        limit: Number(data.limit ?? 50),
    };
}

/** Mark everything the other person sent in a conversation as read. */
export async function markConversationRead(conversationId: string) {
    await apiPost<unknown>(`/v1/conversations/${conversationId}/read`, {});
}

/**
 * Send a message to a conversation
 */
export async function sendMessage(conversationId: string, content: string, clientMsgId?: string) {
    return apiPost<Message>(`/v1/conversations/${conversationId}/messages`, {
        content,
        ...(clientMsgId ? { client_msg_id: clientMsgId } : {}),
    });
}

/**
 * Initialize a new chat session
 */
export async function startConversation(recipientId: string, message = '', clientMsgId?: string) {
    const data = await apiPost<{ id?: string; conversation_id?: string; conversation?: { id?: string } }>(
        '/v1/conversations',
        { recipient_id: recipientId, message, ...(clientMsgId ? { client_msg_id: clientMsgId } : {}) }
    );

    const conversationId = data.conversation_id || data.id || data.conversation?.id || '';
    return {
        id: conversationId,
        conversation_id: conversationId,
    };
}

/**
 * List verified friends for session sharing
 */
export async function listFriends() {
    const data = await apiGet<RawFriendship[] | { friends?: RawFriendship[] }>('/v1/friends');
    const friends = Array.isArray(data) ? data : data.friends || [];
    return friends.map(normalizeFriendship);
}
