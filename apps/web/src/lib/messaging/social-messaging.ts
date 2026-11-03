/**
 * Canonical messaging adapters — normalizes `/v1/conversations` via `@/lib/api/social`.
 * Enhanced features (reactions, attachments) stay on `@/lib/social-api`.
 */

import {
    getConversation as fetchConversation,
    getConversations as fetchConversations,
    getConversationsPage as fetchConversationsPage,
    getMessagesPage as fetchMessagesPage,
    markConversationRead,
    startConversation as postStartConversation,
    type ConversationWithPreview,
    type Message as ApiMessage,
    type SocialUserSummary,
} from "@/lib/api/social";
import { apiPost } from "@/lib/api/client";
import type { Conversation, Message } from "@/lib/social-api";

function toSocialUser(summary?: SocialUserSummary): Conversation['other_participant'] {
    if (!summary?.id) return undefined;
    return {
        id: summary.id,
        username: summary.username,
        display_name: summary.display_name,
        avatar_url: summary.avatar_url,
    };
}

export function mapApiConversation(row: ConversationWithPreview): Conversation {
    const updatedAt =
        row.last_message?.created_at ||
        row.conversation?.updated_at ||
        row.conversation?.created_at;

    return {
        id: row.id,
        participant1: row.conversation?.participants?.[0] ?? "",
        participant2: row.conversation?.participants?.[1] ?? "",
        last_message_at: updatedAt,
        other_participant: toSocialUser(row.other_participant),
        other_participant_name: row.other_participant_name,
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

export async function getConversationsNormalized(
    page = 1,
): Promise<{ conversations: Conversation[]; total: number; page: number; has_more: boolean }> {
    const result = await fetchConversationsPage(page);
    return {
        conversations: result.conversations.map(mapApiConversation),
        total: result.total,
        page: result.page,
        has_more: result.has_more,
    };
}

export async function getConversationNormalized(conversationId: string): Promise<Conversation> {
    const row = await fetchConversation(conversationId);
    return mapApiConversation(row);
}

// Messages are returned in display order (oldest first). The API serves
// newest-first pages with an ID tie-breaker; reversing yields a stable
// chronological order. Pass `before` to fetch the page older than the
// oldest message already displayed.
export async function getMessagesNormalized(
    conversationId: string,
    before?: string,
): Promise<{ messages: Message[]; total: number; has_more: boolean }> {
    const page = await fetchMessagesPage(conversationId, before);
    return {
        messages: page.messages.map(mapApiMessage).reverse(),
        total: page.total,
        has_more: page.has_more,
    };
}

export { markConversationRead };

// Canonical "message this user" deep link (F06). All surfaces build
// recipient links through here so the parameter contract stays in one place.
export function messageRecipientHref(userId: string): string {
    return "/messages?recipient=" + encodeURIComponent(userId);
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
        other_participant: { id: recipientId },
        unread_count: 0,
    };
}
