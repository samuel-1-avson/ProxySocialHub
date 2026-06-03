'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { HelpCircle, Loader2, MessageSquare, Send } from 'lucide-react';
import {
    askListingQuestion,
    fetchListingQA,
} from '@/lib/api/listing-social';
import type { ForumThread } from '@/lib/forum-api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/stores';

interface ListingQASectionProps {
    listingId: string;
    compact?: boolean;
    className?: string;
}

export function ListingQASection({
    listingId,
    compact = false,
    className = '',
}: ListingQASectionProps) {
    const { isAuthenticated } = useAuth();
    const toast = useToast();
    const [questions, setQuestions] = useState<ForumThread[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');

    const loadQA = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchListingQA(listingId);
            setQuestions(data.questions ?? []);
        } catch {
            setQuestions([]);
        } finally {
            setLoading(false);
        }
    }, [listingId]);

    useEffect(() => {
        loadQA();
    }, [loadQA]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isAuthenticated) {
            toast.warning('Sign in required', 'Sign in to ask a question about this listing.');
            return;
        }
        if (title.trim().length < 5 || content.trim().length < 10) {
            toast.warning('Too short', 'Use at least 5 characters for the title and 10 for the question.');
            return;
        }

        setSubmitting(true);
        try {
            const thread = await askListingQuestion(listingId, {
                title: title.trim(),
                content: content.trim(),
            });
            setQuestions((prev) => [thread, ...prev]);
            setTitle('');
            setContent('');
            setShowForm(false);
            toast.success('Question posted', 'The provider and community can reply on the thread.');
        } catch (err) {
            toast.error(
                'Could not post question',
                err instanceof Error ? err.message : 'Please try again.'
            );
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div
            className={`rounded-xl border border-white/10 bg-white/[0.02] ${compact ? 'p-4 space-y-3' : 'p-5 space-y-4'} ${className}`}
        >
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                    <HelpCircle size={14} className="text-primary/70" />
                    Questions & answers
                </h3>
                {!compact && questions.length > 0 && (
                    <span className="text-[9px] font-mono text-muted-foreground/50 uppercase">
                        {questions.length} thread{questions.length === 1 ? '' : 's'}
                    </span>
                )}
            </div>

            {loading ? (
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase text-muted-foreground/40">
                    <Loader2 size={14} className="animate-spin" />
                    Loading Q&A…
                </div>
            ) : questions.length === 0 ? (
                <p className="text-[10px] font-mono text-muted-foreground/50 uppercase leading-relaxed">
                    No questions yet. Ask about latency, routing, or availability before you buy.
                </p>
            ) : (
                <ul className={`space-y-2 ${compact ? 'max-h-[160px] overflow-y-auto' : ''}`}>
                    {questions.slice(0, compact ? 5 : 20).map((q) => (
                        <li key={q.id}>
                            <Link
                                href={`/community/forum/thread/${q.id}`}
                                className="block rounded-lg border border-white/5 bg-black/20 px-3 py-2 hover:border-primary/30 transition-colors"
                            >
                                <div className="text-[11px] font-bold text-foreground line-clamp-1">
                                    {q.title}
                                </div>
                                <div className="flex flex-wrap items-center gap-2 mt-1 text-[9px] font-mono uppercase text-muted-foreground/50">
                                    <span className="inline-flex items-center gap-1">
                                        <MessageSquare size={10} />
                                        {q.replies_count} replies
                                    </span>
                                    {q.author?.display_name || q.author?.username ? (
                                        <span>
                                            by {q.author?.display_name || q.author?.username}
                                        </span>
                                    ) : null}
                                </div>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}

            {showForm ? (
                <form onSubmit={handleSubmit} className="space-y-3 border-t border-white/5 pt-3">
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Question title (min 5 chars)"
                        maxLength={200}
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/40"
                    />
                    <textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        placeholder="Details for the provider (min 10 chars)"
                        rows={compact ? 3 : 4}
                        maxLength={2000}
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/40 resize-none"
                    />
                    <div className="flex gap-2">
                        <button
                            type="submit"
                            disabled={submitting}
                            className="inline-flex items-center justify-center gap-2 flex-1 py-2 rounded-lg bg-primary/15 border border-primary/30 text-[10px] font-black uppercase tracking-widest text-primary hover:bg-primary/25 disabled:opacity-50"
                        >
                            {submitting ? (
                                <Loader2 size={14} className="animate-spin" />
                            ) : (
                                <Send size={14} />
                            )}
                            Post question
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowForm(false)}
                            className="py-2 px-3 rounded-lg border border-white/10 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground"
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            ) : (
                <button
                    type="button"
                    onClick={() => {
                        if (!isAuthenticated) {
                            toast.warning('Sign in required', 'Sign in to ask a question.');
                            return;
                        }
                        setShowForm(true);
                    }}
                    className="w-full py-2.5 rounded-lg border border-white/10 bg-white/5 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
                >
                    Ask a question
                </button>
            )}
        </div>
    );
}
