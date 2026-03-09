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
import { GlassCard } from "@/components/ui/glass-card";
import {
    MessageSquare,
    Search,
    Plus,
    Hash,
    Clock,
    TrendingUp,
    Users,
    ChevronRight,
    Loader2,
    MessageCircle,
    Eye,
    ArrowUpCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

function ForumContent() {
    const { user, isAuthenticated } = useAuth();
    const [categories, setCategories] = useState<ForumCategory[]>([]);
    const [recentThreads, setRecentThreads] = useState<ForumThread[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<ForumThread[] | null>(null);
    const [searching, setSearching] = useState(false);
    const [activeTab, setActiveTab] = useState<"categories" | "recent" | "popular">("categories");

    useEffect(() => {
        loadForumData();
    }, []);

    const loadForumData = async () => {
        try {
            setLoading(true);
            const [catsData, recentData] = await Promise.all([
                getForumCategories(),
                getRecentThreads(),
            ]);
            setCategories(catsData.categories || []);
            setRecentThreads(recentData.threads || []);
        } catch (err) {
            console.error("Failed to load forum data:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = async () => {
        if (!searchQuery.trim()) {
            setSearchResults(null);
            return;
        }
        try {
            setSearching(true);
            const results = await searchForum(searchQuery);
            setSearchResults(results.threads || []);
        } catch (err) {
            console.error("Search failed:", err);
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
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold font-mono tracking-tight flex items-center gap-3">
                        <MessageSquare className="w-8 h-8 text-primary" />
                        Community Forum
                    </h1>
                    <p className="text-muted-foreground mt-2">
                        Discuss proxy strategies, share knowledge, and connect with the community
                    </p>
                </div>
                {isAuthenticated && (
                    <Link
                        href="/forum/new"
                        className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-bold font-mono text-sm hover:bg-primary/90 transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        New Discussion
                    </Link>
                )}
            </div>

            {/* Search */}
            <GlassCard className="!p-4">
                <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
                    <input
                        type="text"
                        placeholder="Search discussions..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyPress={handleKeyPress}
                        className="w-full bg-secondary/20 border border-border rounded-lg pl-12 pr-4 py-3 font-mono text-sm focus:border-primary outline-none transition-colors"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => {
                                setSearchQuery("");
                                setSearchResults(null);
                            }}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                            <span className="sr-only">Clear</span>
                            ×
                        </button>
                    )}
                </div>
                {searchResults !== null && (
                    <div className="mt-4 pt-4 border-t border-border">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-bold font-mono">
                                Search Results ({searchResults.length})
                            </h3>
                            <button
                                onClick={() => {
                                    setSearchResults(null);
                                    setSearchQuery("");
                                }}
                                className="text-sm text-muted-foreground hover:text-foreground"
                            >
                                Clear
                            </button>
                        </div>
                        {searching ? (
                            <div className="flex justify-center py-8">
                                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                            </div>
                        ) : searchResults.length === 0 ? (
                            <p className="text-muted-foreground text-center py-8">No results found</p>
                        ) : (
                            <div className="space-y-3">
                                {searchResults.map((thread) => (
                                    <ThreadCard key={thread.id} thread={thread} compact />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </GlassCard>

            {/* Main Content */}
            {!searchResults && (
                <div className="grid lg:grid-cols-3 gap-8">
                    {/* Left Column - Categories/Threads */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Tabs */}
                        <div className="flex gap-2 p-1 bg-secondary/20 rounded-lg">
                            {[
                                { id: "categories", label: "Categories", icon: Hash },
                                { id: "recent", label: "Recent", icon: Clock },
                                { id: "popular", label: "Popular", icon: TrendingUp },
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
                                </button>
                            ))}
                        </div>

                        {/* Content */}
                        {activeTab === "categories" && (
                            <div className="grid sm:grid-cols-2 gap-4">
                                {categories.map((category) => (
                                    <Link key={category.id} href={`/forum/category/${category.slug}`}>
                                        <GlassCard className="!p-5 hover:border-primary/50 transition-all h-full group">
                                            <div className="flex items-start gap-4">
                                                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                                                    <MessageSquare className="w-6 h-6 text-primary" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <h3 className="font-bold font-mono text-lg group-hover:text-primary transition-colors">
                                                        {category.name}
                                                    </h3>
                                                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                                                        {category.description}
                                                    </p>
                                                    <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground font-mono">
                                                        <span className="flex items-center gap-1">
                                                            <MessageCircle className="w-3 h-3" />
                                                            {category.thread_count || 0} threads
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </GlassCard>
                                    </Link>
                                ))}
                            </div>
                        )}

                        {activeTab === "recent" && (
                            <div className="space-y-3">
                                {recentThreads.length === 0 ? (
                                    <GlassCard className="!p-8 text-center">
                                        <p className="text-muted-foreground">No recent discussions</p>
                                    </GlassCard>
                                ) : (
                                    recentThreads.map((thread) => (
                                        <ThreadCard key={thread.id} thread={thread} />
                                    ))
                                )}
                            </div>
                        )}

                        {activeTab === "popular" && (
                            <div className="space-y-3">
                                {[...recentThreads]
                                    .sort((a, b) => (b.views_count || 0) - (a.views_count || 0))
                                    .slice(0, 10)
                                    .map((thread) => (
                                        <ThreadCard key={thread.id} thread={thread} />
                                    ))}
                            </div>
                        )}
                    </div>

                    {/* Right Column - Stats & Info */}
                    <div className="space-y-6">
                        {/* Stats */}
                        <GlassCard className="!p-6">
                            <h3 className="font-bold font-mono mb-4 flex items-center gap-2">
                                <TrendingUp className="w-5 h-5 text-primary" />
                                Forum Stats
                            </h3>
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">Categories</span>
                                    <span className="font-bold font-mono">{categories.length}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">Total Threads</span>
                                    <span className="font-bold font-mono">
                                        {categories.reduce((sum, c) => sum + (c.thread_count || 0), 0)}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">Recent Activity</span>
                                    <span className="font-bold font-mono text-emerald-500">
                                        {recentThreads.length} new
                                    </span>
                                </div>
                            </div>
                        </GlassCard>

                        {/* Quick Links */}
                        <GlassCard className="!p-6">
                            <h3 className="font-bold font-mono mb-4">Quick Links</h3>
                            <div className="space-y-2">
                                <Link
                                    href="/forum/recent"
                                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-secondary/30 transition-colors group"
                                >
                                    <Clock className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                                    <span className="text-sm">Recent Activity</span>
                                    <ChevronRight className="w-4 h-4 ml-auto text-muted-foreground" />
                                </Link>
                                <Link
                                    href="/forum/unanswered"
                                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-secondary/30 transition-colors group"
                                >
                                    <MessageCircle className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                                    <span className="text-sm">Unanswered</span>
                                    <ChevronRight className="w-4 h-4 ml-auto text-muted-foreground" />
                                </Link>
                                {isAuthenticated && (
                                    <Link
                                        href="/forum/my-posts"
                                        className="flex items-center gap-3 p-3 rounded-lg hover:bg-secondary/30 transition-colors group"
                                    >
                                        <Users className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                                        <span className="text-sm">My Posts</span>
                                        <ChevronRight className="w-4 h-4 ml-auto text-muted-foreground" />
                                    </Link>
                                )}
                            </div>
                        </GlassCard>

                        {/* Guidelines */}
                        <GlassCard className="!p-6 bg-gradient-to-br from-primary/5 to-transparent">
                            <h3 className="font-bold font-mono mb-3">Community Guidelines</h3>
                            <ul className="space-y-2 text-sm text-muted-foreground">
                                <li className="flex items-start gap-2">
                                    <span className="text-primary">•</span>
                                    Be respectful and professional
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-primary">•</span>
                                    No spam or self-promotion
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-primary">•</span>
                                    Share knowledge generously
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-primary">•</span>
                                    Report inappropriate content
                                </li>
                            </ul>
                        </GlassCard>
                    </div>
                </div>
            )}
        </div>
    );
}

// Thread Card Component
interface ThreadCardProps {
    thread: ForumThread;
    compact?: boolean;
}

function ThreadCard({ thread, compact }: ThreadCardProps) {
    return (
        <Link href={`/forum/thread/${thread.id}`}>
            <GlassCard className={`hover:border-primary/50 transition-all group ${compact ? "!p-4" : "!p-5"}`}>
                <div className="flex items-start gap-4">
                    {/* Vote Count */}
                    <div className="flex flex-col items-center gap-1 min-w-[3rem]">
                        <ArrowUpCircle className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                        <span className="font-bold font-mono text-sm">
                            {(thread.upvotes || 0) - (thread.downvotes || 0)}
                        </span>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            {thread.is_pinned && (
                                <span className="px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-bold font-mono rounded">
                                    PINNED
                                </span>
                            )}
                            <span className="text-xs text-muted-foreground font-mono">
                                {thread.category?.name}
                            </span>
                        </div>
                        <h4 className={`font-bold group-hover:text-primary transition-colors ${compact ? "text-sm" : "text-base"}`}>
                            {thread.title}
                        </h4>
                        {!compact && thread.content && (
                            <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                                {thread.content.substring(0, 150)}
                                {thread.content.length > 150 && "..."}
                            </p>
                        )}
                        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground font-mono">
                            <span className="flex items-center gap-1">
                                <MessageCircle className="w-3 h-3" />
                                {thread.replies_count || 0} replies
                            </span>
                            <span className="flex items-center gap-1">
                                <Eye className="w-3 h-3" />
                                {thread.views_count || 0} views
                            </span>
                            <span>•</span>
                            <span>{formatDistanceToNow(new Date(thread.created_at))} ago</span>
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

export default function ForumPage() {
    return (
        <ProtectedRoute requireAuth={false}>
            <ForumContent />
        </ProtectedRoute>
    );
}
