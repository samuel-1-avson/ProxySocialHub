"use client";

import { useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Loader2, Smile, Edit2, Trash2 } from "lucide-react";

interface MessageReaction {
    emoji: string;
    count: number;
    userIds: string[];
}

interface VirtualizedMessage {
    id: string;
    content: string;
    sender_id?: string;
    senderId?: string;
    created_at?: string;
    createdAt?: string;
    edited_at?: string;
    editedAt?: string;
    is_deleted?: boolean;
    isDeleted?: boolean;
    sender?: {
        avatar?: string;
        avatar_url?: string;
        displayName?: string;
        display_name?: string;
    };
    reactions?: MessageReaction[];
}

interface VirtualizedMessageListProps {
    messages: VirtualizedMessage[];
    currentUserId: string;
    hasMore: boolean;
    isLoadingMore: boolean;
    onLoadMore: () => void;
    onReaction: (messageId: string, emoji: string) => void;
    onEdit: (messageId: string, content: string) => void;
    onDelete: (messageId: string) => void;
}

const ITEM_HEIGHT = 80;
const OVERSCAN = 5;

export function VirtualizedMessageList({
    messages,
    currentUserId,
    hasMore,
    isLoadingMore,
    onLoadMore,
    onReaction,
    onEdit,
    onDelete,
}: VirtualizedMessageListProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const observerRef = useRef<IntersectionObserver | null>(null);

    const firstItemRef = useCallback(
        (node: HTMLDivElement | null) => {
            if (isLoadingMore) return;
            if (observerRef.current) observerRef.current.disconnect();

            observerRef.current = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting && hasMore) {
                    onLoadMore();
                }
            });

            if (node) observerRef.current.observe(node);
        },
        [isLoadingMore, hasMore, onLoadMore]
    );

    // Scroll to bottom on initial load
    useEffect(() => {
        if (containerRef.current && !isLoadingMore) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [messages.length, isLoadingMore]);

    const groupedMessages = groupMessagesByDate(messages);

    return (
        <div
            ref={containerRef}
            className="flex-1 overflow-y-auto p-4 space-y-6"
        >
            {isLoadingMore && (
                <div className="flex justify-center py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                </div>
            )}

            {Object.entries(groupedMessages).map(([date, dateMessages]) => (
                <div key={date} className="space-y-4">
                    {/* Date separator */}
                    <div className="flex items-center gap-4">
                        <div className="flex-1 h-px bg-border" />
                        <span className="text-xs text-muted-foreground">{date}</span>
                        <div className="flex-1 h-px bg-border" />
                    </div>

                    {/* Messages */}
                    <div className="space-y-4">
                        {dateMessages.map((message, index) => {
                            const isFirst = index === 0 && date === Object.keys(groupedMessages)[0];
                            const senderId = message.sender_id || message.senderId || '';
                            const senderName = message.sender?.display_name || message.sender?.displayName || 'User';
                            const senderAvatar = message.sender?.avatar_url || message.sender?.avatar || "/default-avatar.png";
                            const createdAt = message.created_at || message.createdAt || new Date().toISOString();
                            const editedAt = message.edited_at || message.editedAt;
                            const isDeleted = message.is_deleted ?? message.isDeleted ?? false;
                            const isOwn = senderId === currentUserId;

                            return (
                                <div
                                    key={message.id}
                                    ref={isFirst ? firstItemRef : null}
                                    className={`flex gap-3 ${isOwn ? "flex-row-reverse" : ""}`}
                                >
                                    {/* Avatar */}
                                    <Link href={`/providers/${senderId}`}>
                                        <img
                                            src={senderAvatar}
                                            alt={senderName}
                                            className="w-8 h-8 rounded-full object-cover"
                                        />
                                    </Link>

                                    {/* Message bubble */}
                                    <div className={`max-w-[70%] ${isOwn ? "items-end" : "items-start"}`}>
                                        {/* Sender name */}
                                        {!isOwn && (
                                            <span className="text-xs text-muted-foreground ml-1">
                                                {senderName}
                                            </span>
                                        )}

                                        {/* Content */}
                                        <div
                                            className={`
                                                relative px-4 py-2.5 rounded-2xl group
                                                ${isOwn
                                                    ? "bg-primary text-primary-foreground rounded-br-md"
                                                    : "bg-muted rounded-bl-md"
                                                }
                                            `}
                                        >
                                            {isDeleted ? (
                                                <span className="italic opacity-70">
                                                    This message was deleted
                                                </span>
                                            ) : (
                                                <p className="text-sm whitespace-pre-wrap">
                                                    {message.content}
                                                </p>
                                            )}

                                            {/* Reactions */}
                                            {message.reactions && message.reactions.length > 0 && (
                                                <div className="flex flex-wrap gap-1 mt-2">
                                                    {message.reactions.map((reaction: MessageReaction) => (
                                                        <button
                                                            key={reaction.emoji}
                                                            onClick={() => onReaction(message.id, reaction.emoji)}
                                                            className={`
                                                                flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs
                                                                ${reaction.userIds.includes(currentUserId)
                                                                    ? "bg-primary/20"
                                                                    : "bg-background/50"
                                                                }
                                                            `}
                                                        >
                                                            <span>{reaction.emoji}</span>
                                                            <span>{reaction.count}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Edit/Delete menu */}
                                            {isOwn && !isDeleted && (
                                                <div className="absolute top-0 -right-20 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                                                    <button
                                                        onClick={() => onEdit(message.id, message.content)}
                                                        className="p-1.5 rounded-full bg-muted hover:bg-muted/80"
                                                    >
                                                        <Edit2 className="w-3 h-3" />
                                                    </button>
                                                    <button
                                                        onClick={() => onDelete(message.id)}
                                                        className="p-1.5 rounded-full bg-muted hover:bg-destructive hover:text-destructive-foreground"
                                                    >
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            )}

                                            {/* Reaction picker */}
                                            {!isDeleted && (
                                                <div className="absolute top-0 -right-8 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        onClick={() => onReaction(message.id, "❤️")}
                                                        className="p-1.5 rounded-full bg-muted hover:bg-muted/80"
                                                    >
                                                        <Smile className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        {/* Timestamp */}
                                        <span className="text-[10px] text-muted-foreground mt-1 block">
                                            {formatDistanceToNow(new Date(createdAt), {
                                                addSuffix: true,
                                            })}
                                            {editedAt && " (edited)"}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}

function groupMessagesByDate(messages: VirtualizedMessage[]): Record<string, VirtualizedMessage[]> {
    const groups: Record<string, VirtualizedMessage[]> = {};

    messages.forEach((message) => {
        const createdAt = message.created_at || message.createdAt || new Date().toISOString();
        const date = new Date(createdAt).toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
        });

        if (!groups[date]) {
            groups[date] = [];
        }
        groups[date].push(message);
    });

    return groups;
}
