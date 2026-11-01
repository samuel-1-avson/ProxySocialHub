/**
 * Canonical messaging adapters — normalizes `/v1/conversations` via `@/lib/api/social`.
 * Enhanced features (reactions, attachments) stay on `@/lib/social-api`.
 */

import {
    getConversations as fetchConversations,
    getMessages as fetchMessages,
    startConversation as postStartConversation,
    type ConversationWithPreview,
    type Message as ApiMessage,
    type SocialUserSummary,
} from "@/lib/api/social";
import { apiPost } from "@/lib/api/client";
import type { Conversation, Message, User } from "@/lib/social-api";

function toSocialUser(summary?: SocialUserSummary): User | undefined {
    if (!summary?.id) return undefined;
    return {
        id: summary.id,
        email: "",
        role: "user",
        username: summary.username,
        display_name: summary.display_name,
        avatar_url: summary.avatar_url,
        verified: false,
        followers_count: 0,
        following_count: 0,
        reviews_count: 0,
        avg_rating: 0,
        total_bandwidth_sold: 0,
        trust_tier: "standard",
        created_at: new Date().toISOString(),
    };
}

export function mapApiConversation(row: ConversationWithPreview): Conversation {
    const updatedAt =
        row.last_message?.created_at ||
        row.conversation?.updated_at ||
        row.conversation?.created_at ||
        new Date().toISOString();

    return {
        id: row.id,
        participant1: row.conversation?.participants?.[0] ?? "",
        participant2: row.conversation?.participants?.[1] ?? "",
        last_message_at: updatedAt,
        other_participant: toSocialUser(row.other_participant) ?? {
            id: "",
            email: "",
            role: "user",
            username: row.other_participant_name,
            display_name: row.other_participant_name,
            verified: false,
            followers_count: 0,
            following_count: 0,
            reviews_count: 0,
            avg_rating: 0,
            total_bandwidth_sold: 0,
            trust_tier: "standard",
            created_at: updatedAt,
        },
        last_message: row.last_message ? mapApiMessage(row.last_message) : undefined,
        unread_count: row.unread_count,
    };
}

export function mapApiMessage(message: ApiMessage): Message {
    return {
        id: message.id,
        conversation_id: message.conversation_id,
        sender_id: message.sender_id,
        content: message.content,
        read_at: message.read_at,
        created_at: message.created_at,
    };
}

export async function getConversationsNormalized(): Promise<{ conversations: Conversation[] }> {
    const rows = await fetchConversations();
    return { conversations: rows.map(mapApiConversation) };
}

export async function getMessagesNormalized(conversationId: string): Promise<{ messages: Message[] }> {
    const messages = await fetchMessages(conversationId);
    return { messages: messages.map(mapApiMessage) };
}

export async function sendMessageNormalized(
    conversationId: string,
    content: string,
    replyToId?: string,
): Promise<Message> {
    const payload = replyToId ? { content, reply_to_id: replyToId } : { content };
    const message = await apiPost<ApiMessage>(`/v1/conversations/${conversationId}/messages`, payload);
    return mapApiMessage(message);
}

export async function startConversationNormalized(recipientId: string, message: string): Promise<Conversation> {
    const started = await postStartConversation(recipientId, message);
    const conversationId = started.conversation_id || started.id;
    // The first message is already accepted. A failed preview refresh must not
    // turn that successful write into a retryable send failure.
    const rows = await fetchConversations().catch(() => [] as ConversationWithPreview[]);
    const match = rows.find((row) => row.id === conversationId);
    if (match) return mapApiConversation(match);
    return {
        id: conversationId,
        participant1: "",
        participant2: recipientId,
        last_message_at: new Date().toISOString(),
        unread_count: 0,
    };
}
