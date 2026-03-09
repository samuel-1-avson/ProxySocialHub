"use client";

import { useRef, useCallback } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { MessageSquare, Heart, Pin, Loader2 } from "lucide-react";
import type { ForumThread } from "@/lib/forum-api";

interface VirtualizedForumThreadListProps {
    threads: ForumThread[];
    hasMore: boolean;
    isLoadingMore: boolean;
    onLoadMore: () => void;
}

const ITEM_HEIGHT = 100;
const OVERSCAN = 5;

export function VirtualizedForumThreadList({
    threads,
    hasMore,
    isLoadingMore,
    onLoadMore,
}: VirtualizedForumThreadListProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const observerRef = useRef<IntersectionObserver | null>(null);

    const lastItemRef = useCallback(
        (node: HTMLDivElement | null) => {
            if (isLoadingMore) return;
            if (observerRef.current) observerRef.current.disconnect();

            observerRef.current = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting && hasMore) {
                    onLoadMore();
                }
            });

            if (node) observerRef.current.observe(node);
        },
        [isLoadingMore, hasMore, onLoadMore]
    );

    if (threads.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
                <MessageSquare className="w-12 h-12 text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">No threads yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                    Be the first to start a discussion!
                </p>
            </div>
        );
    }

    return (
        <div ref={containerRef} className="space-y-4">
            {threads.map((thread, index) => {
                const isLast = index === threads.length - 1;

                return (
                    <div
                        key={thread.id}
                        ref={isLast ? lastItemRef : null}
                        className="group bg-card rounded-xl border p-5 hover:border-primary/50 transition-colors"
                    >
                        <div className="flex gap-4">
                            {/* Vote buttons */}
                            <div className="flex flex-col items-center gap-1">
                                <button className="p-1.5 rounded hover:bg-muted transition-colors">
                                    <svg
                                        className="w-5 h-5"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M5 15l7-7 7 7"
                                        />
                                    </svg>
                                </button>
                                <span className="text-sm font-semibold">
                                    {thread.upvotes - thread.downvotes}
                                </span>
                                <button className="p-1.5 rounded hover:bg-muted transition-colors">
                                    <svg
                                        className="w-5 h-5"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M19 9l-7 7-7-7"
                                        />
                                    </svg>
                                </button>
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-start gap-2">
                                    {thread.isPinned && (
                                        <Pin className="w-4 h-4 text-amber-500 mt-1" />
                                    )}
                                    <Link
                                        href={`/forum/thread/${thread.id}`}
                                        className="text-lg font-semibold hover:text-primary transition-colors line-clamp-2"
                                    >
                                        {thread.title}
                                    </Link>
                                </div>

                                <p className="text-muted-foreground mt-2 line-clamp-2">
                                    {thread.content}
                                </p>

                                <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                                    <span>
                                        Posted by{" "}
                                        <Link
                                            href={`/providers/${thread.author.id}`}
                                            className="text-foreground hover:underline"
                                        >
                                            {thread.author.displayName}
                                        </Link>
                                    </span>
                                    <span>•</span>
                                    <span>
                                        {formatDistanceToNow(new Date(thread.createdAt), {
                                            addSuffix: true,
                                        })}
                                    </span>
                                    {thread.tags.map((tag) => (
                                        <span
                                            key={tag}
                                            className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs"
                                        >
                                            {tag}
                                        </span>
                                    ))}
                                </div>

                                <div className="flex items-center gap-4 mt-3">
                                    <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
                                        <MessageSquare className="w-4 h-4" />
                                        {thread.replyCount} replies
                                    </button>
                                    <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
                                        <Heart className="w-4 h-4" />
                                        {thread.likeCount} likes
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })}

            {/* Loading indicator */}
            {isLoadingMore && (
                <div className="flex justify-center py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                </div>
            )}
        </div>
    );
}
