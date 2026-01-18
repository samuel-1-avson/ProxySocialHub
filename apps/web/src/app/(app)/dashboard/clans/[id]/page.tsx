'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { getCircle, Circle } from '@/lib/social-api';
import { Navbar } from '@/components/Navbar';

export default function ClanDetailsPage() {
    const params = useParams();
    const { isAuthenticated } = useAuth();
    const circleId = params?.id as string;
    const [circle, setCircle] = useState<Circle | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (circleId) {
            loadCircle();
        }
    }, [circleId]);

    const loadCircle = async () => {
        try {
            const data = await getCircle(circleId);
            setCircle(data);
        } catch {
            setError('Failed to load clan');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen" style={{ background: "var(--background)" }}>
                <Navbar />
                <div className="flex items-center justify-center py-20">
                    <div className="spinner"></div>
                </div>
            </div>
        );
    }

    if (error || !circle) {
        return (
            <div className="min-h-screen" style={{ background: "var(--background)" }}>
                <Navbar />
                <div className="text-center py-20">
                    <p style={{ color: "var(--error)" }}>{error || 'Clan not found'}</p>
                    <Link href="/dashboard/clans" className="btn btn-secondary mt-4">Back to Clans</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen" style={{ background: "var(--background)" }}>
            <Navbar />
            <main className="container py-8">
                <Link href="/dashboard/clans" className="text-sm hover:underline mb-4 inline-block" style={{ color: "var(--muted)" }}>
                    &larr; Back to Clans
                </Link>

                <div className="card mb-8">
                    <div className="flex justify-between items-start">
                        <div>
                            <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--foreground)" }}>{circle.name}</h1>
                            <p className="text-lg mb-4" style={{ color: "var(--muted)" }}>{circle.description}</p>
                            <div className="flex gap-4">
                                <span className="badge badge-primary">{(circle.revenue_share_percent * 100).toFixed(0)}% Tax</span>
                                <span className="badge badge-secondary">{circle.visibility}</span>
                                <span className="badge badge-secondary">{circle.member_count} Members</span>
                            </div>
                        </div>
                        {isAuthenticated && (
                            <button className="btn btn-secondary" disabled>Only Owner Can Edit</button>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="card col-span-2">
                        <h2 className="text-xl font-bold mb-4" style={{ color: "var(--foreground)" }}>Listings</h2>
                        <p style={{ color: "var(--muted)" }}>No listings linked to this clan yet.</p>
                        {/* 
                            TODO: Fetch listings with circle_id = current circle
                        */}
                    </div>

                    <div className="card h-fit">
                        <h2 className="text-xl font-bold mb-4" style={{ color: "var(--foreground)" }}>Members</h2>
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="avatar-sm">
                                    <span>O</span>
                                </div>
                                <div>
                                    <p className="font-medium" style={{ color: "var(--foreground)" }}>Owner</p>
                                    <p className="text-xs" style={{ color: "var(--muted)" }}>Clan Leader</p>
                                </div>
                            </div>
                            {/* Member list loop would go here */}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
