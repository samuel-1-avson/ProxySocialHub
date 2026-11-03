/**
 * Canonical messaging adapters — normalizes `/v1/conversations` via `@/lib/api/social`.
 * Enhanced features (reactions, attachments) stay on `@/lib/social-api`.
 */

import {
    findConversation as fetchConversation,
    getConversations as fetchConversations,
    getMessages as fetchMessages,
    markConversationRead as postMarkRead,
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
    // The server's own last_message_at is when the conversation last moved
    // (including a message that was since deleted); fall back to the preview.
    const updatedAt =
        row.last_message_at ||
        row.last_message?.created_at ||
        row.conversation?.updated_at ||
        row.conversation?.created_at ||
        row.created_at;

    return {
        id: row.id,
        participant1: row.participant1 ?? row.conversation?.participants?.[0] ?? "",
        participant2: row.participant2 ?? row.conversation?.participants?.[1] ?? "",
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
        type: message.type as Message['type'],
        reply_to_id: message.reply_to_id,
        edited_at: message.edited_at,
        is_deleted: message.is_deleted,
        reactions: message.reactions,
    };
}

export async function getConversationsNormalized(): Promise<{ conversations: Conversation[] }> {
    const rows = await fetchConversations();
    return { conversations: rows.map(mapApiConversation) };
}

/** A thread: its messages oldest first, and whether older ones can still be loaded. */
export interface MessageThread {
    messages: Message[];
    page: number;
    hasMore: boolean;
}

export async function getMessagesNormalized(conversationId: string, page = 1): Promise<MessageThread> {
    const result = await fetchMessages(conversationId, page);
    return {
        messages: result.messages.map(mapApiMessage),
        page: result.page,
        hasMore: result.page * result.limit < result.total,
    };
}

/** Add messages to a thread without duplicating any, keeping time order. */
export function mergeMessages(...lists: Message[][]): Message[] {
    const byId = new Map<string, Message>();
    for (const list of lists) for (const message of list) byId.set(message.id, message);
    return [...byId.values()].sort(
        (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
    );
}

export async function getConversationNormalized(id: string): Promise<Conversation | undefined> {
    const row = await fetchConversation(id);
    return row ? mapApiConversation(row) : undefined;
}

export async function markConversationReadNormalized(conversationId: string): Promise<void> {
    await postMarkRead(conversationId);
}

export async function sendMessageNormalized(
    conversationId: string,
    content: string,
    replyToId?: string,
    clientMsgId?: string,
): Promise<Message> {
    const payload = {
        content,
        ...(replyToId ? { reply_to_id: replyToId } : {}),
        ...(clientMsgId ? { client_msg_id: clientMsgId } : {}),
    };
    const message = await apiPost<ApiMessage>(`/v1/conversations/${conversationId}/messages`, payload);
    return mapApiMessage(message);
}

export async function startConversationNormalized(recipientId: string, message: string, clientMsgId?: string): Promise<Conversation> {
    const started = await postStartConversation(recipientId, message, clientMsgId);
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
