"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { ArrowRight, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { WalletConnectControl } from '@/components/WalletConnectControl';
import { classifySignInError, forceDisconnectSolanaWallet } from '@/lib/solana-wallet-session';
import { readAuthRedirectFromSearch } from '@/lib/navigation/safe-redirect';

interface WalletAuthPanelProps {
    actionLabel: string;
    idleMessage?: string;
    mode: 'login' | 'register';
}

export function WalletAuthPanel({ actionLabel, idleMessage, mode }: WalletAuthPanelProps) {
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { walletLogin } = useAuth();
    const { connected, publicKey, signMessage, disconnect, select } = useWallet();
    const router = useRouter();

    const handleWalletAuth = async () => {
        if (!publicKey || !signMessage) {
            return;
        }

        setLoading(true);
        setError('');

        try {
            await walletLogin(publicKey.toBase58(), { signMessage });
            // Middleware sends signed-out users to /login?next=<return path>;
            // honor it so a user headed for the wallet lands back there.
            const returnTo =
                readAuthRedirectFromSearch(window.location.search) || '/dashboard';
            router.push(returnTo);
            router.refresh();
        } catch (err: unknown) {
            const { message, resetWallet } = classifySignInError(err, `Wallet ${mode} failed`);
            setError(message);
            if (resetWallet) {
                // The app and the wallet extension disagree about the connection; start over.
                await forceDisconnectSolanaWallet({ disconnect, select });
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            {error && (
                <div className="flex items-center gap-3 bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-sm mb-6 text-sm font-mono">
                    <AlertCircle size={16} className="shrink-0" />
                    <p>{error}</p>
                </div>
            )}

            <div className="mb-6">
                <WalletConnectControl />
            </div>

            {connected && publicKey && (
                <button
                    type="button"
                    onClick={handleWalletAuth}
                    disabled={loading}
                    className="w-full btn-retro btn-retro-primary py-3 text-sm mb-6"
                >
                    {loading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                        <>
                            {actionLabel} ({publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)})
                            <ArrowRight size={16} className="ml-2" />
                        </>
                    )}
                </button>
            )}

            {!connected && idleMessage && (
                <p className="text-center text-muted-foreground text-xs font-mono mt-4">
                    {idleMessage}
                </p>
            )}
        </>
    );
}