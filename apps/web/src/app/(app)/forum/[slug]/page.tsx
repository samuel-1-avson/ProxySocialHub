'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { MessageSquare, Plus, Clock, User, ArrowLeft } from 'lucide-react';
import { getCategoryThreads, createThread, ForumCategory, ForumThread } from '@/lib/api';

export default function CategoryThreadsPage() {
    const params = useParams();
    const slug = params?.slug as string;

    const [category, setCategory] = useState<ForumCategory | null>(null);
    const [threads, setThreads] = useState<ForumThread[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newContent, setNewContent] = useState('');
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        if (slug) fetchData();
    }, [slug]);

    const fetchData = async () => {
        try {
            const data = await getCategoryThreads(slug);
            setCategory(data.category);
            setThreads(data.threads);
        } catch (error) {
            console.error('Failed to fetch threads:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTitle.trim() || !newContent.trim()) return;

        setCreating(true);
        try {
            await createThread(slug, newTitle, newContent);
            await fetchData();
            setShowCreate(false);
            setNewTitle('');
            setNewContent('');
        } catch (error) {
            console.error('Failed to create thread:', error);
            alert('Failed to create thread');
        } finally {
            setCreating(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500"></div>
            </div>
        );
    }

    if (!category) {
        return (
            <div className="p-6 text-center">
                <h2 className="text-xl text-white">Category not found</h2>
                <Link href="/forum" className="text-primary-400 hover:underline mt-4 inline-block">Back to Forum</Link>
            </div>
        );
    }

    return (
        <div className="space-y-6 p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex items-center gap-4">
                    <Link href="/forum" className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/60 hover:text-white">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold text-white tracking-tight">{category.name}</h1>
                        <p className="text-white/60 text-sm mt-1">{category.description}</p>
                    </div>
                </div>
                <button
                    onClick={() => setShowCreate(!showCreate)}
                    className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg font-medium transition-all flex items-center gap-2"
                >
                    {showCreate ? 'Cancel' : <><Plus className="w-4 h-4" /> New Thread</>}
                </button>
            </div>

            {/* Create Form */}
            {showCreate && (
                <motion.form
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    onSubmit={handleCreate}
                    className="p-6 rounded-2xl bg-white/5 border border-white/10 space-y-4"
                >
                    <input
                        type="text"
                        placeholder="Thread Title"
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-primary-500/50"
                        required
                    />
                    <textarea
                        placeholder="What's on your mind?"
                        value={newContent}
                        onChange={(e) => setNewContent(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-primary-500/50 min-h-[150px]"
                        required
                    />
                    <div className="flex justify-end">
                        <button
                            type="submit"
                            disabled={creating}
                            className="px-6 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg font-medium transition-all disabled:opacity-50"
                        >
                            {creating ? 'Posting...' : 'Post Thread'}
                        </button>
                    </div>
                </motion.form>
            )}

            {/* Threads List */}
            <div className="space-y-3">
                {threads.map((thread, idx) => (
                    <Link href={`/forum/thread/${thread.id}`} key={thread.id}>
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            className="p-5 rounded-xl bg-white/5 border border-white/5 hover:border-primary-500/30 hover:bg-white/[0.07] transition-all group"
                        >
                            <div className="flex justify-between items-start gap-4">
                                <div className="flex-1 min-w-0">
                                    <h3 className="text-lg font-semibold text-white group-hover:text-primary-400 transition-colors mb-1 truncate">
                                        {thread.title}
                                    </h3>
                                    <div className="flex items-center gap-4 text-xs text-white/40">
                                        <span className="flex items-center gap-1">
                                            <User className="w-3 h-3" />
                                            {thread.author?.email?.split('@')[0] || 'User'}
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <Clock className="w-3 h-3" />
                                            {new Date(thread.created_at).toLocaleDateString()}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex flex-col items-end gap-1">
                                    <div className="flex items-center gap-1.5 px-3 py-1 bg-white/5 rounded-lg text-xs font-medium text-white/60">
                                        <MessageSquare className="w-3 h-3" />
                                        {thread.replies_count}
                                    </div>
                                    {thread.is_pinned && (
                                        <span className="text-[10px] uppercase font-bold text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded">
                                            Pinned
                                        </span>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    </Link>
                ))}

                {threads.length === 0 && !loading && (
                    <div className="text-center py-12">
                        <p className="text-white/40">No threads yet. Be the first to post!</p>
                    </div>
                )}
            </div>
        </div>
    );
}
