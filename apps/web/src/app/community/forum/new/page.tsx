"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { getForumCategories, createThread, type ForumCategory } from "@/lib/forum-api";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { GlassCard } from "@/components/ui/glass-card";
import {
    ArrowLeft,
    Plus,
    Loader2,
    MessageSquare,
    AlertCircle,
    CheckCircle2,
} from "lucide-react";
import { getErrorMessage } from "@/lib/utils";

function NewThreadContent() {
    const router = useRouter();
    const { user } = useAuth();
    const [categories, setCategories] = useState<ForumCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [formData, setFormData] = useState({
        title: "",
        content: "",
        category_slug: "",
    });

    const [validation, setValidation] = useState({
        title: "",
        content: "",
        category_slug: "",
    });

    useEffect(() => {
        loadCategories();
    }, []);

    const loadCategories = async () => {
        try {
            const data = await getForumCategories();
            setCategories(data.categories || []);
            // Set default category if available
            if (data.categories?.length > 0) {
                setFormData((prev) => ({ ...prev, category_slug: data.categories[0].slug }));
            }
        } catch (err) {
            console.error("Failed to load categories:", err);
        } finally {
            setLoading(false);
        }
    };

    const validate = (): boolean => {
        const errors = {
            title: "",
            content: "",
            category_slug: "",
        };

        if (!formData.title.trim()) {
            errors.title = "Title is required";
        } else if (formData.title.length < 5) {
            errors.title = "Title must be at least 5 characters";
        } else if (formData.title.length > 200) {
            errors.title = "Title must be less than 200 characters";
        }

        if (!formData.content.trim()) {
            errors.content = "Content is required";
        } else if (formData.content.length < 10) {
            errors.content = "Content must be at least 10 characters";
        }

        if (!formData.category_slug) {
            errors.category_slug = "Please select a category";
        }

        setValidation(errors);
        return !Object.values(errors).some(Boolean);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!validate()) return;

        setSubmitting(true);
        setError(null);

        try {
            const thread = await createThread({
                category_slug: formData.category_slug,
                title: formData.title.trim(),
                content: formData.content.trim(),
            });
            router.push(`/forum/thread/${thread.id}`);
        } catch (err: unknown) {
            setError(getErrorMessage(err) || "Failed to create thread");
            setSubmitting(false);
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
        <div className="max-w-3xl mx-auto space-y-6">
            {/* Back Link */}
            <Link
                href="/help/forum"
                className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors font-mono text-sm"
            >
                <ArrowLeft className="w-4 h-4" />
                Back to Forum
            </Link>

            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold font-mono tracking-tight flex items-center gap-3">
                    <Plus className="w-8 h-8 text-primary" />
                    Start New Discussion
                </h1>
                <p className="text-muted-foreground mt-2">
                    Share your knowledge, ask questions, or start a conversation
                </p>
            </div>

            {/* Guidelines */}
            <GlassCard className="!p-4 bg-gradient-to-br from-primary/5 to-transparent border-primary/20">
                <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    <div className="text-sm space-y-1">
                        <p className="font-medium">Before you post:</p>
                        <ul className="text-muted-foreground space-y-1 list-disc list-inside">
                            <li>Search to see if your question has already been answered</li>
                            <li>Be specific and provide details in your title</li>
                            <li>Use proper formatting and be respectful</li>
                            <li>Choose the most relevant category</li>
                        </ul>
                    </div>
                </div>
            </GlassCard>

            {/* Form */}
            <GlassCard className="!p-6">
                {error && (
                    <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-3 text-red-500">
                        <AlertCircle className="w-5 h-5" />
                        <p className="text-sm font-mono">{error}</p>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Category */}
                    <div>
                        <label className="block text-sm font-mono font-medium mb-2">
                            Category <span className="text-red-500">*</span>
                        </label>
                        <select
                            value={formData.category_slug}
                            onChange={(e) =>
                                setFormData({ ...formData, category_slug: e.target.value })
                            }
                            className={`w-full bg-secondary/20 border rounded-lg px-4 py-3 font-mono text-sm focus:border-primary outline-none transition-colors ${
                                validation.category_slug ? "border-red-500" : "border-border"
                            }`}
                        >
                            <option value="">Select a category</option>
                            {categories.map((category) => (
                                <option key={category.id} value={category.slug}>
                                    {category.name}
                                </option>
                            ))}
                        </select>
                        {validation.category_slug && (
                            <p className="text-red-500 text-xs mt-1 font-mono">{validation.category_slug}</p>
                        )}
                    </div>

                    {/* Title */}
                    <div>
                        <label className="block text-sm font-mono font-medium mb-2">
                            Title <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={formData.title}
                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                            placeholder="What's your discussion about?"
                            className={`w-full bg-secondary/20 border rounded-lg px-4 py-3 font-mono text-sm focus:border-primary outline-none transition-colors ${
                                validation.title ? "border-red-500" : "border-border"
                            }`}
                        />
                        {validation.title && (
                            <p className="text-red-500 text-xs mt-1 font-mono">{validation.title}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1 font-mono">
                            {formData.title.length}/200 characters
                        </p>
                    </div>

                    {/* Content */}
                    <div>
                        <label className="block text-sm font-mono font-medium mb-2">
                            Content <span className="text-red-500">*</span>
                        </label>
                        <textarea
                            value={formData.content}
                            onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                            placeholder="Provide details, context, and any relevant information..."
                            rows={8}
                            className={`w-full bg-secondary/20 border rounded-lg px-4 py-3 font-mono text-sm focus:border-primary outline-none resize-none transition-colors ${
                                validation.content ? "border-red-500" : "border-border"
                            }`}
                        />
                        {validation.content && (
                            <p className="text-red-500 text-xs mt-1 font-mono">{validation.content}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1 font-mono">
                            Markdown formatting supported
                        </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between pt-4 border-t border-border">
                        <Link
                            href="/help/forum"
                            className="px-6 py-2 text-sm font-mono text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Cancel
                        </Link>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="flex items-center gap-2 px-8 py-3 bg-primary text-primary-foreground rounded-lg font-bold font-mono text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
                        >
                            {submitting ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Creating...
                                </>
                            ) : (
                                <>
                                    <MessageSquare className="w-4 h-4" />
                                    Post Discussion
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </GlassCard>
        </div>
    );
}

export default function NewThreadPage() {
    return (
        <ProtectedRoute>
            <NewThreadContent />
        </ProtectedRoute>
    );
}
