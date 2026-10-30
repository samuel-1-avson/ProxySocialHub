'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, ShieldCheck } from 'lucide-react';
import { PublicKey } from '@solana/web3.js';
import { useAuth } from '@/lib/auth';
import { getConnection } from '@/lib/solana';

/**
 * Shown to users whose Solana wallet ProxyHubb created and holds for them
 * (Google sign-up). Public address only; no key material ever reaches the browser.
 */
export function ManagedWalletCard() {
    const { user } = useAuth();
    const [copied, setCopied] = useState(false);
    const [balanceSOL, setBalanceSOL] = useState<number | null>(null);
    const wallet = user?.managed_wallet;
    const address = wallet?.address;

    // Leftover SOL from settled escrows lands here and pays for the next order.
    useEffect(() => {
        if (!address) return;
        let cancelled = false;
        getConnection()
            .getBalance(new PublicKey(address))
            .then((lamports) => {
                if (!cancelled) setBalanceSOL(lamports / 1e9);
            })
            .catch(() => {
                // RPC unavailable: the card still shows the address.
            });
        return () => {
            cancelled = true;
        };
    }, [address]);

    if (!wallet?.address) return null;

    async function copy() {
        try {
            await navigator.clipboard.writeText(wallet!.address);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard blocked; the address is still visible to copy by hand.
        }
    }

    return (
        <div className="rounded-lg border border-success/20 bg-success/5 p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3 min-w-0">
                <div className="w-9 h-9 shrink-0 rounded-lg bg-success/10 border border-success/20 flex items-center justify-center">
                    <ShieldCheck size={16} className="text-success" />
                </div>
                <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold text-success">
                        Your ProxyHubb wallet
                    </p>
                    <p className="font-mono text-sm break-all">{wallet.address}</p>
                    {balanceSOL !== null && (
                        <p className="mt-1 font-mono text-xs">
                            Balance: {balanceSOL.toFixed(6)} SOL
                        </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                        Created and secured for you when you signed up with Google. You don&apos;t need Phantom or a seed phrase.
                        Money left over from a purchase comes back here and pays for your next order.
                    </p>
                </div>
            </div>
            <button
                type="button"
                onClick={copy}
                className="flex items-center gap-1.5 self-start sm:self-center px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary text-xs font-mono"
            >
                {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy address'}
            </button>
        </div>
    );
}
