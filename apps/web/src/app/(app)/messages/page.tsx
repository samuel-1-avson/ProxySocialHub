"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getConversations, getMessages, sendMessage, type Conversation, type Message } from "@/lib/social-api";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Send, MessageSquare, User as UserIcon, Search, MoreVertical } from "lucide-react";

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
        <div className="flex bg-[#0a0a0a]/50 backdrop-blur-3xl rounded-3xl border border-white/5 overflow-hidden h-[calc(100vh-14rem)] shadow-2xl">
            {/* Conversations List */}
            <div className="w-80 border-r border-white/5 flex flex-col bg-white/[0.02]">
                <div className="p-6 border-b border-white/5 flex items-center justify-between">
                    <h2 className="text-xl font-bold text-white tracking-tight">Messages</h2>
                    <button className="p-2 rounded-xl hover:bg-white/5 text-muted-foreground transition-colors">
                        <MessageSquare size={18} />
                    </button>
                </div>

                <div className="p-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" size={14} />
                        <input
                            type="text"
                            placeholder="Search chats..."
                            className="w-full bg-white/5 border border-white/5 rounded-xl py-2 pl-9 pr-4 text-xs focus:border-primary/50 outline-none transition-all"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar">
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
                                className={`w-full p-4 flex items-center gap-4 transition-all hover:bg-white/[0.05] relative group ${selectedConv?.id === conv.id ? "bg-white/[0.03]" : ""}`}
                                onClick={() => setSelectedConv(conv)}
                            >
                                {selectedConv?.id === conv.id && (
                                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full"></div>
                                )}
                                <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-lg font-bold text-white/30 group-hover:text-primary/50 transition-colors shrink-0">
                                    {conv.other_participant?.avatar_url ? (
                                        <img src={conv.other_participant.avatar_url} className="w-full h-full rounded-2xl object-cover" />
                                    ) : (
                                        <span>{(conv.other_participant?.display_name?.[0] || conv.other_participant?.username?.[0] || "?").toUpperCase()}</span>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className={`text-sm font-bold truncate ${selectedConv?.id === conv.id ? "text-primary" : "text-white"}`}>
                                            @{conv.other_participant?.username || "User"}
                                        </span>
                                        <span className="text-[10px] font-medium text-muted-foreground uppercase">
                                            {new Date(conv.last_message_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                        </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground truncate opacity-60">
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
                        <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.01]">
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-sm font-bold text-white/30 border border-white/5">
                                    {(selectedConv.other_participant?.display_name?.[0] || "?").toUpperCase()}
                                </div>
                                <div>
                                    <div className="font-black text-white tracking-tight">
                                        {selectedConv.other_participant?.display_name || selectedConv.other_participant?.username}
                                    </div>
                                    <Link
                                        href={`/profile/${selectedConv.other_participant?.username || selectedConv.other_participant?.id}`}
                                        className="text-[10px] font-bold text-primary uppercase tracking-widest hover:underline"
                                    >
                                        View Profile
                                    </Link>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button className="p-2 rounded-xl hover:bg-white/5 text-muted-foreground transition-colors">
                                    <MoreVertical size={18} />
                                </button>
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
                                        className={`max-w-[70%] px-5 py-3 rounded-2xl text-sm font-medium shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-300 ${msg.sender_id === user?.id
                                            ? "bg-primary text-white rounded-tr-none shadow-primary/20"
                                            : "bg-white/5 text-white/90 border border-white/5 rounded-tl-none shadow-black/20"
                                            }`}
                                    >
                                        <p className="leading-relaxed">{msg.content}</p>
                                        <span className="text-[10px] mt-2 block font-bold opacity-40 uppercase tracking-tighter">
                                            {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                        </span>
                                    </div>
                                </div>
                            ))}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input */}
                        <div className="p-6 border-t border-white/5 bg-white/[0.01]">
                            <div className="flex gap-4 p-2 bg-white/5 rounded-2xl border border-white/5">
                                <input
                                    type="text"
                                    value={newMessage}
                                    onChange={(e) => setNewMessage(e.target.value)}
                                    onKeyPress={handleKeyPress}
                                    placeholder="Secure transmission..."
                                    className="bg-transparent border-none outline-none flex-1 px-4 text-sm font-medium text-white placeholder:text-white/20 focus:ring-0"
                                    disabled={sending}
                                />
                                <button
                                    onClick={handleSend}
                                    disabled={sending || !newMessage.trim()}
                                    className="p-3 rounded-xl bg-primary text-white shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100"
                                >
                                    <Send size={18} />
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
    );
}

export default function MessagesPage() {
    return (
        <ProtectedRoute>
            <MessagesContent />
        </ProtectedRoute>
    );
}
