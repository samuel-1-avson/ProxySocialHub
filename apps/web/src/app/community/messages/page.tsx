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
    PageHeading,
    Loading,
    EmptyState,
    DataError,
} from "@/components/workspace/Patterns";
import { Send, Loader2 } from "lucide-react";

function MessagesContent() {
    const { user } = useAuth();
    const { subscribe, isConnected } = useRealtime();
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [newMessage, setNewMessage] = useState("");
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<unknown>();
    const [messageError, setMessageError] = useState<{ conversationId: string; error: unknown }>();
    const [reload, setReload] = useState(0);
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState("");
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
            setLoading(true);
            setLoadError(undefined);
            try {
                const data = await getConversations();
                setConversations(data.conversations || []);
                if (data.conversations?.length > 0 && !selectedConv) {
                    setSelectedConv(data.conversations[0]);
                }
            } catch (err) {
                setLoadError(err);
            } finally {
                setLoading(false);
            }
        }
        fetchConversations();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reload]);

    useEffect(() => {
        let current = true;
        async function fetchMessages() {
            if (!selectedConv) return;
            try {
                const data = await getMessages(selectedConv.id);
                if (!current) return;
                setMessageError(undefined);
                setMessages(data.messages || []);
                setTimeout(() => {
                    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
                }, 100);
            } catch (err) {
                if (current && selectedConv) setMessageError({ conversationId: selectedConv.id, error: err });
            }
        }
        fetchMessages();
        return () => { current = false; };
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
                    last_message_at: payload.message!.created_at || conv.last_message_at,
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
        setSendError("");
        try {
            const message = await sendMessage(selectedConv.id, newMessage.trim());
            setMessages([...messages, message]);
            setNewMessage("");
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        } catch (err) {
            console.error(err);
            setSendError(err instanceof Error ? err.message : "Failed to send message");
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
                conv.other_participant_name ||
                ""
            ).toLowerCase();
            const preview = (conv.last_message?.content || "").toLowerCase();
            return name.includes(q) || preview.includes(q);
        });
    }, [conversations, searchQuery]);

    return (
        <div className="ui-page min-w-0">
            <PageHeading
                eyebrow="Community"
                title="Messages"
                description="Message friends and sellers. Conversations stay on this account."
                actions={
                    <button type="button" onClick={() => void openCompose()} className="ui-button">
                        New message
                    </button>
                }
            />

            <p className="ui-note">
                {isConnected ? "Realtime connected." : "Realtime reconnecting."}
            </p>

            {composing ? (
                <section className="ui-surface min-w-0" aria-label="New message">
                    <div className="ui-section-heading">
                        <h2>New message</h2>
                        <button
                            type="button"
                            onClick={() => setComposing(false)}
                            className="ui-button ghost small"
                            aria-label="Close"
                        >
                            Close
                        </button>
                    </div>
                    {composeError ? (
                        <p className="text-sm text-foreground mb-3" role="alert">
                            {composeError}
                        </p>
                    ) : null}
                    {friendsLoading ? (
                        <Loading label="Loading friends…" />
                    ) : friends.length === 0 ? (
                        <EmptyState
                            title="No friends yet"
                            description="Add connections, or message a seller from a listing."
                            href={ROUTES.communityFriends}
                            action="Open friends"
                        />
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
                                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[8px] text-left min-w-0 disabled:opacity-50 hover:bg-secondary"
                                        >
                                            <span className="ui-region">
                                                {(label[0] || "?").toUpperCase()}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-medium truncate">{label}</div>
                                                {friend?.username ? (
                                                    <div className="text-sm text-muted-foreground truncate">
                                                        @{friend.username}
                                                    </div>
                                                ) : null}
                                            </div>
                                            {startingId === id ? (
                                                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                                            ) : null}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    {friends.length === 0 && !friendsLoading ? (
                        <Link href={ROUTES.marketplace} className="ui-link text-sm mt-3 inline-block">
                            Browse marketplace
                        </Link>
                    ) : null}
                </section>
            ) : null}

            <div className="flex flex-col lg:flex-row gap-4 min-w-0">
                <section className="ui-surface w-full lg:max-w-xs min-w-0 lg:shrink-0">
                    <label className="ui-field">
                        Search conversations
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search conversations…"
                            className="ui-input w-full"
                        />
                    </label>

                    <div className="mt-4 max-h-[28rem] overflow-y-auto min-w-0">
                        {loading ? (
                            <Loading label="Loading conversations…" />
                        ) : loadError ? (
                            <DataError error={loadError} retry={() => setReload(value => value + 1)} />
                        ) : filteredConversations.length === 0 ? (
                            <div className="py-6 space-y-3">
                                <p className="text-sm text-muted-foreground">No conversations</p>
                                <p className="ui-note">
                                    Message a friend or inquire on a marketplace listing.
                                </p>
                                <div className="flex flex-col gap-2">
                                    <button
                                        type="button"
                                        onClick={() => void openCompose()}
                                        className="ui-button w-full"
                                    >
                                        Message a friend
                                    </button>
                                    <Link href={ROUTES.marketplace} className="ui-button secondary w-full">
                                        Browse marketplace
                                    </Link>
                                </div>
                            </div>
                        ) : (
                            filteredConversations.map((conv) => (
                                <button
                                    key={conv.id}
                                    type="button"
                                    className={`w-full p-3 flex items-center gap-3 text-left min-w-0 border-b border-border ${
                                        selectedConv?.id === conv.id ? "bg-secondary" : ""
                                    }`}
                                    onClick={() => setSelectedConv(conv)}
                                >
                                    <span className="ui-region overflow-hidden">
                                        {conv.other_participant?.avatar_url ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={conv.other_participant.avatar_url}
                                                alt=""
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            (
                                                conv.other_participant?.display_name?.[0] ||
                                                conv.other_participant?.username?.[0] ||
                                                "?"
                                            ).toUpperCase()
                                        )}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-2 mb-1">
                                            <span className="text-sm font-medium truncate">
                                                {conv.other_participant?.username ? `@${conv.other_participant.username}` : conv.other_participant?.display_name || conv.other_participant_name || 'Unknown participant'}
                                            </span>
                                            <span className="text-sm text-muted-foreground shrink-0">
                                                {conv.last_message_at && !Number.isNaN(Date.parse(conv.last_message_at)) ? new Date(conv.last_message_at).toLocaleDateString([], {
                                                    month: "short",
                                                    day: "numeric",
                                                }) : 'Time not reported'}
                                            </span>
                                        </div>
                                        <p className="text-sm text-muted-foreground truncate">
                                            {conv.last_message?.content || "No messages yet"}
                                        </p>
                                    </div>
                                    {conv.unread_count && conv.unread_count > 0 ? (
                                        <span className="ui-status good">Unread</span>
                                    ) : null}
                                </button>
                            ))
                        )}
                    </div>
                </section>

                <section className="ui-surface flex-1 min-w-0 flex flex-col">
                    {selectedConv ? (
                        <>
                            {messageError?.conversationId === selectedConv.id && <DataError error={messageError.error} />}
                            <div className="pb-4 border-b border-border min-w-0">
                                <h2 className="text-[18px] font-semibold leading-tight">
                                    {selectedConv.other_participant?.display_name ||
                                        selectedConv.other_participant?.username || selectedConv.other_participant_name || 'Unknown participant'}
                                </h2>
                                {(selectedConv.other_participant?.username || selectedConv.other_participant?.id) ? <Link
                                    href={`/profile/${
                                        selectedConv.other_participant?.username ||
                                        selectedConv.other_participant?.id
                                    }`}
                                    className="ui-link text-sm"
                                >
                                    View profile
                                </Link> : <p className="ui-note">Profile unavailable</p>}
                            </div>

                            <div className="flex-1 overflow-y-auto py-4 space-y-4 min-h-[16rem] min-w-0">
                                {messages.filter(msg => msg.conversation_id === selectedConv.id).map((msg) => (
                                    <div
                                        key={msg.id}
                                        className={`flex ${msg.sender_id === user?.id ? "justify-end" : "justify-start"}`}
                                    >
                                        <div
                                            className={`max-w-full sm:max-w-[70%] p-4 rounded-[8px] min-w-0 ${
                                                msg.sender_id === user?.id
                                                    ? "bg-secondary text-foreground"
                                                    : "bg-card border border-border text-foreground"
                                            }`}
                                        >
                                            <p className="text-sm leading-relaxed break-words">{msg.content}</p>
                                            <span className="text-sm text-muted-foreground mt-2 block">
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

                            <form
                                className="pt-4 border-t border-border min-w-0"
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    void handleSend();
                                }}
                            >
                                <label className="ui-field">
                                    Message
                                    <textarea
                                        value={newMessage}
                                        onChange={(e) => setNewMessage(e.target.value)}
                                        onKeyDown={handleKeyPress}
                                        placeholder="Write a message…"
                                        rows={3}
                                        className="ui-input w-full"
                                        disabled={sending}
                                    />
                                </label>
                                {sendError ? (
                                    <p className="text-sm mt-2" role="alert">
                                        {sendError}
                                    </p>
                                ) : null}
                                <button
                                    type="submit"
                                    disabled={sending || !newMessage.trim()}
                                    className="ui-button mt-3 w-full sm:w-auto"
                                >
                                    {sending ? (
                                        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                                    ) : (
                                        <Send size={16} aria-hidden="true" />
                                    )}
                                    Send
                                </button>
                            </form>
                        </>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center gap-4 py-8 text-center">
                            <p className="text-sm text-muted-foreground">Select a conversation</p>
                            <button
                                type="button"
                                onClick={() => void openCompose()}
                                className="ui-button"
                            >
                                Start a message
                            </button>
                        </div>
                    )}
                </section>
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
