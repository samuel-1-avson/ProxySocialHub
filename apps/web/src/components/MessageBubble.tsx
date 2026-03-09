"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { editMessage, deleteMessage, addReaction, removeReaction, type Message } from "@/lib/social-api";
import {
    Check,
    CheckCheck,
    MoreHorizontal,
    Edit2,
    Trash2,
    Smile,
    CornerDownRight,
    FileText,
    Image as ImageIcon,
    X,
    Loader2,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface MessageBubbleProps {
    message: Message;
    isOwn: boolean;
    onReply: (message: Message) => void;
    onUpdate: (message: Message) => void;
    onDelete: (messageId: string) => void;
}

const EMOJI_LIST = ["👍", "❤️", "😂", "😮", "😢", "🎉", "🔥", "👏"];

export function MessageBubble({
    message,
    isOwn,
    onReply,
    onUpdate,
    onDelete,
}: MessageBubbleProps) {
    const { user } = useAuth();
    const [showActions, setShowActions] = useState(false);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editContent, setEditContent] = useState(message.content);
    const [saving, setSaving] = useState(false);

    const canEdit = isOwn && !message.is_deleted;
    const canDelete = isOwn && !message.is_deleted;
    const canReact = !message.is_deleted;

    const handleEdit = async () => {
        if (!editContent.trim() || editContent === message.content) {
            setIsEditing(false);
            return;
        }
        setSaving(true);
        try {
            const updated = await editMessage(message.conversation_id, message.id, editContent);
            onUpdate(updated);
            setIsEditing(false);
        } catch (err) {
            console.error("Failed to edit message:", err);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!confirm("Are you sure you want to delete this message?")) return;
        try {
            await deleteMessage(message.conversation_id, message.id);
            onDelete(message.id);
        } catch (err) {
            console.error("Failed to delete message:", err);
        }
    };

    const handleReaction = async (emoji: string) => {
        const hasReacted = message.reactions?.some(
            (r) => r.user_id === user?.id && r.emoji === emoji
        );
        try {
            if (hasReacted) {
                await removeReaction(message.id, emoji);
            } else {
                await addReaction(message.id, emoji);
            }
            // Refresh would happen via parent component
        } catch (err) {
            console.error("Failed to toggle reaction:", err);
        }
    };

    const reactionCounts = message.reactions?.reduce((acc, r) => {
        acc[r.emoji] = (acc[r.emoji] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    if (message.is_deleted) {
        return (
            <div className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
                <div className="max-w-[70%] px-4 py-2 rounded-lg bg-secondary/30 text-muted-foreground text-sm italic">
                    This message was deleted
                </div>
            </div>
        );
    }

    return (
        <div
            className={`flex ${isOwn ? "justify-end" : "justify-start"} group`}
            onMouseEnter={() => setShowActions(true)}
            onMouseLeave={() => {
                setShowActions(false);
                setShowEmojiPicker(false);
            }}
        >
            <div className="max-w-[70%] relative">
                {/* Reply Reference */}
                {message.reply_to_id && (
                    <div className="mb-1 px-3 py-1.5 bg-secondary/30 rounded-t-lg border-l-2 border-primary/50 text-xs text-muted-foreground">
                        <CornerDownRight className="w-3 h-3 inline mr-1" />
                        Replying to message
                    </div>
                )}

                {/* Message Content */}
                <div
                    className={`relative px-4 py-3 rounded-lg ${
                        isOwn
                            ? "bg-primary text-primary-foreground rounded-br-none"
                            : "bg-card border border-border rounded-bl-none"
                    }`}
                >
                    {/* Edit Mode */}
                    {isEditing ? (
                        <div className="space-y-2">
                            <textarea
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                className={`w-full bg-transparent border rounded px-2 py-1 text-sm outline-none ${
                                    isOwn ? "border-primary-foreground/30" : "border-border"
                                }`}
                                rows={2}
                                autoFocus
                            />
                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={() => {
                                        setIsEditing(false);
                                        setEditContent(message.content);
                                    }}
                                    className="p-1 hover:bg-white/10 rounded"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={handleEdit}
                                    disabled={saving}
                                    className="p-1 hover:bg-white/10 rounded"
                                >
                                    {saving ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Check className="w-4 h-4" />
                                    )}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Content */}
                            <p className="whitespace-pre-wrap text-sm">{message.content}</p>

                            {/* Attachments */}
                            {message.attachments && message.attachments.length > 0 && (
                                <div className="mt-2 space-y-2">
                                    {message.attachments.map((att) => (
                                        <a
                                            key={att.id}
                                            href={att.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={`flex items-center gap-2 p-2 rounded text-sm ${
                                                isOwn ? "bg-primary-foreground/10" : "bg-secondary"
                                            }`}
                                        >
                                            {att.type === "image" ? (
                                                <ImageIcon className="w-4 h-4" />
                                            ) : (
                                                <FileText className="w-4 h-4" />
                                            )}
                                            <span className="truncate">{att.file_name || "Attachment"}</span>
                                        </a>
                                    ))}
                                </div>
                            )}
                        </>
                    )}

                    {/* Timestamp */}
                    <div
                        className={`flex items-center gap-1 mt-1 text-[10px] ${
                            isOwn ? "text-primary-foreground/60" : "text-muted-foreground"
                        }`}
                    >
                        <span title={format(new Date(message.created_at), "PPpp")}>
                            {formatDistanceToNow(new Date(message.created_at), { addSuffix: true })}
                        </span>
                        {message.edited_at && <span>(edited)</span>}
                        {isOwn && (
                            <span className="ml-1">
                                {message.read_at ? (
                                    <CheckCheck className="w-3 h-3" />
                                ) : (
                                    <Check className="w-3 h-3" />
                                )}
                            </span>
                        )}
                    </div>
                </div>

                {/* Reactions */}
                {reactionCounts && Object.keys(reactionCounts).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                        {Object.entries(reactionCounts).map(([emoji, count]) => {
                            const hasReacted = message.reactions?.some(
                                (r) => r.user_id === user?.id && r.emoji === emoji
                            );
                            return (
                                <button
                                    key={emoji}
                                    onClick={() => handleReaction(emoji)}
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                                        hasReacted
                                            ? "bg-primary/20 text-primary border border-primary/30"
                                            : "bg-secondary text-muted-foreground border border-border"
                                    }`}
                                >
                                    {emoji} {count}
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* Actions */}
                {(showActions || showEmojiPicker) && !isEditing && (
                    <div
                        className={`absolute ${isOwn ? "right-full mr-2" : "left-full ml-2"} top-0 flex items-center gap-1`}
                    >
                        {/* Emoji Picker */}
                        {showEmojiPicker && canReact && (
                            <div className="absolute bottom-full mb-1 p-2 bg-card border border-border rounded-lg shadow-xl grid grid-cols-4 gap-1 z-50">
                                {EMOJI_LIST.map((emoji) => (
                                    <button
                                        key={emoji}
                                        onClick={() => handleReaction(emoji)}
                                        className="p-2 hover:bg-secondary rounded text-lg"
                                    >
                                        {emoji}
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Reaction Button */}
                        {canReact && (
                            <button
                                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                                className="p-1.5 rounded-full bg-card border border-border hover:bg-secondary shadow-sm"
                            >
                                <Smile className="w-3.5 h-3.5" />
                            </button>
                        )}

                        {/* Reply Button */}
                        <button
                            onClick={() => onReply(message)}
                            className="p-1.5 rounded-full bg-card border border-border hover:bg-secondary shadow-sm"
                        >
                            <CornerDownRight className="w-3.5 h-3.5" />
                        </button>

                        {/* Edit/Delete for own messages */}
                        {canEdit && (
                            <button
                                onClick={() => setIsEditing(true)}
                                className="p-1.5 rounded-full bg-card border border-border hover:bg-secondary shadow-sm"
                            >
                                <Edit2 className="w-3.5 h-3.5" />
                            </button>
                        )}
                        {canDelete && (
                            <button
                                onClick={handleDelete}
                                className="p-1.5 rounded-full bg-card border border-border hover:bg-red-500/10 hover:text-red-500 shadow-sm"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default MessageBubble;
