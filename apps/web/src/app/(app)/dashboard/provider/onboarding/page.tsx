'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { applyForProvider, getProviderApplicationStatus, ProviderApplication } from '@/lib/social-api';
import { Navbar } from '@/components/Navbar';

export default function ProviderOnboardingPage() {
    const { user, isAuthenticated, isLoading } = useAuth();
    const router = useRouter();
    const [status, setStatus] = useState<string>('loading');
    const [application, setApplication] = useState<ProviderApplication | null>(null);
    const [formData, setFormData] = useState({
        reason: '',
        isp: '',
        location: '',
        bandwidth: '100 Mbps',
    });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            router.push('/login');
            return;
        }

        if (isAuthenticated && user?.role === 'provider') {
            router.push('/dashboard/provider');
            return;
        }

        if (isAuthenticated) {
            checkStatus();
        }
    }, [isLoading, isAuthenticated, user, router]);

    const checkStatus = async () => {
        try {
            const data = await getProviderApplicationStatus();
            setStatus(data.status);
            setApplication(data.application);
        } catch {
            setStatus('none');
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSubmitting(true);

        try {
            await applyForProvider(formData);
            await checkStatus();
        } catch (err: any) {
            setError(err.message || 'Failed to submit application');
        } finally {
            setSubmitting(false);
        }
    };

    if (isLoading || status === 'loading') {
        return (
            <div className="min-h-screen" style={{ background: "var(--background)" }}>
                <Navbar />
                <div className="flex items-center justify-center py-20">
                    <div className="spinner"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen" style={{ background: "var(--background)" }}>
            <Navbar />
            <main className="container py-8 max-w-2xl">
                <div className="card">
                    <h1 className="text-2xl font-bold mb-4" style={{ color: "var(--foreground)" }}>
                        Become a Provider
                    </h1>

                    {status === 'pending' ? (
                        <div className="text-center py-8">
                            <div className="text-4xl mb-4">⏳</div>
                            <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--foreground)" }}>Application Pending</h2>
                            <p style={{ color: "var(--muted)" }}>
                                Your application has been submitted and is under review. We will notify you once it's approved.
                            </p>
                            <div className="mt-6 p-4 bg-gray-800/50 rounded-lg text-left">
                                <p className="text-sm text-gray-400">Submitted: {new Date(application?.created_at || '').toLocaleDateString()}</p>
                                <p className="text-sm text-gray-400">ISP: {application?.isp}</p>
                            </div>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div className="bg-blue-500/10 border border-blue-500/20 text-blue-400 p-4 rounded-lg mb-6">
                                <h3 className="font-semibold mb-1">Why become a provider?</h3>
                                <ul className="list-disc list-inside text-sm opacity-90">
                                    <li>Earn passive income by sharing your bandwidth</li>
                                    <li>Get paid in GHS directly to your wallet</li>
                                    <li>Detailed analytics and control over your node</li>
                                </ul>
                            </div>

                            {error && (
                                <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg">
                                    {error}
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>
                                    Internet Service Provider (ISP)
                                </label>
                                <input
                                    type="text"
                                    required
                                    className="input w-full"
                                    placeholder="e.g. MTN Fiber, Vodafone"
                                    value={formData.isp}
                                    onChange={e => setFormData({ ...formData, isp: e.target.value })}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>
                                    Location
                                </label>
                                <input
                                    type="text"
                                    required
                                    className="input w-full"
                                    placeholder="e.g. Accra, Osu"
                                    value={formData.location}
                                    onChange={e => setFormData({ ...formData, location: e.target.value })}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>
                                    Bandwidth Speed
                                </label>
                                <select
                                    className="input w-full"
                                    value={formData.bandwidth}
                                    onChange={e => setFormData({ ...formData, bandwidth: e.target.value })}
                                >
                                    <option value="10 Mbps">10 Mbps</option>
                                    <option value="50 Mbps">50 Mbps</option>
                                    <option value="100 Mbps">100 Mbps</option>
                                    <option value="1 Gbps">1 Gbps Fiber</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>
                                    Why do you want to join?
                                </label>
                                <textarea
                                    required
                                    className="input w-full min-h-[100px]"
                                    placeholder="Tell us about your setup..."
                                    value={formData.reason}
                                    onChange={e => setFormData({ ...formData, reason: e.target.value })}
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={submitting}
                                className="btn btn-primary w-full py-3"
                            >
                                {submitting ? 'Submitting...' : 'Submit Application'}
                            </button>
                        </form>
                    )}
                </div>
            </main>
        </div>
    );
}
