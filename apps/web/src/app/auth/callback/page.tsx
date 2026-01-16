'use client';

import { useEffect, useState, Suspense } from 'react'; // Added Suspense
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';

function AuthCallbackContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [error, setError] = useState('');

    useEffect(() => {
        const accessToken = searchParams.get('access_token');
        const refreshToken = searchParams.get('refresh_token');
        const expiresIn = searchParams.get('expires_in');
        const errorParam = searchParams.get('error');

        if (errorParam) {
            setError(decodeURIComponent(errorParam));
            setTimeout(() => router.push('/login'), 3000);
            return;
        }

        if (accessToken && refreshToken) {
            // Store tokens
            localStorage.setItem('proxyhubb_tokens', JSON.stringify({
                access_token: accessToken,
                refresh_token: refreshToken,
                expires_in: Number(expiresIn),
            }));

            router.push('/dashboard');
            router.refresh(); // Ensure components re-render with new auth state
        } else {
            setError('Invalid callback parameters');
            setTimeout(() => router.push('/login'), 3000);
        }
    }, [router, searchParams]);

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background px-4">
                <div className="bg-destructive/10 border border-destructive/30 text-destructive px-6 py-4 rounded-lg">
                    <p>Authentication Failed: {error}</p>
                    <p className="text-sm mt-2 opacity-75">Redirecting to login...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background px-4">
            <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-primary border-r-transparent mb-4"></div>
                <p className="text-muted">Completing authentication...</p>
            </div>
        </div>
    );
}

export default function AuthCallbackPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-background px-4">
                <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-primary border-r-transparent mb-4"></div>
                    <p className="text-muted">Loading...</p>
                </div>
            </div>
        }>
            <AuthCallbackContent />
        </Suspense>
    );
}
