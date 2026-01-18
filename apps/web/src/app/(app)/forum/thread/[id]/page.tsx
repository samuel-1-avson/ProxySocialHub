'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { MessageSquare, ThumbsUp, ThumbsDown, User, Clock, ArrowLeft, Send } from 'lucide-react';
import { getThread, createPost, votePost, ForumThread, ForumPost } from '@/lib/api';
import ReactMarkdown from 'react-markdown';

export default function ThreadDetailPage() {
    const params = useParams();
    const id = params?.id as string;

    const [thread, setThread] = useState<ForumThread | null>(null);
    const [posts, setPosts] = useState<ForumPost[]>([]);
    const [loading, setLoading] = useState(true);
    const [replyContent, setReplyContent] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (id) fetchData();
    }, [id]);

    const fetchData = async () => {
        try {
            const data = await getThread(id);
            setThread(data.thread);
            setPosts(data.posts);
        } catch (error) {
            console.error('Failed to fetch thread:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleReply = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!replyContent.trim()) return;

        setSubmitting(true);
        try {
            await createPost(id, replyContent);
            await fetchData();
            setReplyContent('');
        } catch (error) {
            console.error('Failed to reply:', error);
            alert('Failed to post reply');
        } finally {
            setSubmitting(false);
        }
    };

    const handleVote = async (postId: string, type: 1 | -1) => {
        try {
            // Optimistic update could go here
            await votePost(postId, type);
            await fetchData(); // Refresh counts
        } catch (error) {
            console.error('Vote failed:', error);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500"></div>
            </div>
        );
    }

    if (!thread) {
        return (
            <div className="p-6 text-center">
                <h2 className="text-xl text-white">Thread not found</h2>
                <Link href="/forum" className="text-primary-400 hover:underline mt-4 inline-block">Back to Forum</Link>
            </div>
        );
    }

    return (
        <div className="space-y-6 p-6 max-w-5xl mx-auto">
            {/* Navigation */}
            <Link
                href={`/forum/${thread.slug || ''}`}
                className="inline-flex items-center gap-2 text-white/40 hover:text-white transition-colors"
            >
                <ArrowLeft className="w-4 h-4" /> Back to Threads
            </Link>

            {/* Main Thread Post */}
            <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                <div className="p-6 border-b border-white/5 bg-white/[0.02]">
                    <h1 className="text-2xl font-bold text-white mb-2">{thread.title}</h1>
                    <div className="flex items-center gap-4 text-xs text-white/40">
                        <span className="flex items-center gap-1.5">
                            <div className="w-6 h-6 rounded-full bg-primary-500/20 flex items-center justify-center text-primary-400 font-bold">
                                {(thread.author?.email?.[0] || 'U').toUpperCase()}
                            </div>
                            {thread.author?.email?.split('@')[0]}
                        </span>
                        <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(thread.created_at).toLocaleString()}
                        </span>
                    </div>
                </div>
                <div className="p-6 prose prose-invert max-w-none text-white/80">
                    <ReactMarkdown>{thread.content}</ReactMarkdown>
                </div>
            </div>

            {/* Replies */}
            <div className="space-y-4 pt-4">
                <h3 className="text-lg font-semibold text-white px-2">
                    {posts.length} {posts.length === 1 ? 'Reply' : 'Replies'}
                </h3>

                {posts.map((post) => (
                    <div key={post.id} className="bg-white/5 border border-white/5 rounded-xl p-6 flex gap-4">
                        <div className="flex flex-col items-center gap-1 pt-1">
                            <button onClick={() => handleVote(post.id, 1)} className="p-1 hover:bg-white/10 rounded text-white/40 hover:text-green-400 transition-colors">
                                <ThumbsUp className="w-4 h-4" />
                            </button>
                            <span className="text-xs font-bold text-white/60">{(post.upvotes || 0) - (post.downvotes || 0)}</span>
                            <button onClick={() => handleVote(post.id, -1)} className="p-1 hover:bg-white/10 rounded text-white/40 hover:text-red-400 transition-colors">
                                <ThumbsDown className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="flex-1">
                            <div className="flex items-center gap-3 text-xs text-white/40 mb-2">
                                <span className="font-bold text-white/60">{post.author?.email?.split('@')[0]}</span>
                                <span>•</span>
                                <span>{new Date(post.created_at).toLocaleString()}</span>
                            </div>
                            <div className="prose prose-invert prose-sm max-w-none text-white/80">
                                <ReactMarkdown>{post.content}</ReactMarkdown>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Reply Form */}
            <motion.form
                onSubmit={handleReply}
                className="sticky bottom-6 mt-8 p-4 bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl"
            >
                <div className="flex gap-4">
                    <textarea
                        value={replyContent}
                        onChange={(e) => setReplyContent(e.target.value)}
                        placeholder="Write a reply..."
                        className="flex-1 bg-transparent border-none text-white focus:ring-0 resize-none min-h-[50px] py-3"
                        rows={2}
                    />
                    <button
                        type="submit"
                        disabled={!replyContent.trim() || submitting}
                        className="self-end px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-xl font-medium transition-all disabled:opacity-50 flex items-center gap-2"
                    >
                        {submitting ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Send className="w-4 h-4" />}
                        Reply
                    </button>
                </div>
            </motion.form>
        </div>
    );
}
