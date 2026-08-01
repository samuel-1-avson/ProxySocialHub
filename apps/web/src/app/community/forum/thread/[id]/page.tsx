"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import {
    getThread,
    createPost,
    votePost,
    voteThread,
    reportThread,
    reportPost,
    markPostSolution,
    type ForumThread as ThreadType,
    type ForumPost as PostType,
} from "@/lib/forum-api";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { GlassCard } from "@/components/ui/glass-card";
import {
    ArrowLeft,
    MessageSquare,
    Clock,
    Eye,
    ArrowBigUp,
    ArrowBigDown,
    Share2,
    Flag,
    MoreHorizontal,
    Loader2,
    Send,
    CornerDownRight,
    CheckCircle2,
    User,
    X,
    Link as LinkIcon,
    Twitter,
    Facebook,
    Copy,
    Check,
    AlertTriangle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ==================== Types ====================
interface ReplyContext {
    id: string;
    author: string;
    content: string;
    type: "thread" | "post";
}

// ==================== Main Component ====================
function ThreadPageContent() {
    const { id } = useParams();
    const { user, isAuthenticated } = useAuth();
    const [thread, setThread] = useState<ThreadType | null>(null);
    const [posts, setPosts] = useState<PostType[]>([]);
    const [loading, setLoading] = useState(true);
    const [replyContent, setReplyContent] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [replyContext, setReplyContext] = useState<ReplyContext | null>(null);
    const [voting, setVoting] = useState<string | null>(null);
    
    // Modals
    const [shareModalOpen, setShareModalOpen] = useState(false);
    const [reportModalOpen, setReportModalOpen] = useState(false);
    const [reportTarget, setReportTarget] = useState<{type: "thread" | "post", id: string} | null>(null);
    const [copiedLink, setCopiedLink] = useState(false);

    useEffect(() => {
        loadThread();
    }, [id]);

    const loadThread = async () => {
        try {
            setLoading(true);
            const data = await getThread(id as string);
            setThread(data.thread);
            setPosts(data.posts || []);
        } catch (err) {
            console.error("Failed to load thread:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmitReply = async () => {
        if (!replyContent.trim() || !isAuthenticated) return;

        setSubmitting(true);
        try {
            await createPost(id as string, {
                content: replyContent.trim(),
                parent_id: replyContext?.type === "post" ? replyContext.id : undefined,
            });
            setReplyContent("");
            setReplyContext(null);
            await loadThread();
        } catch (err) {
            console.error("Failed to submit reply:", err);
        } finally {
            setSubmitting(false);
        }
    };

    const handleReplyToThread = () => {
        if (!thread) return;
        setReplyContext({
            id: thread.id,
            author: thread.author?.username || "Unknown",
            content: thread.title,
            type: "thread",
        });
        setReplyContent("");
        // Scroll to reply form
        document.getElementById("reply-form")?.scrollIntoView({ behavior: "smooth" });
    };

    const handleReplyToPost = (post: PostType) => {
        setReplyContext({
            id: post.id,
            author: post.author?.username || "Unknown",
            content: post.content.substring(0, 100) + (post.content.length > 100 ? "..." : ""),
            type: "post",
        });
        setReplyContent("");
        document.getElementById("reply-form")?.scrollIntoView({ behavior: "smooth" });
    };

    const clearReplyContext = () => {
        setReplyContext(null);
        setReplyContent("");
    };

    const handleVoteThread = async (voteType: "up" | "down") => {
        if (!isAuthenticated || voting) return;
        setVoting("thread");
        try {
            const result = await voteThread(id as string, voteType);
            setThread((prev) =>
                prev
                    ? {
                          ...prev,
                          upvotes: result.upvotes,
                          downvotes: result.downvotes,
                      }
                    : null
            );
        } catch (err) {
            console.error("Vote failed:", err);
        } finally {
            setVoting(null);
        }
    };

    const handleVotePost = async (postId: string, voteType: "up" | "down") => {
        if (!isAuthenticated || voting) return;
        setVoting(postId);
        try {
            const result = await votePost(postId, voteType);
            setPosts((prev) =>
                prev.map((post) =>
                    post.id === postId
                        ? { ...post, upvotes: result.upvotes, downvotes: result.downvotes }
                        : post
                )
            );
        } catch (err) {
            console.error("Vote failed:", err);
        } finally {
            setVoting(null);
        }
    };

    const handleMarkSolution = async (postId: string, isSolution: boolean) => {
        if (!isAuthenticated) return;
        try {
            await markPostSolution(postId, isSolution);
            await loadThread();
        } catch (err) {
            console.error("Failed to update solution:", err);
            alert(err instanceof Error ? err.message : "Failed to update solution");
        }
    };

    const canMarkSolution =
        !!user &&
        !!thread &&
        (user.id === thread.author_id ||
            user.role === "admin" ||
            user.role === "moderator" ||
            user.role === "superadmin");

    const openShareModal = () => {
        setShareModalOpen(true);
        setCopiedLink(false);
    };

    const openReportModal = (type: "thread" | "post", targetId: string) => {
        setReportTarget({ type, id: targetId });
        setReportModalOpen(true);
    };

    const copyLink = () => {
        navigator.clipboard.writeText(window.location.href);
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
    };

    const shareOnTwitter = () => {
        const text = thread ? `Check out this discussion: ${thread.title}` : "";
        const url = window.location.href;
        window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, "_blank");
    };

    const shareOnFacebook = () => {
        const url = window.location.href;
        window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, "_blank");
    };

    // Group posts by parent for threaded view
    const topLevelPosts = posts.filter(p => !p.parent_id);
    const getReplies = (parentId: string) => posts.filter(p => p.parent_id === parentId);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    if (!thread) {
        return (
            <div className="text-center py-20">
                <h1 className="text-2xl font-bold font-mono">Thread not found</h1>
                <Link href="/community/forum" className="text-primary hover:underline mt-4 inline-block">
                    Back to Forum
                </Link>
            </div>
        );
    }

    const score = (thread.upvotes || 0) - (thread.downvotes || 0);

    return (
        <div className="max-w-4xl mx-auto space-y-6 pb-20">
            {/* Back Link */}
            <Link
                href="/community/forum"
                className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors font-mono text-sm"
            >
                <ArrowLeft className="w-4 h-4" />
                Back to Forum
            </Link>

            {/* Thread Header */}
            <GlassCard className="!p-6">
                <div className="flex items-start gap-4">
                    {/* Vote Buttons */}
                    <div className="flex flex-col items-center gap-1">
                        <button
                            onClick={() => handleVoteThread("up")}
                            disabled={!isAuthenticated || voting === "thread"}
                            className="p-1 hover:bg-secondary rounded transition-colors disabled:opacity-50"
                        >
                            <ArrowBigUp
                                className={`w-8 h-8 ${score > 0 ? "text-primary fill-primary" : "text-muted-foreground"}`}
                            />
                        </button>
                        <span className="font-bold font-mono text-lg">{score}</span>
                        <button
                            onClick={() => handleVoteThread("down")}
                            disabled={!isAuthenticated || voting === "thread"}
                            className="p-1 hover:bg-secondary rounded transition-colors disabled:opacity-50"
                        >
                            <ArrowBigDown
                                className={`w-8 h-8 ${score < 0 ? "text-red-500 fill-red-500" : "text-muted-foreground"}`}
                            />
                        </button>
                    </div>

                    {/* Thread Content */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                            <Link
                                href={`/community/forum/category/${thread.category?.slug}`}
                                className="text-xs font-mono text-primary hover:underline"
                            >
                                {thread.category?.name}
                            </Link>
                            {thread.is_pinned && (
                                <span className="px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-bold font-mono rounded">
                                    PINNED
                                </span>
                            )}
                            {thread.is_locked && (
                                <span className="px-2 py-0.5 bg-red-500/10 text-red-500 text-[10px] font-bold font-mono rounded">
                                    LOCKED
                                </span>
                            )}
                        </div>

                        <h1 className="text-2xl font-bold font-mono mb-4">{thread.title}</h1>

                        <div className="flex items-center gap-4 text-sm text-muted-foreground font-mono mb-6">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                                    {thread.author?.avatar_url ? (
                                        <img
                                            src={thread.author.avatar_url}
                                            alt=""
                                            className="w-full h-full rounded-full object-cover"
                                        />
                                    ) : (
                                        <User className="w-4 h-4" />
                                    )}
                                </div>
                                <span className="text-primary">@{thread.author?.username}</span>
                            </div>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatDistanceToNow(new Date(thread.created_at))} ago
                            </span>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                                <Eye className="w-3 h-3" />
                                {thread.views_count || 0} views
                            </span>
                        </div>

                        <div className="prose prose-invert max-w-none">
                            <p className="whitespace-pre-wrap">{thread.content}</p>
                        </div>

                        {/* Thread Actions */}
                        <div className="flex items-center gap-4 mt-6 pt-6 border-t border-border">
                            <button 
                                onClick={handleReplyToThread}
                                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <MessageSquare className="w-4 h-4" />
                                Reply to Thread
                            </button>
                            <button 
                                onClick={openShareModal}
                                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <Share2 className="w-4 h-4" />
                                Share
                            </button>
                            <button 
                                onClick={() => openReportModal("thread", thread.id)}
                                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <Flag className="w-4 h-4" />
                                Report
                            </button>
                        </div>
                    </div>
                </div>
            </GlassCard>

            {/* Replies Count */}
            <div className="flex items-center justify-between">
                <h2 className="font-bold font-mono text-lg flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-primary" />
                    {posts.length} {posts.length === 1 ? "Reply" : "Replies"}
                </h2>
            </div>

            {/* Posts - Threaded View */}
            <div className="space-y-4">
                {topLevelPosts.map((post, index) => (
                    <div key={post.id} className="space-y-3">
                        <PostCard
                            post={post}
                            index={index}
                            isReplying={replyContext?.id === post.id && replyContext?.type === "post"}
                            onReplyClick={() => handleReplyToPost(post)}
                            onVote={(type) => handleVotePost(post.id, type)}
                            voting={voting === post.id}
                            isAuthenticated={isAuthenticated}
                            canMarkSolution={canMarkSolution}
                            onMarkSolution={() => handleMarkSolution(post.id, !post.is_solution)}
                            onShare={() => {
                                navigator.clipboard.writeText(`${window.location.href}#post-${post.id}`);
                                setCopiedLink(true);
                                setTimeout(() => setCopiedLink(false), 2000);
                            }}
                            onReport={() => openReportModal("post", post.id)}
                        />
                        {/* Nested Replies */}
                        {getReplies(post.id).map((reply, replyIndex) => (
                            <div key={reply.id} className="ml-12 border-l-2 border-border pl-4">
                                <PostCard
                                    post={reply}
                                    index={replyIndex}
                                    isReplying={replyContext?.id === reply.id && replyContext?.type === "post"}
                                    onReplyClick={() => handleReplyToPost(reply)}
                                    onVote={(type) => handleVotePost(reply.id, type)}
                                    voting={voting === reply.id}
                                    isAuthenticated={isAuthenticated}
                                    canMarkSolution={canMarkSolution}
                                    onMarkSolution={() => handleMarkSolution(reply.id, !reply.is_solution)}
                                    onShare={() => {
                                        navigator.clipboard.writeText(`${window.location.href}#post-${reply.id}`);
                                        setCopiedLink(true);
                                        setTimeout(() => setCopiedLink(false), 2000);
                                    }}
                                    onReport={() => openReportModal("post", reply.id)}
                                    isNested
                                    parentAuthor={post.author?.username}
                                />
                            </div>
                        ))}
                    </div>
                ))}
            </div>

            {/* Reply Form */}
            {!thread.is_locked && isAuthenticated && (
                <GlassCard id="reply-form" className="!p-6 border-2 border-primary/20">
                    {/* Reply Context Indicator */}
                    {replyContext && (
                        <div className="mb-4 p-3 bg-secondary/30 rounded-lg border border-border">
                            <div className="flex items-start justify-between">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                                        <CornerDownRight className="w-3 h-3" />
                                        Replying to {replyContext.type === "thread" ? "thread" : "comment"} by 
                                        <span className="text-primary font-medium">@{replyContext.author}</span>
                                    </div>
                                    <p className="text-sm text-muted-foreground line-clamp-2">
                                        "{replyContext.content}"
                                    </p>
                                </div>
                                <button
                                    onClick={clearReplyContext}
                                    className="p-1 hover:bg-secondary rounded transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    )}
                    
                    <h3 className="font-bold font-mono mb-4">
                        {replyContext ? "Write your reply" : "Add a reply"}
                    </h3>
                    <textarea
                        value={replyContent}
                        onChange={(e) => setReplyContent(e.target.value)}
                        placeholder={replyContext ? "Write your response..." : "Join the discussion..."}
                        rows={4}
                        className="w-full bg-secondary/20 border border-border rounded-lg px-4 py-3 font-mono text-sm focus:border-primary outline-none resize-none"
                    />
                    <div className="flex justify-end gap-3 mt-4">
                        {replyContext && (
                            <button
                                onClick={clearReplyContext}
                                className="px-4 py-2 text-sm font-mono text-muted-foreground hover:text-foreground transition-colors"
                            >
                                Cancel
                            </button>
                        )}
                        <button
                            onClick={handleSubmitReply}
                            disabled={!replyContent.trim() || submitting}
                            className="flex items-center gap-2 px-6 py-2 bg-primary text-primary-foreground rounded-lg font-bold font-mono text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
                        >
                            {submitting ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Send className="w-4 h-4" />
                            )}
                            Post Reply
                        </button>
                    </div>
                </GlassCard>
            )}

            {thread.is_locked && (
                <GlassCard className="!p-6 text-center">
                    <p className="text-muted-foreground font-mono">This thread has been locked</p>
                </GlassCard>
            )}

            {/* Share Modal */}
            {shareModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <GlassCard className="!p-6 max-w-md w-full">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="font-bold font-mono text-lg flex items-center gap-2">
                                <Share2 className="w-5 h-5" />
                                Share Discussion
                            </h3>
                            <button onClick={() => setShareModalOpen(false)} className="p-1 hover:bg-secondary rounded">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        
                        <div className="space-y-4">
                            {/* Copy Link */}
                            <button
                                onClick={copyLink}
                                className="w-full flex items-center gap-3 p-3 bg-secondary/20 rounded-lg hover:bg-secondary/30 transition-colors"
                            >
                                {copiedLink ? <Check className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5" />}
                                <span className="font-mono text-sm">{copiedLink ? "Copied!" : "Copy link"}</span>
                            </button>
                            
                            {/* Social Share */}
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={shareOnTwitter}
                                    className="flex items-center gap-2 p-3 bg-[#1DA1F2]/10 text-[#1DA1F2] rounded-lg hover:bg-[#1DA1F2]/20 transition-colors"
                                >
                                    <Twitter className="w-5 h-5" />
                                    <span className="font-mono text-sm">Twitter</span>
                                </button>
                                <button
                                    onClick={shareOnFacebook}
                                    className="flex items-center gap-2 p-3 bg-[#4267B2]/10 text-[#4267B2] rounded-lg hover:bg-[#4267B2]/20 transition-colors"
                                >
                                    <Facebook className="w-5 h-5" />
                                    <span className="font-mono text-sm">Facebook</span>
                                </button>
                            </div>
                        </div>
                    </GlassCard>
                </div>
            )}

            {/* Report Modal */}
            {reportModalOpen && (
                <ReportModal
                    target={reportTarget}
                    onClose={() => setReportModalOpen(false)}
                    onSubmit={async (reason, details) => {
                        if (!reportTarget) return;
                        try {
                            if (reportTarget.type === "thread") {
                                await reportThread(reportTarget.id, reason, details);
                            } else {
                                await reportPost(reportTarget.id, reason, details);
                            }
                            alert("Report submitted. Thank you for keeping the community safe!");
                        } catch (err) {
                            alert("Failed to submit report. Please try again.");
                        }
                        setReportModalOpen(false);
                    }}
                />
            )}
        </div>
    );
}

// ==================== Post Card Component ====================
interface PostCardProps {
    post: PostType;
    index: number;
    isReplying: boolean;
    onReplyClick: () => void;
    onVote: (type: "up" | "down") => void;
    voting: boolean;
    isAuthenticated: boolean;
    onShare: () => void;
    onReport: () => void;
    canMarkSolution?: boolean;
    onMarkSolution?: () => void;
    isNested?: boolean;
    parentAuthor?: string;
}

function PostCard({ post, isReplying, onReplyClick, onVote, voting, isAuthenticated, onShare, onReport, canMarkSolution, onMarkSolution, isNested, parentAuthor }: PostCardProps) {
    const score = (post.upvotes || 0) - (post.downvotes || 0);
    const isSolution = post.is_solution;

    return (
        <GlassCard id={`post-${post.id}`} className={`!p-5 ${isSolution ? "border-emerald-500/30" : ""} ${isNested ? "!p-4" : ""}`}>
            <div className="flex items-start gap-3">
                {/* Vote Buttons */}
                <div className="flex flex-col items-center gap-1">
                    <button
                        onClick={() => onVote("up")}
                        disabled={!isAuthenticated || voting}
                        className="p-1 hover:bg-secondary rounded transition-colors disabled:opacity-50"
                    >
                        <ArrowBigUp
                            className={`w-5 h-5 ${score > 0 ? "text-primary" : "text-muted-foreground"}`}
                        />
                    </button>
                    <span className="font-bold font-mono text-sm">{score}</span>
                    <button
                        onClick={() => onVote("down")}
                        disabled={!isAuthenticated || voting}
                        className="p-1 hover:bg-secondary rounded transition-colors disabled:opacity-50"
                    >
                        <ArrowBigDown
                            className={`w-5 h-5 ${score < 0 ? "text-red-500" : "text-muted-foreground"}`}
                        />
                    </button>
                </div>

                {/* Post Content */}
                <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
                            {post.author?.avatar_url ? (
                                <img src={post.author.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                            ) : (
                                <User className="w-3 h-3" />
                            )}
                        </div>
                        <span className="font-mono text-sm font-medium text-primary">@{post.author?.username}</span>
                        {isNested && parentAuthor && (
                            <>
                                <CornerDownRight className="w-3 h-3 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">replying to @{parentAuthor}</span>
                            </>
                        )}
                        <span className="text-muted-foreground text-xs ml-auto">
                            {formatDistanceToNow(new Date(post.created_at))} ago
                        </span>
                        {isSolution && (
                            <span className="flex items-center gap-1 px-2 py-0.5 bg-emerald-500/10 text-emerald-500 text-[10px] font-bold font-mono rounded">
                                <CheckCircle2 className="w-3 h-3" />
                                SOLUTION
                            </span>
                        )}
                    </div>

                    {/* Content */}
                    <div className="prose prose-invert max-w-none">
                        <p className="whitespace-pre-wrap text-sm">{post.content}</p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-4 mt-3">
                        <button
                            onClick={onReplyClick}
                            className={`flex items-center gap-1 text-xs font-mono transition-colors ${
                                isReplying ? "text-primary" : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <CornerDownRight className="w-3 h-3" />
                            Reply
                        </button>
                        {canMarkSolution && onMarkSolution && (
                            <button
                                type="button"
                                onClick={onMarkSolution}
                                className={`flex items-center gap-1 text-xs font-mono transition-colors ${
                                    isSolution
                                        ? "text-emerald-500 hover:text-emerald-400"
                                        : "text-muted-foreground hover:text-emerald-500"
                                }`}
                            >
                                <CheckCircle2 className="w-3 h-3" />
                                {isSolution ? "Unmark solution" : "Mark solution"}
                            </button>
                        )}
                        <button 
                            onClick={onShare}
                            className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <LinkIcon className="w-3 h-3" />
                            Copy Link
                        </button>
                        <button 
                            onClick={onReport}
                            className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-red-500 transition-colors"
                        >
                            <Flag className="w-3 h-3" />
                            Report
                        </button>
                    </div>
                </div>
            </div>
        </GlassCard>
    );
}

// ==================== Report Modal Component ====================
interface ReportModalProps {
    target: { type: "thread" | "post"; id: string } | null;
    onClose: () => void;
    onSubmit: (reason: string, details: string) => void;
}

const REPORT_REASONS = [
    { value: "spam", label: "Spam or misleading" },
    { value: "harassment", label: "Harassment or bullying" },
    { value: "inappropriate", label: "Inappropriate content" },
    { value: "offtopic", label: "Off-topic" },
    { value: "other", label: "Other" },
];

function ReportModal({ target, onClose, onSubmit }: ReportModalProps) {
    const [reason, setReason] = useState("");
    const [details, setDetails] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async () => {
        if (!reason) return;
        setSubmitting(true);
        await onSubmit(reason, details);
        setSubmitting(false);
    };

    if (!target) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <GlassCard className="!p-6 max-w-md w-full">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="font-bold font-mono text-lg flex items-center gap-2 text-red-500">
                        <AlertTriangle className="w-5 h-5" />
                        Report {target.type === "thread" ? "Thread" : "Comment"}
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-secondary rounded">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                
                <div className="space-y-4">
                    {/* Reason Selection */}
                    <div>
                        <label className="block text-sm font-mono font-medium mb-2">
                            Reason <span className="text-red-500">*</span>
                        </label>
                        <div className="space-y-2">
                            {REPORT_REASONS.map((r) => (
                                <label key={r.value} className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="report-reason"
                                        value={r.value}
                                        checked={reason === r.value}
                                        onChange={(e) => setReason(e.target.value)}
                                        className="text-primary focus:ring-primary"
                                    />
                                    <span className="text-sm font-mono">{r.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                    
                    {/* Details */}
                    <div>
                        <label className="block text-sm font-mono font-medium mb-2">
                            Additional Details
                        </label>
                        <textarea
                            value={details}
                            onChange={(e) => setDetails(e.target.value)}
                            placeholder="Provide more context about your report..."
                            rows={3}
                            className="w-full bg-secondary/20 border border-border rounded-lg px-4 py-3 font-mono text-sm focus:border-primary outline-none resize-none"
                        />
                    </div>
                    
                    {/* Actions */}
                    <div className="flex justify-end gap-3 pt-4">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-mono text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={!reason || submitting}
                            className="flex items-center gap-2 px-6 py-2 bg-red-500 text-white rounded-lg font-bold font-mono text-sm hover:bg-red-600 disabled:opacity-50 transition-colors"
                        >
                            {submitting ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Flag className="w-4 h-4" />
                            )}
                            Submit Report
                        </button>
                    </div>
                </div>
            </GlassCard>
        </div>
    );
}

export default function ThreadPage() {
    return (
        <ProtectedRoute requireAuth={false}>
            <ThreadPageContent />
        </ProtectedRoute>
    );
}
