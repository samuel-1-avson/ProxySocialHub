"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { XCircle } from 'lucide-react';

// W-35: fiat deposits are disabled (SOL-only platform). This legacy
// callback route only ever errored; it now explains and redirects.
export default function WalletCallbackPage() {
    const router = useRouter();
    useEffect(() => {
        const id = setTimeout(() => router.push('/dashboard/wallet'), 4000);
        return () => clearTimeout(id);
    }, [router]);

    return (
        <div className="container mx-auto px-4 py-8">
            <div className="card-retro p-8 max-w-lg mx-auto bg-card">
                <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-6 text-center">
                    <div className="p-4 rounded-full bg-destructive/10 border border-destructive/20">
                        <XCircle className="w-12 h-12 text-destructive" />
                    </div>
                    <h2 className="text-xl font-mono uppercase tracking-widest text-destructive">Fiat Deposits Disabled</h2>
                    <p className="text-muted-foreground font-mono max-w-md">
                        This platform is SOL-only. Deposit SOL from your linked wallet instead. Redirecting to your wallet...
                    </p>
                </div>
            </div>
        </div>
    );
}
