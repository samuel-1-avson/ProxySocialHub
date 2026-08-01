"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { getConversations, getMessages, sendMessage, type Conversation, type Message } from "@/lib/social-api";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useWebSocket, WS_MESSAGE_TYPES } from "@/lib/websocket";
import { Send, MessageSquare, Search, MoreVertical, Loader2, ArrowRight } from "lucide-react";

function MessagesContent() {
    const { user } = useAuth();
    const { subscribe, isConnected } = useWebSocket();
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [newMessage, setNewMessage] = useState("");
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const selectedConvRef = useRef<Conversation | null>(null);

    useEffect(() => {
        selectedConvRef.current = selectedConv;
    }, [selectedConv]);

    // Load conversations
    useEffect(() => {
        async function fetchConversations() {
            try {
                const data = await getConversations();
                setConversations(data.conversations || []);

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
                setTimeout(() => {
                    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
                }, 100);
            } catch (err) {
                console.error(err);
            }
        }
        fetchMessages();
    }, [selectedConv]);

    // Realtime inbound DMs (ticket-authenticated /v1/ws)
    useEffect(() => {
        return subscribe(WS_MESSAGE_TYPES.NEW_MESSAGE, (msg) => {
            const payload = msg?.data as {
                conversation_id?: string;
                message?: Message;
            } | undefined;
            if (!payload?.message || !payload.conversation_id) return;

            const active = selectedConvRef.current;
            if (active && payload.conversation_id === active.id) {
                setMessages((prev) => {
                    if (prev.some((m) => m.id === payload.message!.id)) return prev;
                    return [...prev, payload.message!];
                });
                setTimeout(() => {
                    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
                }, 50);
            }

            setConversations((prev) => {
                const idx = prev.findIndex((c) => c.id === payload.conversation_id);
                if (idx < 0) return prev;
                const next = [...prev];
                const [conv] = next.splice(idx, 1);
                next.unshift({
                    ...conv,
                    last_message_at: payload.message!.created_at || new Date().toISOString(),
                });
                return next;
            });
        });
    }, [subscribe]);

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
        <div className="card-retro p-0 bg-card overflow-hidden h-[calc(100vh-8rem)] flex shadow-xl">
            {/* Conversations List */}
            <div className="w-80 border-r border-border flex flex-col bg-secondary/10">
                <div className="p-4 border-b border-border flex items-center justify-between bg-card">
                    <h2 className="text-sm font-bold font-mono uppercase tracking-tight">Encrypted Comms</h2>
                    <div className="flex items-center gap-2">
                        <span
                            className={`h-2 w-2 rounded-full ${isConnected ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                            title={isConnected ? "Realtime connected" : "Realtime reconnecting"}
                        />
                        <button className="p-2 rounded-sm hover:bg-secondary text-muted-foreground transition-colors">
                            <MessageSquare size={16} />
                        </button>
                    </div>
                </div>

                <div className="p-3 border-b border-border bg-card/50">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={12} />
                        <input
                            type="text"
                            placeholder="SEARCH FREQUENCY..."
                            className="w-full bg-background border border-border rounded-sm py-2 pl-9 pr-4 text-xs font-mono focus:border-primary outline-none transition-all uppercase placeholder:text-muted-foreground/50"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="animate-spin text-primary" size={24} />
                        </div>
                    ) : conversations.length === 0 ? (
                        <div className="p-8 text-center" style={{ color: "var(--muted)" }}>
                            <p className="mb-2 font-mono text-xs uppercase">No Signals</p>
                            <p className="text-[10px] font-mono text-muted-foreground">START A TRANSMISSION FROM THE MARKETPLACE.</p>
                        </div>
                    ) : (
                        conversations.map((conv) => (
                            <button
                                key={conv.id}
                                className={`w-full p-4 flex items-center gap-3 transition-all border-b border-border/50 text-left group ${selectedConv?.id === conv.id ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-secondary/30 border-l-2 border-l-transparent"
                                    }`}
                                onClick={() => setSelectedConv(conv)}
                            >
                                <div className="w-10 h-10 rounded-sm bg-secondary border border-border flex items-center justify-center text-sm font-bold font-mono text-muted-foreground shrink-0 overflow-hidden">
                                    {conv.other_participant?.avatar_url ? (
                                        <img src={conv.other_participant.avatar_url} className="w-full h-full object-cover" />
                                    ) : (
                                        <span>{(conv.other_participant?.display_name?.[0] || conv.other_participant?.username?.[0] || "?").toUpperCase()}</span>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className={`text-xs font-bold font-mono truncate ${selectedConv?.id === conv.id ? "text-primary" : "text-foreground"}`}>
                                            @{conv.other_participant?.username || "UNKNOWN"}
                                        </span>
                                        <span className="text-[10px] font-mono text-muted-foreground uppercase opacity-50">
                                            {new Date(conv.last_message_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                        </span>
                                    </div>
                                    <p className="text-[10px] font-mono text-muted-foreground truncate opacity-70">
                                        {conv.last_message?.content || "NO DATA"}
                                    </p>
                                </div>
                                {conv.unread_count && conv.unread_count > 0 && (
                                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
                                )}
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1 flex flex-col bg-background">
                {selectedConv ? (
                    <>
                        {/* Chat Header */}
                        <div className="p-4 border-b border-border flex items-center justify-between bg-card">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-sm bg-secondary border border-border flex items-center justify-center text-xs font-bold font-mono text-muted-foreground">
                                    {(selectedConv.other_participant?.display_name?.[0] || "?").toUpperCase()}
                                </div>
                                <div>
                                    <div className="font-bold font-mono text-sm leading-none">
                                        {selectedConv.other_participant?.display_name || selectedConv.other_participant?.username}
                                    </div>
                                    <Link
                                        href={`/profile/${selectedConv.other_participant?.username || selectedConv.other_participant?.id}`}
                                        className="text-[10px] font-mono font-bold text-primary uppercase hover:underline flex items-center gap-1 mt-0.5"
                                    >
                                        View Protocol <ArrowRight size={8} />
                                    </Link>
                                </div>
                            </div>
                            <button className="p-2 rounded-sm hover:bg-secondary text-muted-foreground transition-colors">
                                <MoreVertical size={16} />
                            </button>
                        </div>

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[radial-gradient(#222_1px,transparent_1px)] [background-size:20px_20px] bg-[position:0_0,10px_10px]">
                            {messages.map((msg) => (
                                <div
                                    key={msg.id}
                                    className={`flex ${msg.sender_id === user?.id ? "justify-end" : "justify-start"}`}
                                >
                                    <div
                                        className={`max-w-[70%] p-4 rounded-sm border shadow-sm ${msg.sender_id === user?.id
                                                ? "bg-primary/10 border-primary/20 text-foreground"
                                                : "bg-card border-border text-foreground"
                                            }`}
                                    >
                                        <p className="font-mono text-xs leading-relaxed">{msg.content}</p>
                                        <span className="text-[9px] mt-2 block font-mono font-bold opacity-40 uppercase">
                                            {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                        </span>
                                    </div>
                                </div>
                            ))}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input */}
                        <div className="p-4 border-t border-border bg-card">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={newMessage}
                                    onChange={(e) => setNewMessage(e.target.value)}
                                    onKeyPress={handleKeyPress}
                                    placeholder="ENTER SECURE MESSAGE..."
                                    className="flex-1 bg-secondary/20 border border-border rounded-sm px-4 py-3 text-sm font-mono focus:border-primary outline-none transition-all placeholder:text-muted-foreground/50 uppercase"
                                    disabled={sending}
                                />
                                <button
                                    onClick={handleSend}
                                    disabled={sending || !newMessage.trim()}
                                    className="px-6 rounded-sm bg-primary text-primary-foreground font-bold font-mono hover:bg-primary/90 disabled:opacity-50 transition-colors uppercase text-xs"
                                >
                                    <Send size={16} />
                                </button>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground font-mono space-y-4">
                        <MessageSquare size={48} className="opacity-20" />
                        <div className="text-center">
                            <p className="text-sm font-bold uppercase mb-1">No Uplink Selected</p>
                            <p className="text-xs">SELECT A FREQUENCY TO BEGIN TRANSMISSION</p>
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
