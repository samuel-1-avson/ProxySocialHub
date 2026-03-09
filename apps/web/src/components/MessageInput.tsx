"use client";

import { useState, useRef } from "react";
import {
    Send,
    Paperclip,
    Smile,
    X,
    FileText,
    Image,
    Loader2,
} from "lucide-react";
import { uploadAttachment } from "@/lib/social-api";

interface MessageInputProps {
    conversationId: string;
    onSend: (content: string, attachments?: string[]) => void;
    replyTo?: { id: string; content: string; sender_name: string } | null;
    onCancelReply?: () => void;
    disabled?: boolean;
}

const EMOJI_LIST = ["👍", "❤️", "😂", "😮", "😢", "🎉", "🔥", "👏"];

export function MessageInput({
    conversationId,
    onSend,
    replyTo,
    onCancelReply,
    disabled,
}: MessageInputProps) {
    const [content, setContent] = useState("");
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [attachments, setAttachments] = useState<{ id: string; name: string; url: string; type: string }[]>([]);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleSubmit = () => {
        if (!content.trim() && attachments.length === 0) return;
        onSend(content, attachments.map((a) => a.url));
        setContent("");
        setAttachments([]);
        onCancelReply?.();
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        try {
            const attachment = await uploadAttachment(conversationId, file);
            setAttachments((prev) => [
                ...prev,
                {
                    id: attachment.id,
                    name: attachment.file_name || file.name,
                    url: attachment.url,
                    type: attachment.type,
                },
            ]);
        } catch (err) {
            console.error("Failed to upload file:", err);
        } finally {
            setUploading(false);
        }
    };

    const removeAttachment = (id: string) => {
        setAttachments((prev) => prev.filter((a) => a.id !== id));
    };

    const addEmoji = (emoji: string) => {
        setContent((prev) => prev + emoji);
        setShowEmojiPicker(false);
    };

    return (
        <div className="space-y-3">
            {/* Reply Preview */}
            {replyTo && (
                <div className="flex items-start gap-2 p-3 bg-secondary/30 rounded-lg border-l-2 border-primary">
                    <div className="flex-1 min-w-0">
                        <p className="text-xs text-primary font-mono mb-1">Replying to {replyTo.sender_name}</p>
                        <p className="text-sm text-muted-foreground truncate">{replyTo.content}</p>
                    </div>
                    <button onClick={onCancelReply} className="p-1 hover:bg-secondary rounded">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            {/* Attachments Preview */}
            {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {attachments.map((attachment) => (
                        <div
                            key={attachment.id}
                            className="flex items-center gap-2 px-3 py-2 bg-secondary/50 rounded-lg text-sm"
                        >
                            {attachment.type === "image" ? (
                                <Image className="w-4 h-4 text-primary" />
                            ) : (
                                <FileText className="w-4 h-4 text-primary" />
                            )}
                            <span className="truncate max-w-[150px]">{attachment.name}</span>
                            <button
                                onClick={() => removeAttachment(attachment.id)}
                                className="p-1 hover:bg-secondary rounded"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Input Area */}
            <div className="flex items-end gap-2">
                {/* Attachment Button */}
                <div className="relative">
                    <input
                        ref={fileInputRef}
                        type="file"
                        onChange={handleFileSelect}
                        className="hidden"
                        accept="image/*,.pdf,.doc,.docx,.txt"
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading || disabled}
                        className="p-3 rounded-lg hover:bg-secondary transition-colors disabled:opacity-50"
                    >
                        {uploading ? (
                            <Loader2 className="w-5 h-5 animate-spin text-primary" />
                        ) : (
                            <Paperclip className="w-5 h-5 text-muted-foreground" />
                        )}
                    </button>
                </div>

                {/* Emoji Button */}
                <div className="relative">
                    <button
                        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                        disabled={disabled}
                        className="p-3 rounded-lg hover:bg-secondary transition-colors disabled:opacity-50"
                    >
                        <Smile className="w-5 h-5 text-muted-foreground" />
                    </button>

                    {/* Emoji Picker */}
                    {showEmojiPicker && (
                        <div className="absolute bottom-full left-0 mb-2 p-2 bg-card border border-border rounded-lg shadow-xl grid grid-cols-4 gap-1 z-50">
                            {EMOJI_LIST.map((emoji) => (
                                <button
                                    key={emoji}
                                    onClick={() => addEmoji(emoji)}
                                    className="p-2 hover:bg-secondary rounded text-lg"
                                >
                                    {emoji}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Text Input */}
                <div className="flex-1 relative">
                    <textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="Type a message..."
                        rows={1}
                        disabled={disabled}
                        className="w-full bg-secondary/20 border border-border rounded-lg px-4 py-3 pr-12 font-mono text-sm focus:border-primary outline-none resize-none min-h-[48px] max-h-[120px]"
                        style={{ height: "auto" }}
                        onInput={(e) => {
                            const target = e.target as HTMLTextAreaElement;
                            target.style.height = "auto";
                            target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
                        }}
                    />
                </div>

                {/* Send Button */}
                <button
                    onClick={handleSubmit}
                    disabled={(!content.trim() && attachments.length === 0) || disabled}
                    className="p-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                    <Send className="w-5 h-5" />
                </button>
            </div>

            {/* Click outside to close emoji picker */}
            {showEmojiPicker && (
                <div className="fixed inset-0 z-40" onClick={() => setShowEmojiPicker(false)} />
            )}
        </div>
    );
}

export default MessageInput;
