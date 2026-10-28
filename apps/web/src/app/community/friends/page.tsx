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
import { ConfirmDialog } from "@/components/patterns/ConfirmDialog";
import { ROUTES } from "@/lib/navigation/routes";
import {
    PageHeading,
    Loading,
    DataError,
    EmptyState,
} from "@/components/workspace/Patterns";
import { Check } from "lucide-react";

type PendingAction =
    | { kind: "reject"; id: string; name: string }
    | { kind: "remove"; id: string; name: string }
    | null;

export default function FriendsPage() {
    const { isAuthenticated } = useAuth();
    const [friends, setFriends] = useState<Friendship[]>([]);
    const [incoming, setIncoming] = useState<FriendRequest[]>([]);
    const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [busyId, setBusyId] = useState<string | null>(null);
    const [pending, setPending] = useState<PendingAction>(null);

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
            <div className="ui-page">
                <PageHeading
                    eyebrow="Community"
                    title="Friends"
                    description="Sign in to manage friend requests and connections."
                    actions={
                        <Link href={ROUTES.login} className="ui-button">
                            Sign in
                        </Link>
                    }
                />
            </div>
        );
    }

    const runPending = async () => {
        if (!pending) return;
        const action = pending;
        setBusyId(action.id);
        try {
            if (action.kind === "reject") {
                await rejectFriendRequest(action.id);
            } else {
                await removeFriend(action.id);
            }
            setPending(null);
            await refresh();
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="ui-page" data-testid="community-friends">
            <PageHeading
                eyebrow="Community"
                title="Friends"
                description="Accept requests, manage connections, and discover people you may know."
            />

            {error ? <DataError error={new Error(error)} retry={() => void refresh()} /> : null}

            {loading ? (
                <Loading label="Loading friends…" />
            ) : (
                <div className="ui-columns">
                    <div className="space-y-6 min-w-0">
                        <section className="ui-surface">
                            <h2>Incoming requests ({incoming.length})</h2>
                            {incoming.length === 0 ? (
                                <p className="text-sm text-muted-foreground mt-3">No pending requests.</p>
                            ) : (
                                <ul>
                                    {incoming.map((r) => (
                                        <li key={r.id} className="ui-row">
                                            <Link
                                                href={`/profile/${r.sender?.username || r.sender_id}`}
                                                className="ui-link text-sm"
                                            >
                                                {r.sender?.display_name || r.sender?.username || "User"}
                                            </Link>
                                            <div className="flex flex-wrap gap-2">
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
                                                    className="ui-button small"
                                                >
                                                    <Check size={14} aria-hidden="true" /> Accept
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={busyId === r.id}
                                                    onClick={() =>
                                                        setPending({
                                                            kind: "reject",
                                                            id: r.id,
                                                            name:
                                                                r.sender?.display_name ||
                                                                r.sender?.username ||
                                                                "this user",
                                                        })
                                                    }
                                                    className="ui-button small secondary"
                                                >
                                                    Decline
                                                </button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        <section className="ui-surface">
                            <h2>Your friends ({friends.length})</h2>
                            {friends.length === 0 ? (
                                <EmptyState
                                    title="No friends yet"
                                    description="Try suggestions to find people you may know."
                                />
                            ) : (
                                <ul>
                                    {friends.map((f) => (
                                        <li key={f.id} className="ui-row">
                                            <Link
                                                href={`/profile/${f.friend?.username || f.friend_id}`}
                                                className="ui-link text-sm"
                                            >
                                                {f.friend?.display_name || f.friend?.username || "Friend"}
                                            </Link>
                                            <button
                                                type="button"
                                                disabled={busyId === f.friend_id}
                                                onClick={() =>
                                                    setPending({
                                                        kind: "remove",
                                                        id: f.friend_id,
                                                        name:
                                                            f.friend?.display_name ||
                                                            f.friend?.username ||
                                                            "this friend",
                                                    })
                                                }
                                                className="ui-button small secondary"
                                            >
                                                Remove
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        {outgoing.length > 0 && (
                            <section className="ui-surface">
                                <h2>Outgoing ({outgoing.length})</h2>
                                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                                    {outgoing.map((r) => (
                                        <li key={r.id}>
                                            Waiting on {r.receiver?.display_name || r.receiver?.username || "user"}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}
                    </div>

                    <PeopleYouMayKnow limit={8} showViewAll={false} />
                </div>
            )}

            <ConfirmDialog
                open={pending !== null}
                onOpenChange={(open) => {
                    if (!open) setPending(null);
                }}
                title={pending?.kind === "remove" ? "Remove friend" : "Decline request"}
                description={
                    pending?.kind === "remove"
                        ? `Remove ${pending.name} from your friends?`
                        : pending
                          ? `Decline the friend request from ${pending.name}?`
                          : undefined
                }
                confirmLabel={pending?.kind === "remove" ? "Remove" : "Decline"}
                cancelLabel="Cancel"
                destructive
                loading={busyId !== null}
                onConfirm={() => void runPending()}
            />
        </div>
    );
}
