"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getConversations, getMessages, sendMessage, type Conversation, type Message } from "@/lib/social-api";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Navbar } from "@/components/Navbar";

function MessagesContent() {
    const { user } = useAuth();
    // const searchParams = useSearchParams(); // unused
    // const recipientId = searchParams.get("to"); // unused

    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [newMessage, setNewMessage] = useState("");
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Load conversations
    useEffect(() => {
        async function fetchConversations() {
            try {
                const data = await getConversations();
                setConversations(data.conversations || []);

                // Select first conversation if available
                if (data.conversations?.length > 0 && !selectedConv) {
                    setSelectedConv(data.conversations[0]);
                }
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        }
        fetchConversations();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Load messages when conversation changes
    useEffect(() => {
        async function fetchMessages() {
            if (!selectedConv) return;

            try {
                const data = await getMessages(selectedConv.id);
                setMessages(data.messages || []);
                // Scroll to bottom
                setTimeout(() => {
                    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
                }, 100);
            } catch (err) {
                console.error(err);
            }
        }
        fetchMessages();
    }, [selectedConv]);

    const handleSend = async () => {
        if (!selectedConv || !newMessage.trim()) return;

        setSending(true);
        try {
            const message = await sendMessage(selectedConv.id, newMessage.trim());
            setMessages([...messages, message]);
            setNewMessage("");
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        } catch (err) {
            console.error(err);
        } finally {
            setSending(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="min-h-screen flex flex-col" style={{ background: "var(--background)" }}>
            <Navbar />

            <div className="flex-1 flex overflow-hidden" style={{ height: "calc(100vh - 60px)" }}>
                {/* Conversations List */}
                <div className="w-80 border-r flex flex-col" style={{ borderColor: "var(--card-border)", background: "var(--card)" }}>
                    <div className="p-4 border-b" style={{ borderColor: "var(--card-border)" }}>
                        <h2 className="font-semibold" style={{ color: "var(--foreground)" }}>Messages</h2>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        {loading ? (
                            <div className="flex items-center justify-center py-12">
                                <div className="spinner"></div>
                            </div>
                        ) : conversations.length === 0 ? (
                            <div className="p-4 text-center" style={{ color: "var(--muted)" }}>
                                <p className="mb-2">No conversations yet</p>
                                <p className="text-sm">Start a conversation from a profile or listing page</p>
                            </div>
                        ) : (
                            conversations.map((conv) => (
                                <button
                                    key={conv.id}
                                    onClick={() => setSelectedConv(conv)}
                                    className="w-full p-4 flex items-center gap-3 border-b transition-colors hover:bg-gray-50 dark:hover:bg-neutral-800 text-left"
                                    style={{
                                        borderColor: "var(--card-border)",
                                        background: selectedConv?.id === conv.id ? "rgba(249, 115, 22, 0.05)" : "transparent",
                                    }}
                                >
                                    <div className="avatar">
                                        <span>
                                            {conv.other_participant?.display_name?.charAt(0) ||
                                                conv.other_participant?.username?.charAt(0) || "?"}
                                        </span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between">
                                            <span className="font-medium truncate" style={{ color: "var(--foreground)" }}>
                                                @{conv.other_participant?.username || "User"}
                                            </span>
                                            <span className="text-xs" style={{ color: "var(--muted)" }}>
                                                {new Date(conv.last_message_at).toLocaleDateString()}
                                            </span>
                                        </div>
                                        <p className="text-sm truncate" style={{ color: "var(--muted)" }}>
                                            {conv.last_message?.content || "No messages"}
                                        </p>
                                    </div>
                                    {conv.unread_count && conv.unread_count > 0 && (
                                        <span className="badge">{conv.unread_count}</span>
                                    )}
                                </button>
                            ))
                        )}
                    </div>
                </div>

                {/* Chat Area */}
                <div className="flex-1 flex flex-col">
                    {selectedConv ? (
                        <>
                            {/* Chat Header */}
                            <div className="p-4 border-b flex items-center gap-3" style={{ borderColor: "var(--card-border)" }}>
                                <div className="avatar">
                                    <span>
                                        {selectedConv.other_participant?.display_name?.charAt(0) || "?"}
                                    </span>
                                </div>
                                <div>
                                    <div className="font-medium" style={{ color: "var(--foreground)" }}>
                                        {selectedConv.other_participant?.display_name || selectedConv.other_participant?.username}
                                    </div>
                                    <Link
                                        href={`/profile/${selectedConv.other_participant?.username || selectedConv.other_participant?.id}`}
                                        className="text-sm hover:underline"
                                        style={{ color: "var(--muted)" }}
                                    >
                                        @{selectedConv.other_participant?.username}
                                    </Link>
                                </div>
                            </div>

                            {/* Messages */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                {messages.map((msg) => (
                                    <div
                                        key={msg.id}
                                        className={`flex ${msg.sender_id === user?.id ? "justify-end" : "justify-start"}`}
                                    >
                                        <div
                                            className="max-w-md px-4 py-2 rounded-lg"
                                            style={{
                                                background: msg.sender_id === user?.id ? "var(--primary)" : "var(--card)",
                                                color: msg.sender_id === user?.id ? "white" : "var(--foreground)",
                                                border: msg.sender_id === user?.id ? "none" : "1px solid var(--card-border)",
                                            }}
                                        >
                                            <p>{msg.content}</p>
                                            <span className="text-xs mt-1 block" style={{ opacity: 0.7 }}>
                                                {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Input */}
                            <div className="p-4 border-t" style={{ borderColor: "var(--card-border)" }}>
                                <div className="flex gap-3">
                                    <input
                                        type="text"
                                        value={newMessage}
                                        onChange={(e) => setNewMessage(e.target.value)}
                                        onKeyPress={handleKeyPress}
                                        placeholder="Type a message..."
                                        className="input flex-1"
                                        disabled={sending}
                                    />
                                    <button
                                        onClick={handleSend}
                                        disabled={sending || !newMessage.trim()}
                                        className="btn btn-primary"
                                    >
                                        {sending ? "..." : "Send"}
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center" style={{ color: "var(--muted)" }}>
                            <div className="text-center">
                                <p className="mb-2">Select a conversation</p>
                                <p className="text-sm">Or start a new one from a profile page</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function MessagesPage() {
    return (
        <ProtectedRoute>
            <MessagesContent />
        </ProtectedRoute>
    );
}
