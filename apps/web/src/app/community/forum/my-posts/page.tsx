"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { MessageSquare, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getMyPosts, type ForumPost } from "@/lib/forum-api";

export default function MyPostsPage() {
    const [posts, setPosts] = useState<ForumPost[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadPosts();
    }, []);

    const loadPosts = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await getMyPosts({ page: 1, limit: 20 });
            setPosts(data.posts);
        } catch (err) {
            setError("Failed to load your posts");
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="container mx-auto py-8 px-4">
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
                <Link href="/community/forum">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                </Link>
                <div>
                    <h1 className="text-2xl font-bold">My Posts</h1>
                    <p className="text-muted-foreground">
                        Your forum activity
                    </p>
                </div>
            </div>

            {/* Content */}
            {isLoading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            ) : error ? (
                <Card className="py-12 text-center">
                    <p className="text-muted-foreground">{error}</p>
                    <Button onClick={loadPosts} className="mt-4">
                        Retry
                    </Button>
                </Card>
            ) : posts.length === 0 ? (
                <Card className="py-12 text-center">
                    <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-medium mb-2">No posts yet</h3>
                    <p className="text-muted-foreground mb-4">
                        Start participating in discussions!
                    </p>
                    <Link href="/community/forum">
                        <Button>Browse Forum</Button>
                    </Link>
                </Card>
            ) : (
                <div className="space-y-4">
                    {posts.map((post) => (
                        <Card key={post.id} className="p-6 hover:border-primary/50 transition-colors">
                            <div className="flex gap-4">
                                {/* Vote counts */}
                                <div className="flex flex-col items-center gap-1 min-w-[60px]">
                                    <div className="text-lg font-bold">
                                        {post.upvotes - post.downvotes}
                                    </div>
                                    <div className="text-xs text-muted-foreground">votes</div>
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <p className="text-muted-foreground line-clamp-3">
                                        {post.content}
                                    </p>

                                    <div className="flex items-center gap-4 mt-3 text-sm">
                                        <Badge variant="secondary">
                                            Reply
                                        </Badge>
                                        <span className="text-muted-foreground">
                                            {formatDistanceToNow(new Date(post.created_at), {
                                                addSuffix: true,
                                            })}
                                        </span>
                                        {post.is_solution && (
                                            <Badge variant="default">Solution</Badge>
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
