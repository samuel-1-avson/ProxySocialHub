"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getPeopleYouMayKnow, type SuggestedUser } from "@/lib/friends-api";
import { GlassCard } from "@/components/ui/glass-card";
import { Sparkles, User, Loader2, ChevronRight } from "lucide-react";
import { FriendButton } from "./FriendButton";

interface PeopleYouMayKnowProps {
    limit?: number;
    showViewAll?: boolean;
}

export function PeopleYouMayKnow({ limit = 5, showViewAll = true }: PeopleYouMayKnowProps) {
    const [suggestions, setSuggestions] = useState<SuggestedUser[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadSuggestions();
    }, []);

    const loadSuggestions = async () => {
        try {
            setLoading(true);
            const data = await getPeopleYouMayKnow(limit);
            setSuggestions(data.suggestions || []);
        } catch (err) {
            console.error("Failed to load suggestions:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleFriendStatusChange = () => {
        // Refresh suggestions after friend action
        loadSuggestions();
    };

    if (loading) {
        return (
            <GlassCard className="!p-6">
                <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
            </GlassCard>
        );
    }

    if (suggestions.length === 0) {
        return null;
    }

    return (
        <GlassCard className="!p-6">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-primary" />
                    <h3 className="font-bold font-mono">People You May Know</h3>
                </div>
                {showViewAll && (
                    <Link
                        href="/friends?suggestions"
                        className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                    >
                        View all
                        <ChevronRight className="w-4 h-4" />
                    </Link>
                )}
            </div>

            <div className="space-y-4">
                {suggestions.map((user) => (
                    <div key={user.id} className="flex items-center gap-3">
                        <Link href={`/profile/${user.username}`} className="shrink-0">
                            <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center overflow-hidden hover:ring-2 hover:ring-primary/50 transition-all">
                                {user.avatar_url ? (
                                    <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    <User className="w-5 h-5 text-muted-foreground" />
                                )}
                            </div>
                        </Link>
                        <div className="flex-1 min-w-0">
                            <Link
                                href={`/profile/${user.username}`}
                                className="font-medium font-mono text-sm hover:text-primary transition-colors block truncate"
                            >
                                @{user.username}
                            </Link>
                            <p className="text-xs text-muted-foreground truncate">
                                {user.reason === "mutual_friends" && user.mutual_count
                                    ? `${user.mutual_count} mutual friends`
                                    : user.reason === "similar_skills"
                                    ? "Similar skills"
                                    : "Suggested for you"}
                            </p>
                        </div>
                        <FriendButton
                            userId={user.id}
                            username={user.username}
                            variant="compact"
                            onStatusChange={handleFriendStatusChange}
                        />
                    </div>
                ))}
            </div>
        </GlassCard>
    );
}

export default PeopleYouMayKnow;
