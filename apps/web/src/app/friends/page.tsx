"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import {
    getFriends,
    getFriendRequests,
    removeFriend,
    acceptFriendRequest,
    rejectFriendRequest,
    getPeopleYouMayKnow,
    type Friendship,
    type FriendRequest,
    type SuggestedUser,
} from "@/lib/friends-api";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { GlassCard } from "@/components/ui/glass-card";
import {
    Users,
    UserPlus,
    UserCheck,
    UserX,
    Clock,
    Loader2,
    MessageSquare,
    MoreHorizontal,
    Check,
    X,
    Sparkles,
    User,
    Search,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

function FriendsPageContent() {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<"friends" | "requests" | "suggestions">("friends");
    const [friends, setFriends] = useState<Friendship[]>([]);
    const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
    const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([]);
    const [suggestions, setSuggestions] = useState<SuggestedUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState<string | null>(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);
            const [friendsData, requestsData, suggestionsData] = await Promise.all([
                getFriends(),
                getFriendRequests(),
                getPeopleYouMayKnow(10),
            ]);
            setFriends(friendsData.friends || []);
            setIncomingRequests(requestsData.incoming || []);
            setOutgoingRequests(requestsData.outgoing || []);
            setSuggestions(suggestionsData.suggestions || []);
        } catch (err) {
            console.error("Failed to load friends data:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleAcceptRequest = async (requestId: string) => {
        setProcessingId(requestId);
        try {
            await acceptFriendRequest(requestId);
            await loadData();
        } catch (err) {
            console.error("Failed to accept request:", err);
        } finally {
            setProcessingId(null);
        }
    };

    const handleRejectRequest = async (requestId: string) => {
        setProcessingId(requestId);
        try {
            await rejectFriendRequest(requestId);
            await loadData();
        } catch (err) {
            console.error("Failed to reject request:", err);
        } finally {
            setProcessingId(null);
        }
    };

    const handleRemoveFriend = async (friendId: string) => {
        if (!confirm("Are you sure you want to remove this friend?")) return;
        setProcessingId(friendId);
        try {
            await removeFriend(friendId);
            await loadData();
        } catch (err) {
            console.error("Failed to remove friend:", err);
        } finally {
            setProcessingId(null);
        }
    };

    const pendingCount = incomingRequests.length;

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold font-mono tracking-tight flex items-center gap-3">
                        <Users className="w-8 h-8 text-primary" />
                        Friends
                    </h1>
                    <p className="text-muted-foreground mt-2">
                        Manage your connections and discover new people
                    </p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 p-1 bg-secondary/20 rounded-lg w-fit">
                {[
                    { id: "friends", label: "Friends", icon: UserCheck, count: friends.length },
                    {
                        id: "requests",
                        label: "Requests",
                        icon: UserPlus,
                        count: pendingCount,
                    },
                    { id: "suggestions", label: "Suggestions", icon: Sparkles },
                ].map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as typeof activeTab)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-md font-mono text-sm font-medium transition-all ${
                            activeTab === tab.id
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                        }`}
                    >
                        <tab.icon className="w-4 h-4" />
                        {tab.label}
                        {tab.count ? (
                            <span
                                className={`ml-1 px-2 py-0.5 text-xs rounded-full ${
                                    activeTab === tab.id
                                        ? "bg-primary-foreground/20"
                                        : "bg-primary/10 text-primary"
                                }`}
                            >
                                {tab.count}
                            </span>
                        ) : null}
                    </button>
                ))}
            </div>

            {/* Content */}
            {activeTab === "friends" && (
                <>
                    {friends.length === 0 ? (
                        <GlassCard className="!p-12 text-center">
                            <Users className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
                            <h3 className="font-bold font-mono text-lg mb-2">No friends yet</h3>
                            <p className="text-muted-foreground text-sm mb-4">
                                Connect with other users to build your network
                            </p>
                            <button
                                onClick={() => setActiveTab("suggestions")}
                                className="inline-flex items-center gap-2 px-6 py-2 bg-primary text-primary-foreground rounded-lg font-bold font-mono text-sm hover:bg-primary/90 transition-colors"
                            >
                                <Sparkles className="w-4 h-4" />
                                Find People
                            </button>
                        </GlassCard>
                    ) : (
                        <div className="grid md:grid-cols-2 gap-4">
                            {friends.map((friendship) => (
                                <FriendCard
                                    key={friendship.id}
                                    friendship={friendship}
                                    onRemove={() => handleRemoveFriend(friendship.friend_id)}
                                    processing={processingId === friendship.friend_id}
                                />
                            ))}
                        </div>
                    )}
                </>
            )}

            {activeTab === "requests" && (
                <div className="space-y-6">
                    {/* Incoming Requests */}
                    {incomingRequests.length > 0 && (
                        <div>
                            <h3 className="font-bold font-mono mb-4 flex items-center gap-2">
                                <UserPlus className="w-5 h-5 text-primary" />
                                Incoming Requests ({incomingRequests.length})
                            </h3>
                            <div className="grid md:grid-cols-2 gap-4">
                                {incomingRequests.map((request) => (
                                    <RequestCard
                                        key={request.id}
                                        request={request}
                                        type="incoming"
                                        onAccept={() => handleAcceptRequest(request.id)}
                                        onReject={() => handleRejectRequest(request.id)}
                                        processing={processingId === request.id}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Outgoing Requests */}
                    {outgoingRequests.length > 0 && (
                        <div>
                            <h3 className="font-bold font-mono mb-4 flex items-center gap-2">
                                <Clock className="w-5 h-5 text-amber-500" />
                                Sent Requests ({outgoingRequests.length})
                            </h3>
                            <div className="grid md:grid-cols-2 gap-4">
                                {outgoingRequests.map((request) => (
                                    <RequestCard
                                        key={request.id}
                                        request={request}
                                        type="outgoing"
                                        processing={processingId === request.id}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {incomingRequests.length === 0 && outgoingRequests.length === 0 && (
                        <GlassCard className="!p-12 text-center">
                            <UserPlus className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
                            <h3 className="font-bold font-mono text-lg mb-2">No pending requests</h3>
                            <p className="text-muted-foreground text-sm">
                                You don&apos;t have any friend requests at the moment
                            </p>
                        </GlassCard>
                    )}
                </div>
            )}

            {activeTab === "suggestions" && (
                <>
                    {suggestions.length === 0 ? (
                        <GlassCard className="!p-12 text-center">
                            <Sparkles className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
                            <h3 className="font-bold font-mono text-lg mb-2">No suggestions yet</h3>
                            <p className="text-muted-foreground text-sm">
                                We&apos;ll suggest people based on your activity and connections
                            </p>
                        </GlassCard>
                    ) : (
                        <div className="grid md:grid-cols-2 gap-4">
                            {suggestions.map((suggestion) => (
                                <SuggestionCard key={suggestion.id} user={suggestion} />
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

// Friend Card Component
interface FriendCardProps {
    friendship: Friendship;
    onRemove: () => void;
    processing: boolean;
}

function FriendCard({ friendship, onRemove, processing }: FriendCardProps) {
    const friend = friendship.friend;
    if (!friend) return null;

    return (
        <GlassCard className="!p-4 group">
            <div className="flex items-center gap-4">
                <div className="relative">
                    <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center overflow-hidden">
                        {friend.avatar_url ? (
                            <img src={friend.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                            <User className="w-7 h-7 text-muted-foreground" />
                        )}
                    </div>
                    {friend.is_online && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-emerald-500 rounded-full border-2 border-card" />
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <Link
                        href={`/profile/${friend.username}`}
                        className="font-bold font-mono hover:text-primary transition-colors"
                    >
                        @{friend.username}
                    </Link>
                    {friend.display_name && (
                        <p className="text-sm text-muted-foreground truncate">{friend.display_name}</p>
                    )}
                    {friend.last_seen_at && !friend.is_online && (
                        <p className="text-xs text-muted-foreground">
                            Last seen {formatDistanceToNow(new Date(friend.last_seen_at))} ago
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <Link
                        href={`/messages?to=${friend.id}`}
                        className="p-2 rounded-lg hover:bg-secondary transition-colors"
                        title="Send message"
                    >
                        <MessageSquare className="w-4 h-4 text-muted-foreground" />
                    </Link>
                    <button
                        onClick={onRemove}
                        disabled={processing}
                        className="p-2 rounded-lg hover:bg-red-500/10 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                        title="Remove friend"
                    >
                        {processing ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <UserX className="w-4 h-4" />
                        )}
                    </button>
                </div>
            </div>
        </GlassCard>
    );
}

// Request Card Component
interface RequestCardProps {
    request: FriendRequest;
    type: "incoming" | "outgoing";
    onAccept?: () => void;
    onReject?: () => void;
    processing: boolean;
}

function RequestCard({ request, type, onAccept, onReject, processing }: RequestCardProps) {
    const user = type === "incoming" ? request.sender : request.receiver;
    if (!user) return null;

    return (
        <GlassCard className="!p-4">
            <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center overflow-hidden">
                    {user.avatar_url ? (
                        <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                        <User className="w-7 h-7 text-muted-foreground" />
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <Link
                        href={`/profile/${user.username}`}
                        className="font-bold font-mono hover:text-primary transition-colors"
                    >
                        @{user.username}
                    </Link>
                    {user.display_name && (
                        <p className="text-sm text-muted-foreground truncate">{user.display_name}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                        {type === "incoming" ? "Wants to be friends" : "Request sent"} •{" "}
                        {formatDistanceToNow(new Date(request.created_at))} ago
                    </p>
                </div>
                {type === "incoming" ? (
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onAccept}
                            disabled={processing}
                            className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 transition-colors"
                            title="Accept"
                        >
                            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        </button>
                        <button
                            onClick={onReject}
                            disabled={processing}
                            className="p-2 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                            title="Decline"
                        >
                            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                        </button>
                    </div>
                ) : (
                    <span className="text-xs text-amber-500 font-mono flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Pending
                    </span>
                )}
            </div>
        </GlassCard>
    );
}

// Suggestion Card Component
import { FriendButton } from "@/components/FriendButton";

interface SuggestionCardProps {
    user: SuggestedUser;
}

function SuggestionCard({ user }: SuggestionCardProps) {
    return (
        <GlassCard className="!p-4">
            <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center overflow-hidden">
                    {user.avatar_url ? (
                        <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                        <User className="w-7 h-7 text-muted-foreground" />
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <Link
                        href={`/profile/${user.username}`}
                        className="font-bold font-mono hover:text-primary transition-colors"
                    >
                        @{user.username}
                    </Link>
                    {user.display_name && (
                        <p className="text-sm text-muted-foreground truncate">{user.display_name}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                        {user.reason === "mutual_friends" && user.mutual_count
                            ? `${user.mutual_count} mutual friends`
                            : user.reason === "similar_skills"
                            ? "Similar skills"
                            : "Suggested for you"}
                    </p>
                </div>
                <FriendButton userId={user.id} username={user.username} variant="compact" />
            </div>
        </GlassCard>
    );
}

export default function FriendsPage() {
    return (
        <ProtectedRoute>
            <FriendsPageContent />
        </ProtectedRoute>
    );
}
