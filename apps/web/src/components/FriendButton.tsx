"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import {
    sendFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    cancelFriendRequest,
    removeFriend,
    getFriendshipStatus,
} from "@/lib/friends-api";
import {
    UserPlus,
    UserCheck,
    UserX,
    Clock,
    Loader2,
    Check,
    X,
} from "lucide-react";

type FriendshipStatus = "none" | "friends" | "request_sent" | "request_received" | "loading";

interface FriendButtonProps {
    userId: string;
    username: string;
    variant?: "default" | "outline" | "compact";
    /** Fired only after a user-initiated friend action — not on initial status fetch. */
    onStatusChange?: (status: FriendshipStatus) => void;
}

export function FriendButton({
    userId,
    username,
    variant = "default",
    onStatusChange,
}: FriendButtonProps) {
    const { user, isAuthenticated } = useAuth();
    const [status, setStatus] = useState<FriendshipStatus>("loading");
    const [requestId, setRequestId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const isSelf = !!user?.id && user.id === userId;
    const canShow = isAuthenticated && !isSelf;

    useEffect(() => {
        if (!canShow) {
            setStatus("none");
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const data = await getFriendshipStatus(userId);
                if (cancelled) return;
                setStatus(data.status);
                setRequestId(data.request_id ?? null);
                // Do NOT call onStatusChange here — that caused PeopleYouMayKnow to
                // reload → remount → refetch status in an infinite loop.
            } catch {
                if (!cancelled) setStatus("none");
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [userId, canShow]);

    const notify = useCallback(
        (next: FriendshipStatus) => {
            onStatusChange?.(next);
        },
        [onStatusChange],
    );

    const handleAddFriend = async () => {
        setLoading(true);
        try {
            const request = await sendFriendRequest(userId);
            setStatus("request_sent");
            setRequestId(request.id);
            notify("request_sent");
        } catch (err: unknown) {
            console.error("Failed to send friend request:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleAccept = async () => {
        if (!requestId) return;
        setLoading(true);
        try {
            await acceptFriendRequest(requestId);
            setStatus("friends");
            notify("friends");
        } catch (err) {
            console.error("Failed to accept request:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleReject = async () => {
        if (!requestId) return;
        setLoading(true);
        try {
            await rejectFriendRequest(requestId);
            setStatus("none");
            setRequestId(null);
            notify("none");
        } catch (err) {
            console.error("Failed to reject request:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleCancel = async () => {
        if (!requestId) return;
        setLoading(true);
        try {
            await cancelFriendRequest(requestId);
            setStatus("none");
            setRequestId(null);
            notify("none");
        } catch (err) {
            console.error("Failed to cancel request:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleRemove = async () => {
        setLoading(true);
        try {
            await removeFriend(userId);
            setStatus("none");
            notify("none");
        } catch (err) {
            console.error("Failed to remove friend:", err);
        } finally {
            setLoading(false);
        }
    };

    if (!canShow) {
        return null;
    }

    // Compact variant (icon only)
    if (variant === "compact") {
        switch (status) {
            case "friends":
                return (
                    <button
                        onClick={handleRemove}
                        disabled={loading}
                        className="p-2 rounded-lg bg-success/10 text-success hover:bg-success/20 transition-colors"
                        title="Friends (click to remove)"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                    </button>
                );
            case "request_sent":
                return (
                    <button
                        onClick={handleCancel}
                        disabled={loading}
                        className="p-2 rounded-lg bg-warning/10 text-warning hover:bg-warning/20 transition-colors"
                        title="Request pending (click to cancel)"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
                    </button>
                );
            case "request_received":
                return (
                    <div className="flex gap-1">
                        <button
                            onClick={handleAccept}
                            disabled={loading}
                            className="p-2 rounded-lg bg-success/10 text-success hover:bg-success/20 transition-colors"
                            title="Accept request"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        </button>
                        <button
                            onClick={handleReject}
                            disabled={loading}
                            className="p-2 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                            title="Reject request"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                        </button>
                    </div>
                );
            case "loading":
                return (
                    <div className="p-2 rounded-lg bg-secondary/50 text-muted-foreground" aria-hidden>
                        <Loader2 className="w-4 h-4 animate-spin" />
                    </div>
                );
            default:
                return (
                    <button
                        onClick={handleAddFriend}
                        disabled={loading}
                        className="p-2 rounded-lg bg-secondary/50 hover:bg-primary/10 hover:text-primary transition-colors"
                        title={`Add ${username}`}
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                    </button>
                );
        }
    }

    // Outline variant
    if (variant === "outline") {
        switch (status) {
            case "friends":
                return (
                    <button
                        onClick={handleRemove}
                        disabled={loading}
                        className="inline-flex items-center gap-2 px-4 py-2 border border-success/30 text-success rounded-lg font-mono text-sm hover:bg-success/10 transition-colors"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                        Friends
                    </button>
                );
            case "request_sent":
                return (
                    <button
                        onClick={handleCancel}
                        disabled={loading}
                        className="inline-flex items-center gap-2 px-4 py-2 border border-warning/30 text-warning rounded-lg font-mono text-sm hover:bg-warning/10 transition-colors"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
                        Pending
                    </button>
                );
            case "request_received":
                return (
                    <div className="flex gap-2">
                        <button
                            onClick={handleAccept}
                            disabled={loading}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-success text-primary-foreground rounded-lg font-mono text-sm hover:bg-success transition-colors"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            Accept
                        </button>
                        <button
                            onClick={handleReject}
                            disabled={loading}
                            className="inline-flex items-center gap-2 px-4 py-2 border border-border rounded-lg font-mono text-sm hover:bg-secondary transition-colors"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                            Decline
                        </button>
                    </div>
                );
            case "loading":
                return (
                    <button disabled className="inline-flex items-center gap-2 px-4 py-2 border border-border rounded-lg font-mono text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                    </button>
                );
            default:
                return (
                    <button
                        onClick={handleAddFriend}
                        disabled={loading}
                        className="inline-flex items-center gap-2 px-4 py-2 border border-primary/50 text-primary rounded-lg font-mono text-sm hover:bg-primary/10 transition-colors"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                        Add Friend
                    </button>
                );
        }
    }

    // Default variant
    switch (status) {
        case "friends":
            return (
                <div className="relative group">
                    <button className="inline-flex items-center gap-2 px-6 py-3 bg-success/10 text-success rounded-lg font-bold font-mono text-sm">
                        <UserCheck className="w-4 h-4" />
                        Friends
                    </button>
                    <button
                        onClick={handleRemove}
                        disabled={loading}
                        className="absolute inset-0 inline-flex items-center justify-center gap-2 px-6 py-3 bg-destructive/10 text-destructive rounded-lg font-bold font-mono text-sm opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserX className="w-4 h-4" />}
                        Remove
                    </button>
                </div>
            );
        case "request_sent":
            return (
                <button
                    onClick={handleCancel}
                    disabled={loading}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-warning/10 text-warning rounded-lg font-bold font-mono text-sm hover:bg-warning/20 transition-colors"
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
                    Request Sent
                </button>
            );
        case "request_received":
            return (
                <div className="flex gap-2">
                    <button
                        onClick={handleAccept}
                        disabled={loading}
                        className="inline-flex items-center gap-2 px-6 py-3 bg-success text-primary-foreground rounded-lg font-bold font-mono text-sm hover:bg-success transition-colors"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        Accept
                    </button>
                    <button
                        onClick={handleReject}
                        disabled={loading}
                        className="inline-flex items-center gap-2 px-6 py-3 bg-secondary text-foreground rounded-lg font-bold font-mono text-sm hover:bg-secondary/80 transition-colors"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                        Decline
                    </button>
                </div>
            );
        case "loading":
            return (
                <button disabled className="inline-flex items-center gap-2 px-6 py-3 bg-secondary text-muted-foreground rounded-lg font-bold font-mono text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                </button>
            );
        default:
            return (
                <button
                    onClick={handleAddFriend}
                    disabled={loading}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-bold font-mono text-sm hover:bg-primary/90 transition-colors"
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                    Add Friend
                </button>
            );
    }
}

export default FriendButton;
