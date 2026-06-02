"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { MessageSquare, ArrowLeft, Clock, TrendingUp, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getRecentThreads, getPopularThreads, getUnansweredThreads, type ForumThread } from "@/lib/forum-api";

export default function ForumRecentPage() {
    const [activeTab, setActiveTab] = useState<"recent" | "popular" | "unanswered">("recent");
    const [threads, setThreads] = useState<ForumThread[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadThreads();
    }, [activeTab]);

    const loadThreads = async () => {
        setIsLoading(true);
        setError(null);
        try {
            let data;
            switch (activeTab) {
                case "recent":
                    data = await getRecentThreads(20);
                    break;
                case "popular":
                    data = await getPopularThreads(20);
                    break;
                case "unanswered":
                    data = await getUnansweredThreads(20);
                    break;
            }
            setThreads(data.threads);
        } catch (err) {
            setError("Failed to load threads");
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="container mx-auto py-8 px-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                    <Link href="/community/forum">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="w-5 h-5" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold">Forum Discussions</h1>
                        <p className="text-muted-foreground">
                            Browse community conversations
                        </p>
                    </div>
                </div>
                <Link href="/community/forum/new">
                    <Button>
                        <MessageSquare className="w-4 h-4 mr-2" />
                        New Thread
                    </Button>
                </Link>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-6">
                <Button
                    variant={activeTab === "recent" ? "default" : "outline"}
                    onClick={() => setActiveTab("recent")}
                >
                    <Clock className="w-4 h-4 mr-2" />
                    Recent
                </Button>
                <Button
                    variant={activeTab === "popular" ? "default" : "outline"}
                    onClick={() => setActiveTab("popular")}
                >
                    <TrendingUp className="w-4 h-4 mr-2" />
                    Popular
                </Button>
                <Button
                    variant={activeTab === "unanswered" ? "default" : "outline"}
                    onClick={() => setActiveTab("unanswered")}
                >
                    <HelpCircle className="w-4 h-4 mr-2" />
                    Unanswered
                </Button>
            </div>

            {/* Content */}
            {isLoading ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
            ) : error ? (
                <Card className="py-12 text-center">
                    <p className="text-muted-foreground">{error}</p>
                    <Button onClick={loadThreads} className="mt-4">
                        Retry
                    </Button>
                </Card>
            ) : threads.length === 0 ? (
                <Card className="py-12 text-center">
                    <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-medium mb-2">No threads found</h3>
                    <p className="text-muted-foreground mb-4">
                        Be the first to start a discussion!
                    </p>
                    <Link href="/community/forum/new">
                        <Button>Create Thread</Button>
                    </Link>
                </Card>
            ) : (
                <div className="space-y-4">
                    {threads.map((thread) => (
                        <Card key={thread.id} className="hover:border-primary/50 transition-colors p-6">
                                <div className="flex gap-4">
                                    {/* Vote counts */}
                                    <div className="flex flex-col items-center gap-1 min-w-[60px]">
                                        <div className="text-lg font-bold">
                                            {thread.upvotes - thread.downvotes}
                                        </div>
                                        <div className="text-xs text-muted-foreground">votes</div>
                                        <div className="text-sm text-muted-foreground mt-2">
                                            {thread.replies_count}
                                        </div>
                                        <div className="text-xs text-muted-foreground">replies</div>
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                        <Link
                                            href={`/community/forum/thread/${thread.id}`}
                                            className="text-lg font-semibold hover:text-primary transition-colors line-clamp-1"
                                        >
                                            {thread.title}
                                        </Link>

                                        <p className="text-muted-foreground mt-1 line-clamp-2">
                                            {thread.content}
                                        </p>

                                        <div className="flex items-center gap-4 mt-3 text-sm">
                                            {thread.category && (
                                                <Badge variant="secondary">
                                                    {thread.category.name}
                                                </Badge>
                                            )}
                                            <span className="text-muted-foreground">
                                                Posted by{" "}
                                                <span className="text-foreground">
                                                    {thread.author?.display_name || thread.author?.username || "Unknown"}
                                                </span>
                                            </span>
                                            <span className="text-muted-foreground">
                                                {formatDistanceToNow(new Date(thread.created_at), {
                                                    addSuffix: true,
                                                })}
                                            </span>
                                            {thread.is_pinned && (
                                                <Badge variant="default">Pinned</Badge>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
