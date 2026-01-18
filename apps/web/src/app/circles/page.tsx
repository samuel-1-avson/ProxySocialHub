'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { getCircles, Circle } from '@/lib/api';

export default function CirclesPage() {
    const { user, isAuthenticated } = useAuth();
    const [circles, setCircles] = useState<Circle[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        loadCircles();
    }, []);

    const loadCircles = async () => {
        try {
            setLoading(true);
            const data = await getCircles();
            setCircles(data);
        } catch (err) {
            setError('Failed to load circles');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-background pb-20 md:pb-0">
            {/* Header */}
            <header className="bg-card/50 border-b border-card-border sticky top-0 md:relative z-40 backdrop-blur-md">
                <div className="container mx-auto px-4 md:px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="flex items-center gap-2">
                            <span className="text-xl">🌐</span>
                            <span className="font-bold text-primary hidden md:inline">ProxyHub</span>
                        </Link>
                        <span className="text-muted text-sm text-foreground/50">/ Circles</span>
                    </div>
                    <div className="flex items-center gap-4">
                        {/* Mobile: Hide user email to save space */}
                        <span className="text-muted text-sm hidden md:inline">{user?.email}</span>
                        <Link href="/circles/create" className="btn btn-primary text-xs md:text-sm shadow-retro">
                            + Create Circle
                        </Link>
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-4 md:px-6 py-8">
                <div className="mb-8">
                    <h1 className="text-2xl md:text-3xl font-bold mb-2">Provider Circles</h1>
                    <p className="text-muted text-sm md:text-base">
                        Join cooperative groups to share bandwidth and earn higher rewards.
                    </p>
                </div>

                {error && (
                    <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg mb-6">
                        {error}
                    </div>
                )}

                {loading ? (
                    <div className="flex justify-center py-12">
                        <div className="spinner w-8 h-8 border-4"></div>
                    </div>
                ) : circles.length === 0 ? (
                    <div className="text-center py-12 card bg-card/50 border-dashed">
                        <div className="text-4xl mb-4">👥</div>
                        <h3 className="text-lg font-semibold mb-2">No Circles Found</h3>
                        <p className="text-muted mb-6">Be the first to start a provider circle!</p>
                        <Link href="/circles/create" className="btn btn-primary shadow-retro">
                            Start a Circle
                        </Link>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {circles.map((circle) => (
                            <Link href={`/circles/${circle.id}`} key={circle.id} className="card hover:border-primary group cursor-pointer block retro-shadow active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all">
                                <div className="flex justify-between items-start mb-4">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold
                    ${circle.visibility === 'public' ? 'bg-primary/20 text-primary' : 'bg-purple-500/20 text-purple-500'}
                  `}>
                                        {circle.name.charAt(0).toUpperCase()}
                                    </div>
                                    <span className={`text-xs px-2 py-1 rounded-full border
                    ${circle.visibility === 'public'
                                            ? 'border-primary/30 text-primary bg-primary/5'
                                            : 'border-purple-500/30 text-purple-500 bg-purple-500/5'}
                  `}>
                                        {circle.visibility}
                                    </span>
                                </div>

                                <h3 className="text-lg font-bold mb-2 group-hover:text-primary transition-colors truncate">{circle.name}</h3>
                                <p className="text-muted text-sm mb-4 line-clamp-2 h-10">{circle.description || "No description provided."}</p>

                                <div className="flex items-center justify-between text-xs text-muted border-t border-card-border pt-4">
                                    <div className="flex items-center gap-1">
                                        <span>👥</span>
                                        <span>{circle.member_count} Members</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {/* Placeholder for uptime/stats if available in list */}
                                        <span>🟢 Active</span>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}
