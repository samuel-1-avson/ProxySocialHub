'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function AuthCallbackPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const {
        // We can't access setSession/setUser directly from useAuth unless we expose them or a method for it.
        // However, the tokens are usually stored in localStorage by the auth provider.
        // In this case, we need to manually store them since the backend redirected us here with params.
    } = useAuth();

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

            // Force a reload or redirect to dashboard to trigger auth state update
            // Since useAuth reads from localStorage on mount, a full reload or router.push might be needed
            // Ideally useAuth should have a method to "loginWithTokens"

            // For now, let's redirect to dashboard which should pick up the tokens on mount
            // But verify user info might be missing in context until an API call happens.
            // We'll trust the token validation on the next protected call.

            // To get the user, we can call the /auth/me endpoint if it existed, or just let dashboard load fail if invalid.
            // But actually, the backend only sent tokens. We don't have user object here.
            // We should probably fetch the user profile.

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
