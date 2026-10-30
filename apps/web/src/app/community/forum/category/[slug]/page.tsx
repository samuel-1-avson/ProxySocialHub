"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import {
    getCategory,
    getCategoryThreads,
    type ForumCategory,
    type ForumThread,
} from "@/lib/forum-api";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { GlassCard } from "@/components/ui/glass-card";
import {
    ArrowLeft,
    Plus,
    MessageSquare,
    Loader2,
    Hash,
    ChevronLeft,
    ChevronRight,
    Eye,
    Clock,
    ArrowUpCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const ITEMS_PER_PAGE = 20;

function CategoryPageContent() {
    const { slug } = useParams();
    const { isAuthenticated } = useAuth();
    const [category, setCategory] = useState<ForumCategory | null>(null);
    const [threads, setThreads] = useState<ForumThread[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);

    useEffect(() => {
        loadCategoryData();
    }, [slug, page]);

    const loadCategoryData = async () => {
        try {
            setLoading(true);
            const [catData, threadsData] = await Promise.all([
                getCategory(slug as string),
                getCategoryThreads(slug as string, { page, limit: ITEMS_PER_PAGE }),
            ]);
            setCategory(catData.category);
            setThreads(threadsData.threads || []);
            setTotal(threadsData.total || 0);
        } catch (err) {
            console.error("Failed to load category:", err);
        } finally {
            setLoading(false);
        }
    };

    const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    if (!category) {
        return (
            <div className="text-center py-20">
                <h1 className="text-2xl font-bold font-mono">Category not found</h1>
                <Link href="/help/forum" className="text-primary hover:underline mt-4 inline-block">
                    Back to Forum
                </Link>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            {/* Back Link */}
            <Link
                href="/help/forum"
                className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors font-mono text-sm"
            >
                <ArrowLeft className="w-4 h-4" />
                Back to Forum
            </Link>

            {/* Header */}
            <GlassCard className="!p-6">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                        <div className="w-14 h-14 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <Hash className="w-7 h-7 text-primary" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold font-mono">{category.name}</h1>
                            <p className="text-muted-foreground mt-1">{category.description}</p>
                            <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground font-mono">
                                <span className="flex items-center gap-1">
                                    <MessageSquare className="w-4 h-4" />
                                    {total} threads
                                </span>
                            </div>
                        </div>
                    </div>
                    {isAuthenticated && (
                        <Link
                            href="/help/forum/new"
                            className="hidden sm:flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-bold font-mono text-sm hover:bg-primary/90 transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                            New Thread
                        </Link>
                    )}
                </div>
            </GlassCard>

            {/* Threads List */}
            <div className="space-y-3">
                {threads.length === 0 ? (
                    <GlassCard className="!p-12 text-center">
                        <MessageSquare className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                        <h3 className="font-bold font-mono text-lg mb-2">No threads yet</h3>
                        <p className="text-muted-foreground text-sm mb-4">
                            Be the first to start a discussion in this category
                        </p>
                        {isAuthenticated && (
                            <Link
                                href="/help/forum/new"
                                className="inline-flex items-center gap-2 px-6 py-2 bg-primary text-primary-foreground rounded-lg font-bold font-mono text-sm hover:bg-primary/90 transition-colors"
                            >
                                <Plus className="w-4 h-4" />
                                Start Discussion
                            </Link>
                        )}
                    </GlassCard>
                ) : (
                    threads.map((thread) => <ThreadListItem key={thread.id} thread={thread} />)
                )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-4">
                    <button
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="p-2 rounded-lg border border-border hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                    <span className="px-4 py-2 font-mono text-sm">
                        Page {page} of {totalPages}
                    </span>
                    <button
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        className="p-2 rounded-lg border border-border hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronRight className="w-5 h-5" />
                    </button>
                </div>
            )}
        </div>
    );
}

// Thread List Item Component
interface ThreadListItemProps {
    thread: ForumThread;
}

function ThreadListItem({ thread }: ThreadListItemProps) {
    const score = (thread.upvotes || 0) - (thread.downvotes || 0);

    return (
        <Link href={`/help/forum/thread/${thread.id}`}>
            <GlassCard className="!p-4 hover:border-primary/50 transition-all group">
                <div className="flex items-start gap-4">
                    {/* Vote Count */}
                    <div className="flex flex-col items-center gap-1 min-w-[3rem]">
                        <ArrowUpCircle className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                        <span className="font-bold font-mono text-sm">{score}</span>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            {thread.is_pinned && (
                                <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs font-bold font-mono rounded">
                                    PINNED
                                </span>
                            )}
                            {thread.is_locked && (
                                <span className="px-2 py-0.5 bg-destructive/10 text-destructive text-xs font-bold font-mono rounded">
                                    LOCKED
                                </span>
                            )}
                        </div>
                        <h4 className="font-bold group-hover:text-primary transition-colors line-clamp-1">
                            {thread.title}
                        </h4>
                        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground font-mono">
                            <span className="flex items-center gap-1">
                                <MessageSquare className="w-3 h-3" />
                                {thread.replies_count || 0} replies
                            </span>
                            <span className="flex items-center gap-1">
                                <Eye className="w-3 h-3" />
                                {thread.views_count || 0} views
                            </span>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatDistanceToNow(new Date(thread.created_at))} ago
                            </span>
                            {thread.author && (
                                <>
                                    <span>•</span>
                                    <span className="text-primary">@{thread.author.username}</span>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </GlassCard>
        </Link>
    );
}

export default function CategoryPage() {
    return (
        <ProtectedRoute requireAuth={false}>
            <CategoryPageContent />
        </ProtectedRoute>
    );
}
