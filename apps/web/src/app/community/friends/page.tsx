"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import {
    acceptFriendRequest,
    getFriendRequests,
    getFriends,
    rejectFriendRequest,
    removeFriend,
    type FriendRequest,
    type Friendship,
} from "@/lib/friends-api";
import { PeopleYouMayKnow } from "@/components/PeopleYouMayKnow";
import { GlassCard } from "@/components/ui/glass-card";
import { ROUTES } from "@/lib/navigation/routes";
import { Check, Loader2, UserMinus, Users, X } from "lucide-react";

export default function FriendsPage() {
    const { isAuthenticated } = useAuth();
    const [friends, setFriends] = useState<Friendship[]>([]);
    const [incoming, setIncoming] = useState<FriendRequest[]>([]);
    const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [busyId, setBusyId] = useState<string | null>(null);

    const refresh = async () => {
        setLoading(true);
        setError("");
        try {
            const [f, reqs] = await Promise.all([getFriends(), getFriendRequests()]);
            setFriends(f.friends || []);
            setIncoming(reqs.incoming || []);
            setOutgoing(reqs.outgoing || []);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load friends");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isAuthenticated) void refresh();
        else setLoading(false);
    }, [isAuthenticated]);

    if (!isAuthenticated) {
        return (
            <div className="max-w-3xl mx-auto py-16 px-4 text-center space-y-4">
                <Users className="mx-auto text-primary" size={32} />
                <h1 className="text-2xl font-black uppercase tracking-tight">Friends</h1>
                <p className="text-muted-foreground text-sm">Sign in to manage friend requests and connections.</p>
                <Link href={ROUTES.login} className="text-primary text-sm font-bold uppercase tracking-widest">
                    Sign in
                </Link>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto py-10 px-4 space-y-8" data-testid="community-friends">
            <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-primary mb-2">Community</p>
                <h1 className="text-3xl font-black uppercase tracking-tight italic">
                    Friends <span className="text-primary">network</span>
                </h1>
                <p className="text-sm text-muted-foreground mt-2">
                    Accept requests, manage connections, and discover people you may know.
                </p>
            </div>

            {error && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">{error}</div>
            )}

            {loading ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="animate-spin text-primary" />
                </div>
            ) : (
                <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6">
                    <div className="space-y-6">
                        <GlassCard className="!p-6 space-y-4">
                            <h2 className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                                Incoming requests ({incoming.length})
                            </h2>
                            {incoming.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No pending requests.</p>
                            ) : (
                                <ul className="space-y-3">
                                    {incoming.map((r) => (
                                        <li key={r.id} className="flex items-center justify-between gap-3">
                                            <Link
                                                href={`/profile/${r.sender?.username || r.sender_id}`}
                                                className="text-sm font-bold hover:text-primary"
                                            >
                                                {r.sender?.display_name || r.sender?.username || "User"}
                                            </Link>
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    disabled={busyId === r.id}
                                                    onClick={async () => {
                                                        setBusyId(r.id);
                                                        try {
                                                            await acceptFriendRequest(r.id);
                                                            await refresh();
                                                        } finally {
                                                            setBusyId(null);
                                                        }
                                                    }}
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold uppercase"
                                                >
                                                    <Check size={12} /> Accept
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={busyId === r.id}
                                                    onClick={async () => {
                                                        setBusyId(r.id);
                                                        try {
                                                            await rejectFriendRequest(r.id);
                                                            await refresh();
                                                        } finally {
                                                            setBusyId(null);
                                                        }
                                                    }}
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/10 text-[10px] font-bold uppercase text-muted-foreground"
                                                >
                                                    <X size={12} /> Decline
                                                </button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </GlassCard>

                        <GlassCard className="!p-6 space-y-4">
                            <h2 className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                                Your friends ({friends.length})
                            </h2>
                            {friends.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No friends yet — try suggestions.</p>
                            ) : (
                                <ul className="space-y-3">
                                    {friends.map((f) => (
                                        <li key={f.id} className="flex items-center justify-between gap-3">
                                            <Link
                                                href={`/profile/${f.friend?.username || f.friend_id}`}
                                                className="text-sm font-bold hover:text-primary"
                                            >
                                                {f.friend?.display_name || f.friend?.username || "Friend"}
                                            </Link>
                                            <button
                                                type="button"
                                                disabled={busyId === f.friend_id}
                                                onClick={async () => {
                                                    setBusyId(f.friend_id);
                                                    try {
                                                        await removeFriend(f.friend_id);
                                                        await refresh();
                                                    } finally {
                                                        setBusyId(null);
                                                    }
                                                }}
                                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/10 text-[10px] font-bold uppercase text-muted-foreground"
                                            >
                                                <UserMinus size={12} /> Remove
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </GlassCard>

                        {outgoing.length > 0 && (
                            <GlassCard className="!p-6 space-y-3">
                                <h2 className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                                    Outgoing ({outgoing.length})
                                </h2>
                                <ul className="space-y-2 text-sm text-muted-foreground">
                                    {outgoing.map((r) => (
                                        <li key={r.id}>
                                            Waiting on {r.receiver?.display_name || r.receiver?.username || "user"}
                                        </li>
                                    ))}
                                </ul>
                            </GlassCard>
                        )}
                    </div>

                    <PeopleYouMayKnow limit={8} showViewAll={false} />
                </div>
            )}
        </div>
    );
}
