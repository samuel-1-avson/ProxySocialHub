"use client";
import Image from "next/image";

import { useQuery } from "@tanstack/react-query";
import { DataError } from "@/components/workspace/Patterns";
import { useState, useCallback } from "react";
import Link from "next/link";
import { getPeopleYouMayKnow, type SuggestedUser } from "@/lib/friends-api";
import { GlassCard } from "@/components/ui/glass-card";
import { Sparkles, User, Loader2, ChevronRight } from "lucide-react";
import { FriendButton } from "./FriendButton";
import { ROUTES } from "@/lib/navigation/routes";
import { useAuth } from "@/lib/auth";

interface PeopleYouMayKnowProps {
  limit?: number;
  showViewAll?: boolean;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function displayLabel(user: SuggestedUser): string {
  if (user.display_name?.trim()) return user.display_name.trim();
  if (UUID_RE.test(user.username)) return `user_${user.username.slice(0, 8)}`;
  return user.username;
}

function profileHref(user: SuggestedUser): string {
  // Prefer stable username when set; fall back to id for UUID placeholders
  if (user.username && !UUID_RE.test(user.username)) {
    return `/profile/${encodeURIComponent(user.username)}`;
  }
  return `/profile/${encodeURIComponent(user.id)}`;
}

export function PeopleYouMayKnow({
  limit = 5,
  showViewAll = true,
}: PeopleYouMayKnowProps) {
  const { user, isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: ["friend-suggestions", user?.id, limit],
    queryFn: () => getPeopleYouMayKnow(limit),
    enabled: isAuthenticated,
  });
  const [hidden, setHidden] = useState<string[]>([]);
  const suggestions = (query.data?.suggestions ?? []).filter(
    (user) => !hidden.includes(user.id),
  );
  const loading = query.isPending;
  const handleFriendStatusChange = useCallback(
    (userId: string, status: string) => {
      if (status === "request_sent" || status === "friends")
        setHidden((previous) => [...previous, userId]);
      else void query.refetch();
    },
    [query],
  );
  if (query.isError)
    return (
      <DataError
        title="Suggestions are unavailable"
        error={query.error}
        retry={() => void query.refetch()}
      />
    );
  if (loading) {
    return (
      <GlassCard className="!p-0" hoverEffect={false}>
        <div className="flex items-center justify-center py-8 px-6">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      </GlassCard>
    );
  }

  if (suggestions.length === 0) {
    return null;
  }

  return (
    <GlassCard className="!p-0" hoverEffect={false}>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="w-5 h-5 text-primary shrink-0" />
            <h3 className="font-bold font-mono truncate">
              People You May Know
            </h3>
          </div>
          {showViewAll && (
            <Link
              href={ROUTES.communityFriends}
              className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors shrink-0"
            >
              View all
              <ChevronRight className="w-4 h-4" />
            </Link>
          )}
        </div>

        <div className="space-y-4">
          {suggestions.map((user) => {
            const label = displayLabel(user);
            const href = profileHref(user);
            return (
              <div key={user.id} className="flex items-center gap-3">
                <Link href={href} className="shrink-0">
                  <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center overflow-hidden hover:ring-2 hover:ring-primary/50 transition-all">
                    {user.avatar_url ? (
                      <Image
                        width={40}
                        height={40}
                        unoptimized
                        src={user.avatar_url}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                </Link>
                <div className="flex-1 min-w-0">
                  <Link
                    href={href}
                    className="font-medium font-mono text-sm hover:text-primary transition-colors block truncate"
                    title={label}
                  >
                    @{label}
                  </Link>
                  <p className="text-xs text-muted-foreground truncate">
                    {user.reason === "mutual_friends" && user.mutual_count
                      ? `${user.mutual_count} mutual friends`
                      : user.reason === "similar_skills"
                        ? "Similar skills"
                        : "Suggested for you"}
                  </p>
                </div>
                <div className="shrink-0">
                  <FriendButton
                    userId={user.id}
                    username={label}
                    variant="compact"
                    onStatusChange={(status) =>
                      handleFriendStatusChange(user.id, status)
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </GlassCard>
  );
}

export default PeopleYouMayKnow;
