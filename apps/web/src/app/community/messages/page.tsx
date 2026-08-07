"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import {
    getConversations,
    getMessages,
    sendMessage,
    startConversation,
    type Conversation,
    type Message,
} from "@/lib/social-api";
import { getFriends, type Friendship } from "@/lib/friends-api";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useRealtime, WS_MESSAGE_TYPES } from "@/lib/websocket";
import { ROUTES } from "@/lib/navigation/routes";
import {
    Send,
    Inbox,
    Search,
    MoreVertical,
    Loader2,
    ArrowRight,
    Plus,
    X,
    Users,
} from "lucide-react";

function MessagesContent() {
    const { user } = useAuth();
    const { subscribe, isConnected } = useRealtime();
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [newMessage, setNewMessage] = useState("");
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [composing, setComposing] = useState(false);
    const [friends, setFriends] = useState<Friendship[]>([]);
    const [friendsLoading, setFriendsLoading] = useState(false);
    const [composeError, setComposeError] = useState("");
    const [startingId, setStartingId] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const selectedConvRef = useRef<Conversation | null>(null);

    useEffect(() => {
        selectedConvRef.current = selectedConv;
    }, [selectedConv]);

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
                    last_message: payload.message,
                });
                return next;
            });
        });
    }, [subscribe]);

    const openCompose = async () => {
        setComposing(true);
        setComposeError("");
        setFriendsLoading(true);
        try {
            const data = await getFriends();
            setFriends(data.friends || []);
        } catch (err) {
            console.error(err);
            setComposeError("Could not load friends. You can still message sellers from the marketplace.");
        } finally {
            setFriendsLoading(false);
        }
    };

    const handleStartWithFriend = async (friendUserId: string) => {
        if (!friendUserId || startingId) return;
        setStartingId(friendUserId);
        setComposeError("");
        try {
            const conv = await startConversation(friendUserId, "Hi there!");
            const data = await getConversations();
            const list = data.conversations || [];
            setConversations(list);
            const match = list.find((c) => c.id === conv.id) || conv;
            setSelectedConv(match);
            setComposing(false);
        } catch (err) {
            console.error(err);
            setComposeError(err instanceof Error ? err.message : "Failed to start conversation");
        } finally {
            setStartingId(null);
        }
    };

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

    const filteredConversations = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return conversations;
        return conversations.filter((conv) => {
            const name = (
                conv.other_participant?.display_name ||
                conv.other_participant?.username ||
                ""
            ).toLowerCase();
            const preview = (conv.last_message?.content || "").toLowerCase();
            return name.includes(q) || preview.includes(q);
        });
    }, [conversations, searchQuery]);

    return (
        <div className="card-retro p-0 bg-card overflow-hidden h-[calc(100vh-8rem)] flex shadow-xl relative">
            {/* Conversations List */}
            <div className="w-80 border-r border-border flex flex-col bg-secondary/10">
                <div className="p-4 border-b border-border flex items-center justify-between bg-card">
                    <h2 className="text-sm font-bold font-mono uppercase tracking-tight">Messages</h2>
                    <div className="flex items-center gap-2">
                        <span
                            className={`h-2 w-2 rounded-full ${isConnected ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                            title={isConnected ? "Realtime connected" : "Realtime reconnecting"}
                        />
                        <button
                            type="button"
                            onClick={() => void openCompose()}
                            className="p-2 rounded-sm hover:bg-secondary text-muted-foreground hover:text-primary transition-colors"
                            title="New message"
                            aria-label="New message"
                        >
                            <Plus size={16} />
                        </button>
                    </div>
                </div>

                <div className="p-3 border-b border-border bg-card/50">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={12} />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search conversations…"
                            className="w-full bg-background border border-border rounded-sm py-2 pl-9 pr-4 text-xs font-mono focus:border-primary outline-none transition-all placeholder:text-muted-foreground/50"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="animate-spin text-primary" size={24} />
                        </div>
                    ) : filteredConversations.length === 0 ? (
                        <div className="p-8 text-center" style={{ color: "var(--muted-foreground)" }}>
                            <Inbox className="mx-auto mb-3 text-muted-foreground/40" size={28} />
                            <p className="mb-2 font-mono text-xs uppercase">No conversations</p>
                            <p className="text-[10px] font-mono text-muted-foreground mb-4">
                                Message a friend or inquire on a marketplace listing.
                            </p>
                            <div className="flex flex-col gap-2">
                                <button
                                    type="button"
                                    onClick={() => void openCompose()}
                                    className="px-3 py-2 rounded-sm bg-primary/15 border border-primary/30 text-[10px] font-black uppercase tracking-widest text-primary hover:bg-primary/25"
                                >
                                    Message a friend
                                </button>
                                <Link
                                    href={ROUTES.marketplace}
                                    className="px-3 py-2 rounded-sm border border-border text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground"
                                >
                                    Browse marketplace
                                </Link>
                            </div>
                        </div>
                    ) : (
                        filteredConversations.map((conv) => (
                            <button
                                key={conv.id}
                                type="button"
                                className={`w-full p-4 flex items-center gap-3 transition-all border-b border-border/50 text-left group ${
                                    selectedConv?.id === conv.id
                                        ? "bg-primary/5 border-l-2 border-l-primary"
                                        : "hover:bg-secondary/30 border-l-2 border-l-transparent"
                                }`}
                                onClick={() => setSelectedConv(conv)}
                            >
                                <div className="w-10 h-10 rounded-sm bg-secondary border border-border flex items-center justify-center text-sm font-bold font-mono text-muted-foreground shrink-0 overflow-hidden">
                                    {conv.other_participant?.avatar_url ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={conv.other_participant.avatar_url}
                                            alt=""
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <span>
                                            {(
                                                conv.other_participant?.display_name?.[0] ||
                                                conv.other_participant?.username?.[0] ||
                                                "?"
                                            ).toUpperCase()}
                                        </span>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-1">
                                        <span
                                            className={`text-xs font-bold font-mono truncate ${
                                                selectedConv?.id === conv.id ? "text-primary" : "text-foreground"
                                            }`}
                                        >
                                            @{conv.other_participant?.username || "unknown"}
                                        </span>
                                        <span className="text-[10px] font-mono text-muted-foreground uppercase opacity-50">
                                            {new Date(conv.last_message_at).toLocaleDateString([], {
                                                month: "short",
                                                day: "numeric",
                                            })}
                                        </span>
                                    </div>
                                    <p className="text-[10px] font-mono text-muted-foreground truncate opacity-70">
                                        {conv.last_message?.content || "No messages yet"}
                                    </p>
                                </div>
                                {conv.unread_count && conv.unread_count > 0 ? (
                                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                                ) : null}
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1 flex flex-col bg-background">
                {selectedConv ? (
                    <>
                        <div className="p-4 border-b border-border flex items-center justify-between bg-card">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-sm bg-secondary border border-border flex items-center justify-center text-xs font-bold font-mono text-muted-foreground">
                                    {(
                                        selectedConv.other_participant?.display_name?.[0] ||
                                        selectedConv.other_participant?.username?.[0] ||
                                        "?"
                                    ).toUpperCase()}
                                </div>
                                <div>
                                    <div className="font-bold font-mono text-sm leading-none">
                                        {selectedConv.other_participant?.display_name ||
                                            selectedConv.other_participant?.username}
                                    </div>
                                    <Link
                                        href={`/profile/${
                                            selectedConv.other_participant?.username ||
                                            selectedConv.other_participant?.id
                                        }`}
                                        className="text-[10px] font-mono font-bold text-primary uppercase hover:underline flex items-center gap-1 mt-0.5"
                                    >
                                        View profile <ArrowRight size={8} />
                                    </Link>
                                </div>
                            </div>
                            <button
                                type="button"
                                className="p-2 rounded-sm hover:bg-secondary text-muted-foreground transition-colors"
                                aria-label="Conversation options"
                            >
                                <MoreVertical size={16} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[radial-gradient(#222_1px,transparent_1px)] [background-size:20px_20px]">
                            {messages.map((msg) => (
                                <div
                                    key={msg.id}
                                    className={`flex ${msg.sender_id === user?.id ? "justify-end" : "justify-start"}`}
                                >
                                    <div
                                        className={`max-w-[70%] p-4 rounded-sm border shadow-sm ${
                                            msg.sender_id === user?.id
                                                ? "bg-primary/10 border-primary/20 text-foreground"
                                                : "bg-card border-border text-foreground"
                                        }`}
                                    >
                                        <p className="font-mono text-xs leading-relaxed">{msg.content}</p>
                                        <span className="text-[9px] mt-2 block font-mono font-bold opacity-40 uppercase">
                                            {new Date(msg.created_at).toLocaleTimeString([], {
                                                hour: "2-digit",
                                                minute: "2-digit",
                                            })}
                                        </span>
                                    </div>
                                </div>
                            ))}
                            <div ref={messagesEndRef} />
                        </div>

                        <div className="p-4 border-t border-border bg-card">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={newMessage}
                                    onChange={(e) => setNewMessage(e.target.value)}
                                    onKeyDown={handleKeyPress}
                                    placeholder="Write a message…"
                                    className="flex-1 bg-secondary/20 border border-border rounded-sm px-4 py-3 text-sm font-mono focus:border-primary outline-none transition-all placeholder:text-muted-foreground/50"
                                    disabled={sending}
                                />
                                <button
                                    type="button"
                                    onClick={() => void handleSend()}
                                    disabled={sending || !newMessage.trim()}
                                    className="px-6 rounded-sm bg-primary text-primary-foreground font-bold font-mono hover:bg-primary/90 disabled:opacity-50 transition-colors uppercase text-xs"
                                >
                                    <Send size={16} />
                                </button>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
                        <Inbox className="text-muted-foreground/30" size={48} />
                        <p className="font-mono text-xs uppercase text-muted-foreground">Select a conversation</p>
                        <button
                            type="button"
                            onClick={() => void openCompose()}
                            className="px-4 py-2 rounded-sm bg-primary/15 border border-primary/30 text-[10px] font-black uppercase tracking-widest text-primary"
                        >
                            Start a message
                        </button>
                    </div>
                )}
            </div>

            {composing ? (
                <div className="absolute inset-0 z-20 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                            <div className="flex items-center gap-2">
                                <Users size={14} className="text-primary" />
                                <h3 className="text-xs font-black uppercase tracking-widest">New message</h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => setComposing(false)}
                                className="p-1.5 rounded-sm hover:bg-secondary text-muted-foreground"
                                aria-label="Close"
                            >
                                <X size={14} />
                            </button>
                        </div>
                        <div className="p-4 max-h-80 overflow-y-auto">
                            {composeError ? (
                                <p className="mb-3 text-[11px] text-rose-400 font-mono">{composeError}</p>
                            ) : null}
                            {friendsLoading ? (
                                <div className="flex justify-center py-10">
                                    <Loader2 className="animate-spin text-primary" size={22} />
                                </div>
                            ) : friends.length === 0 ? (
                                <div className="text-center py-6 space-y-3">
                                    <p className="text-xs text-muted-foreground font-mono">
                                        No friends yet. Add connections, or message a seller from a listing.
                                    </p>
                                    <div className="flex flex-col gap-2">
                                        <Link
                                            href={ROUTES.communityFriends}
                                            className="px-3 py-2 rounded-sm border border-border text-[10px] font-black uppercase tracking-widest hover:bg-secondary"
                                            onClick={() => setComposing(false)}
                                        >
                                            Open friends
                                        </Link>
                                        <Link
                                            href={ROUTES.marketplace}
                                            className="px-3 py-2 rounded-sm border border-primary/30 text-[10px] font-black uppercase tracking-widest text-primary hover:bg-primary/10"
                                            onClick={() => setComposing(false)}
                                        >
                                            Browse marketplace
                                        </Link>
                                    </div>
                                </div>
                            ) : (
                                <ul className="space-y-1">
                                    {friends.map((f) => {
                                        const friend = f.friend;
                                        const id = friend?.id || f.friend_id;
                                        const label = friend?.display_name || friend?.username || id.slice(0, 8);
                                        return (
                                            <li key={f.id}>
                                                <button
                                                    type="button"
                                                    disabled={!!startingId}
                                                    onClick={() => void handleStartWithFriend(id)}
                                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-secondary/60 text-left disabled:opacity-50"
                                                >
                                                    <div className="w-8 h-8 rounded-sm bg-secondary border border-border flex items-center justify-center text-[10px] font-bold font-mono">
                                                        {(label[0] || "?").toUpperCase()}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-xs font-bold truncate">{label}</div>
                                                        {friend?.username ? (
                                                            <div className="text-[10px] text-muted-foreground font-mono truncate">
                                                                @{friend.username}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                    {startingId === id ? (
                                                        <Loader2 size={14} className="animate-spin text-primary" />
                                                    ) : (
                                                        <Inbox size={14} className="text-muted-foreground" />
                                                    )}
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    </div>
                </div>
            ) : null}
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
