'use client';

import { useEffect, useState, Suspense } from 'react'; // Added Suspense
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';

function AuthCallbackContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { setAuth } = useAuth();
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
            // Function to complete login
            const completeLogin = async () => {
                try {
                    const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081';
                    console.log('Completing login with API URL:', API_BASE_URL);

                    // 1. Fetch user profile
                    const response = await fetch(`${API_BASE_URL}/v1/profile`, {
                        headers: {
                            'Authorization': `Bearer ${accessToken}`
                        }
                    });

                    if (!response.ok) {
                        throw new Error('Failed to fetch user profile');
                    }

                    const userProfile = await response.json();

                    // 2. Update Auth Context (stores in localStorage and updates state)
                    const tokens = {
                        access_token: accessToken,
                        refresh_token: refreshToken,
                        expires_in: Number(expiresIn),
                    };

                    const user = {
                        id: userProfile.id,
                        email: userProfile.email,
                        role: userProfile.role,
                        ...userProfile
                    };

                    setAuth(user, tokens);

                    // 3. Redirect
                    router.push('/dashboard');
                    router.refresh();
                } catch (err) {
                    console.error('Login completion failed:', err);
                    setError('Failed to setup session');
                    setTimeout(() => router.push('/login'), 3000);
                }
            };

            completeLogin();
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
