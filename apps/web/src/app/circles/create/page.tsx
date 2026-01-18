'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createCircle } from '@/lib/api';

export default function CreateCirclePage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [formData, setFormData] = useState({
        name: '',
        description: '',
        visibility: 'public',
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name) {
            setError('Circle name is required');
            return;
        }

        try {
            setLoading(true);
            setError('');
            await createCircle(formData.name, formData.description, formData.visibility);
            router.push('/circles');
        } catch (err) {
            setError('Failed to create circle. Please try again.');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-background pb-20 md:pb-0">
            {/* Header */}
            <header className="bg-card/50 border-b border-card-border sticky top-0 md:relative z-40 backdrop-blur-md">
                <div className="container mx-auto px-4 md:px-6 py-4 flex items-center gap-4">
                    <Link href="/circles" className="text-muted hover:text-foreground">
                        ← Back to Circles
                    </Link>
                </div>
            </header>

            <main className="container mx-auto px-4 md:px-6 py-8 flex justify-center">
                <div className="w-full max-w-lg">
                    <div className="mb-8">
                        <h1 className="text-2xl md:text-3xl font-bold mb-2">Create a Circle</h1>
                        <p className="text-muted">Start a new provider group to organize nodes and earn rewards.</p>
                    </div>

                    {error && (
                        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg mb-6 text-sm">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="card space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-muted mb-2">
                                Circle Name
                            </label>
                            <input
                                type="text"
                                className="input w-full"
                                placeholder="e.g. London Low Latency Group"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-muted mb-2">
                                Description
                            </label>
                            <textarea
                                className="input w-full min-h-[100px] resize-y"
                                placeholder="What is this circle about?"
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-muted mb-2">
                                Visibility
                            </label>
                            <div className="grid grid-cols-2 gap-4">
                                <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, visibility: 'public' })}
                                    className={`p-4 rounded-lg border text-left transition-all ${formData.visibility === 'public'
                                            ? 'border-primary bg-primary/5 ring-1 ring-primary'
                                            : 'border-card-border hover:border-foreground/50'
                                        }`}
                                >
                                    <div className="font-bold mb-1">Public</div>
                                    <div className="text-xs text-muted">Anyone can see and request to join.</div>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, visibility: 'private' })}
                                    className={`p-4 rounded-lg border text-left transition-all ${formData.visibility === 'private'
                                            ? 'border-primary bg-primary/5 ring-1 ring-primary'
                                            : 'border-card-border hover:border-foreground/50'
                                        }`}
                                >
                                    <div className="font-bold mb-1">Private</div>
                                    <div className="text-xs text-muted">Invite only. Hidden from search.</div>
                                </button>
                            </div>
                        </div>

                        <div className="pt-4 flex gap-4">
                            <Link href="/circles" className="btn btn-secondary flex-1">
                                Cancel
                            </Link>
                            <button
                                type="submit"
                                disabled={loading}
                                className="btn btn-primary flex-1 shadow-retro disabled:opacity-50"
                            >
                                {loading ? 'Creating...' : 'Create Circle'}
                            </button>
                        </div>
                    </form>
                </div>
            </main>
        </div>
    );
}
