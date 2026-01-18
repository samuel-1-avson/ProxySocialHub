'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import Link from 'next/link';

function VerifyContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const { getAccessToken } = useAuth();
    const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
    const [message, setMessage] = useState('Verifying your transaction...');

    // Get reference from URL
    const reference = searchParams.get('reference') || searchParams.get('trxref'); // Paystack sends both sometimes

    useEffect(() => {
        if (!reference) {
            setStatus('error');
            setMessage('No transaction reference found in URL.');
            return;
        }

        const verifyTransaction = async () => {
            try {
                const token = await getAccessToken();
                if (!token) {
                    setStatus('error');
                    setMessage('You are not authenticated.');
                    return;
                }

                // Call our new backend endpoint
                const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081'}/v1/wallet/verify?reference=${reference}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                const data = await response.json();

                if (response.ok && data.status === 'success') {
                    setStatus('success');
                    setMessage('Deposit successful! Your wallet has been credited.');
                    // Auto redirect after 3 seconds
                    setTimeout(() => {
                        router.push('/dashboard/wallet');
                    }, 3000);
                } else {
                    setStatus('error');
                    setMessage(data.message || 'Verification failed. Please contact support.');
                }

            } catch (err: any) {
                console.error("Verification error:", err);
                setStatus('error');
                setMessage('Network error during verification. Please try refreshing.');
            }
        };

        verifyTransaction();
    }, [reference, getAccessToken]);

    return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 space-y-6 text-center">
            {status === 'verifying' && (
                <>
                    <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                    <h2 className="text-2xl font-bold">Verifying Payment...</h2>
                    <p className="text-muted-foreground">Please wait while we confirm your transaction with Paystack.</p>
                </>
            )}

            {status === 'success' && (
                <>
                    <div className="w-16 h-16 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center text-4xl mb-4">
                        ✓
                    </div>
                    <h2 className="text-2xl font-bold text-green-500">Deposit Successful!</h2>
                    <p className="text-muted-foreground">{message}</p>
                    <Link
                        href="/dashboard/wallet"
                        className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
                    >
                        Return to Wallet
                    </Link>
                </>
            )}

            {status === 'error' && (
                <>
                    <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center text-4xl mb-4">
                        ✕
                    </div>
                    <h2 className="text-2xl font-bold text-red-500">Verification Failed</h2>
                    <p className="text-muted-foreground">{message}</p>
                    <div className="flex gap-4">
                        <Link
                            href="/dashboard/wallet"
                            className="px-6 py-2 bg-card border border-input rounded-md hover:bg-accent transition-colors"
                        >
                            Return to Wallet
                        </Link>
                        {reference && (
                            <button
                                onClick={() => window.location.reload()}
                                className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
                            >
                                Try Again
                            </button>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

export default function PaymentCallbackPage() {
    return (
        <div className="container mx-auto max-w-2xl py-12">
            <div className="card bg-card border border-card-border p-6 rounded-xl shadow-lg">
                <Suspense fallback={<div>Loading...</div>}>
                    <VerifyContent />
                </Suspense>
            </div>
        </div>
    );
}
