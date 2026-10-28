"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import {
    getForumCategories,
    getRecentThreads,
    searchForum,
    type ForumCategory,
    type ForumThread,
} from "@/lib/forum-api";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import {
    PageHeading,
    Loading,
    DataError,
    EmptyState,
    Stat,
} from "@/components/workspace/Patterns";
import {
    MessageSquare,
    Plus,
    MessageCircle,
    Eye,
    ArrowUpCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

function ForumContent() {
    const { isAuthenticated } = useAuth();
    const [categories, setCategories] = useState<ForumCategory[]>([]);
    const [recentThreads, setRecentThreads] = useState<ForumThread[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<unknown>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<ForumThread[] | null>(null);
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState<unknown>(null);

    useEffect(() => {
        loadForumData();
    }, []);

    const loadForumData = async () => {
        try {
            setLoading(true);
            setLoadError(null);
            const [catsData, recentData] = await Promise.all([
                getForumCategories(),
                getRecentThreads(),
            ]);
            setCategories(catsData.categories || []);
            setRecentThreads(recentData.threads || []);
        } catch (err) {
            console.error("Failed to load forum data:", err);
            setLoadError(err);
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = async () => {
        if (!searchQuery.trim()) {
            setSearchResults(null);
            setSearchError(null);
            return;
        }
        try {
            setSearching(true);
            setSearchError(null);
            const results = await searchForum(searchQuery);
            setSearchResults(results.threads || []);
        } catch (err) {
            console.error("Search failed:", err);
            setSearchError(err);
        } finally {
            setSearching(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            handleSearch();
        }
    };

    if (loading) {
        return <Loading label="Loading forum…" />;
    }

    return (
        <div className="ui-page">
            <PageHeading
                eyebrow="Community"
                title="Community Forum"
                description="Discuss proxy strategies, share knowledge, and connect with the community"
                actions={
                    isAuthenticated ? (
                        <Link href="/help/forum/new" className="ui-button">
                            <Plus size={16} aria-hidden="true" />
                            New Discussion
                        </Link>
                    ) : undefined
                }
            />

            {loadError ? (
                <DataError error={loadError} retry={() => void loadForumData()} />
            ) : null}

            <section className="ui-surface">
                <label className="ui-field">
                    Search discussions
                    <input
                        type="text"
                        placeholder="Search discussions..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyPress={handleKeyPress}
                        className="ui-input w-full"
                    />
                </label>
                {searchQuery && (
                    <button
                        type="button"
                        onClick={() => {
                            setSearchQuery("");
                            setSearchResults(null);
                            setSearchError(null);
                        }}
                        className="ui-button ghost small mt-2"
                    >
                        Clear search
                    </button>
                )}
                {searchError ? (
                    <div className="mt-4">
                        <DataError error={searchError} retry={() => void handleSearch()} />
                    </div>
                ) : null}
                {searchResults !== null && (
                    <div className="mt-6 space-y-4">
                        <div className="ui-section-heading">
                            <h2>Search Results ({searchResults.length})</h2>
                            <button
                                type="button"
                                onClick={() => {
                                    setSearchResults(null);
                                    setSearchQuery("");
                                    setSearchError(null);
                                }}
                                className="ui-button ghost small"
                            >
                                Clear
                            </button>
                        </div>
                        {searching ? (
                            <Loading label="Searching…" />
                        ) : searchResults.length === 0 ? (
                            <EmptyState
                                title="No results found"
                                description="Try a different search, or browse categories below."
                            />
                        ) : (
                            <div className="space-y-3">
                                {searchResults.map((thread) => (
                                    <ThreadCard key={thread.id} thread={thread} compact />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </section>

            {!searchResults && (
                <div className="ui-columns">
                    <div className="space-y-4 min-w-0">
                        {!loadError && categories.length === 0 ? (
                            <EmptyState
                                title="No categories yet"
                                description="Forum categories will appear here when they are available."
                            />
                        ) : categories.length > 0 ? (
                            <div className="grid sm:grid-cols-2 gap-4">
                                {categories.map((category) => (
                                    <Link
                                        key={category.id}
                                        href={`/help/forum/category/${category.slug}`}
                                        className="ui-surface block min-w-0"
                                    >
                                        <div className="flex items-start gap-4">
                                            <span className="ui-region">
                                                <MessageSquare size={17} aria-hidden="true" />
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <h3 className="text-[15px] font-semibold text-foreground">
                                                    {category.name}
                                                </h3>
                                                <p className="text-sm text-muted-foreground mt-1">
                                                    {category.description}
                                                </p>
                                                <p className="ui-note mt-3">
                                                    {category.thread_count || 0} threads
                                                </p>
                                            </div>
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        ) : null}
                    </div>

                    <div className="space-y-6 min-w-0">
                        <section className="ui-surface">
                            <h2>Forum Stats</h2>
                            <div className="ui-stats mt-4" style={{ gridTemplateColumns: "1fr" }}>
                                <Stat
                                    label="Categories"
                                    value={categories.length}
                                    detail="Available discussion areas"
                                />
                                <Stat
                                    label="Total Threads"
                                    value={categories.reduce((sum, c) => sum + (c.thread_count || 0), 0)}
                                    detail="Across all categories"
                                />
                                <Stat
                                    label="Recent threads loaded"
                                    value={recentThreads.length}
                                    detail="Latest discussions fetched"
                                />
                            </div>
                        </section>

                        <section className="ui-attention">
                            <h3>Community Guidelines</h3>
                            <ul className="space-y-2 text-sm text-muted-foreground">
                                <li>Be respectful and professional</li>
                                <li>No spam or self-promotion</li>
                                <li>Share knowledge generously</li>
                                <li>Report inappropriate content</li>
                            </ul>
                        </section>
                    </div>
                </div>
            )}
        </div>
    );
}

interface ThreadCardProps {
    thread: ForumThread;
    compact?: boolean;
}

function ThreadCard({ thread, compact }: ThreadCardProps) {
    return (
        <Link href={`/help/forum/thread/${thread.id}`} className="block min-w-0">
            <article className="ui-listing">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {thread.is_pinned && <span className="ui-tag">Pinned</span>}
                        <span className="text-sm text-muted-foreground">
                            {thread.category?.name}
                        </span>
                    </div>
                    <h2 className={compact ? "text-[15px]" : undefined}>{thread.title}</h2>
                    {!compact && thread.content && (
                        <p className="text-sm text-muted-foreground mt-2">
                            {thread.content.substring(0, 150)}
                            {thread.content.length > 150 && "..."}
                        </p>
                    )}
                    <div className="ui-listing-meta">
                        <span className="inline-flex items-center gap-1">
                            <ArrowUpCircle size={14} aria-hidden="true" />
                            {(thread.upvotes || 0) - (thread.downvotes || 0)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                            <MessageCircle size={14} aria-hidden="true" />
                            {thread.replies_count || 0} replies
                        </span>
                        <span className="inline-flex items-center gap-1">
                            <Eye size={14} aria-hidden="true" />
                            {thread.views_count || 0} views
                        </span>
                        <span>{formatDistanceToNow(new Date(thread.created_at))} ago</span>
                        {thread.author && <span>@{thread.author.username}</span>}
                    </div>
                </div>
            </article>
        </Link>
    );
}

export default function ForumPage() {
    return (
        <ProtectedRoute requireAuth={false}>
            <ForumContent />
        </ProtectedRoute>
    );
}
