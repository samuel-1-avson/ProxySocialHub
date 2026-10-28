"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getForumCategories, createThread, type ForumCategory } from "@/lib/forum-api";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PageHeading, Loading, DataError } from "@/components/workspace/Patterns";
import { Loader2 } from "lucide-react";
import { getErrorMessage } from "@/lib/utils";

function NewThreadContent() {
    const router = useRouter();
    const [categories, setCategories] = useState<ForumCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<unknown>(null);
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
            setLoadError(null);
            const data = await getForumCategories();
            setCategories(data.categories || []);
            if (data.categories?.length > 0) {
                setFormData((prev) => ({ ...prev, category_slug: data.categories[0].slug }));
            }
        } catch (err) {
            console.error("Failed to load categories:", err);
            setLoadError(err);
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
        return <Loading label="Loading composer…" />;
    }

    return (
        <div className="ui-page max-w-3xl min-w-0">
            <Link href="/help/forum" className="ui-link text-sm">
                Back to Forum
            </Link>

            <PageHeading
                eyebrow="Community"
                title="Start New Discussion"
                description="Share your knowledge, ask questions, or start a conversation"
            />

            <p className="ui-note">
                Before you post: search to see if your question has already been answered, be specific in
                your title, use respectful formatting, and choose the most relevant category.
            </p>

            {loadError ? (
                <DataError error={loadError} retry={() => void loadCategories()} />
            ) : null}

            <section className="ui-surface min-w-0">
                {error && (
                    <div className="ui-error mb-6" role="alert">
                        <strong>Could not create discussion</strong>
                        <p>{error}</p>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6 min-w-0">
                    <label className="ui-field">
                        Category
                        <select
                            value={formData.category_slug}
                            onChange={(e) =>
                                setFormData({ ...formData, category_slug: e.target.value })
                            }
                            className="ui-select w-full"
                            aria-invalid={Boolean(validation.category_slug)}
                            required
                        >
                            <option value="">Select a category</option>
                            {categories.map((category) => (
                                <option key={category.id} value={category.slug}>
                                    {category.name}
                                </option>
                            ))}
                        </select>
                        {validation.category_slug ? (
                            <p className="text-sm text-destructive" role="alert">
                                {validation.category_slug}
                            </p>
                        ) : null}
                    </label>

                    <label className="ui-field">
                        Title
                        <input
                            type="text"
                            value={formData.title}
                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                            placeholder="What's your discussion about?"
                            className="ui-input w-full"
                            aria-invalid={Boolean(validation.title)}
                            required
                        />
                        {validation.title ? (
                            <p className="text-sm text-destructive" role="alert">
                                {validation.title}
                            </p>
                        ) : null}
                        <small>{formData.title.length}/200 characters</small>
                    </label>

                    <label className="ui-field">
                        Content
                        <textarea
                            value={formData.content}
                            onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                            placeholder="Provide details, context, and any relevant information..."
                            rows={8}
                            className="ui-input w-full"
                            aria-invalid={Boolean(validation.content)}
                            required
                        />
                        {validation.content ? (
                            <p className="text-sm text-destructive" role="alert">
                                {validation.content}
                            </p>
                        ) : null}
                        <small>Markdown formatting supported</small>
                    </label>

                    <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-border">
                        <Link href="/help/forum" className="ui-button secondary w-full sm:w-auto">
                            Cancel
                        </Link>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="ui-button w-full sm:w-auto"
                        >
                            {submitting ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                                    Creating...
                                </>
                            ) : (
                                "Post Discussion"
                            )}
                        </button>
                    </div>
                </form>
            </section>
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
