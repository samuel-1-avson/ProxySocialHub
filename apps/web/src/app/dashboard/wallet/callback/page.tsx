"use client";

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { verifyDeposit } from '@/lib/api';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

function CallbackContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
    const [message, setMessage] = useState('Verifying your payment...');

    useEffect(() => {
        const reference = searchParams.get('reference');

        if (!reference) {
            setStatus('error');
            setMessage('Invalid verification link. Missing reference.');
            return;
        }

        const verify = async () => {
            try {
                // Wait a moment for webhook/backend sync if needed, but usually frontend verification drives it here
                await verifyDeposit(reference);
                setStatus('success');
                setMessage('Payment verified successfully! Redirecting...');

                setTimeout(() => {
                    router.push('/dashboard/wallet');
                }, 2000);
            } catch (error: any) {
                console.error(error);
                setStatus('error');
                setMessage(error.message || 'Failed to verify payment. Please check your wallet history.');
                // Even on error, we might want to go back to wallet after a delay
                setTimeout(() => {
                    router.push('/dashboard/wallet');
                }, 4000);
            }
        };

        verify();
    }, [searchParams, router]);

    return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-6 text-center">
            {status === 'verifying' && (
                <>
                    <Loader2 className="w-12 h-12 animate-spin text-primary" />
                    <h2 className="text-xl font-mono uppercase tracking-widest">Processing Payment</h2>
                    <p className="text-muted-foreground font-mono">{message}</p>
                </>
            )}

            {status === 'success' && (
                <>
                    <div className="p-4 rounded-full bg-green-500/10 border border-green-500/20">
                        <CheckCircle2 className="w-12 h-12 text-green-500" />
                    </div>
                    <h2 className="text-xl font-mono uppercase tracking-widest text-green-500">Success</h2>
                    <p className="text-muted-foreground font-mono">{message}</p>
                </>
            )}

            {status === 'error' && (
                <>
                    <div className="p-4 rounded-full bg-destructive/10 border border-destructive/20">
                        <XCircle className="w-12 h-12 text-destructive" />
                    </div>
                    <h2 className="text-xl font-mono uppercase tracking-widest text-destructive">Verification Failed</h2>
                    <p className="text-muted-foreground font-mono max-w-md">{message}</p>
                </>
            )}
        </div>
    );
}

export default function WalletCallbackPage() {
    return (
        <div className="container mx-auto px-4 py-8">
            <div className="card-retro p-8 max-w-lg mx-auto bg-card">
                <Suspense fallback={<div className="flex justify-center"><Loader2 className="animate-spin" /></div>}>
                    <CallbackContent />
                </Suspense>
            </div>
        </div>
    );
}
