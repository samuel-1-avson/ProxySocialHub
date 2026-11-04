'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { QRCodeSVG } from 'qrcode.react';
import {
    Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, Check, Copy,
    ExternalLink, KeyRound, RefreshCw, ShieldCheck, Wallet,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { getConnection, shopSolanaCluster } from '@/lib/solana';
import { getSolscanAccountUrl } from '@/lib/solscan';
import { getWalletTransactionsPage } from '@/lib/api/wallet';
import { Modal } from '@/components/patterns/Modal';
import type { WorkspaceMode } from '@/lib/store/workspace-store';

const formatSOL = (value: number) => new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 9,
}).format(value);

/** Public wallet information only. Signing keys stay on the server. */
export function ManagedWalletCard({ workspace = 'buyer' }: { workspace?: WorkspaceMode }) {
    const { user } = useAuth();
    const address = user?.managed_wallet?.address;
    const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
    const [copyError, setCopyError] = useState('');
    const [receiveOpen, setReceiveOpen] = useState(false);
    const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const receiveTrigger = useRef<HTMLButtonElement>(null);
    const network = shopSolanaCluster();
    const networkLabel = network === 'mainnet-beta' ? 'Mainnet' : network === 'testnet' ? 'Testnet' : 'Devnet';
    const testFunds = network !== 'mainnet-beta';
    const copied = copiedAddress === address;
    const balance = useQuery({
        queryKey: ['managed-wallet-balance', user?.id, address, network],
        queryFn: async () => getConnection().getBalance(new PublicKey(address!), 'confirmed'),
        enabled: Boolean(address),
        staleTime: 30_000,
        refetchInterval: 30_000,
        retry: 1,
    });
    const activity = useQuery({
        queryKey: ['wallet', 'recent-activity', user?.id],
        queryFn: () => getWalletTransactionsPage(undefined, 3),
        enabled: Boolean(address),
        staleTime: 30_000,
        refetchInterval: 30_000,
        retry: 1,
    });

    useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

    if (!address) return null;

    async function copy() {
        setCopyError('');
        try {
            await navigator.clipboard.writeText(address!);
            setCopiedAddress(address!);
            if (copyTimer.current) clearTimeout(copyTimer.current);
            copyTimer.current = setTimeout(() => setCopiedAddress(null), 2500);
        } catch {
            setCopyError('Copy is unavailable. Select and copy the address below.');
        }
    }

    return (
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]" data-testid="managed-wallet-overview">
            <div className="min-w-0 space-y-5">
                <section className="relative overflow-hidden rounded-2xl border border-primary/25 bg-card" aria-labelledby="managed-wallet-title">
                    <div className="h-1 bg-primary" aria-hidden="true" />
                    <div className="relative p-5 sm:p-7">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="flex min-w-0 items-center gap-3">
                                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary"><Wallet size={21} aria-hidden="true" /></span>
                                <div>
                                    <h2 id="managed-wallet-title" className="text-lg font-semibold tracking-tight">Your ProxyHubb wallet</h2>
                                    <p className="mt-1 text-xs text-muted-foreground">Created with your Google account</p>
                                </div>
                            </div>
                            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider"><span className="h-1.5 w-1.5 rounded-full bg-primary" />Solana {networkLabel}</span>
                        </div>

                        <div className="relative my-8 sm:my-10">
                            <div className="flex items-center gap-3">
                                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{balance.isError && balance.data !== undefined ? 'Last known balance' : 'Wallet balance'}</p>
                                <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50" aria-label="Refresh wallet balance" disabled={balance.isFetching} onClick={() => { void balance.refetch(); void activity.refetch(); }}>
                                    <RefreshCw size={14} className={balance.isFetching ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden="true" />
                                </button>
                            </div>
                            {balance.isPending ? (
                                <div role="status" className="mt-3 h-14 w-48 animate-pulse rounded-lg bg-secondary motion-reduce:animate-none"><span className="sr-only">Loading wallet balance…</span></div>
                            ) : (
                                <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1" data-testid="managed-wallet-balance">
                                    <span className="break-all text-4xl font-semibold tabular-nums tracking-[-0.05em] sm:text-5xl">{balance.data !== undefined ? formatSOL(balance.data / LAMPORTS_PER_SOL) : '—'}</span>
                                    <span className="font-mono text-xl text-muted-foreground">SOL</span>
                                </div>
                            )}
                            <p className="mt-3 text-xs text-muted-foreground">{testFunds ? 'Test funds on Solana ' + networkLabel + '. No real-world value.' : 'On-chain SOL held in your managed wallet.'}</p>
                            {balance.isError && <p role="alert" className="mt-3 text-xs text-warning">Balance could not be refreshed. <button type="button" className="underline underline-offset-4" onClick={() => void balance.refetch()}>Try again</button></p>}
                        </div>

                        <div className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap">
                            <button ref={receiveTrigger} type="button" className="ui-button min-h-11 gap-2" onClick={() => setReceiveOpen(true)}><ArrowDownLeft size={16} aria-hidden="true" />Receive SOL</button>
                            <Link className="ui-button secondary min-h-11 gap-2" href="/app/wallet?tab=history"><Activity size={16} aria-hidden="true" />View activity</Link>
                        </div>
                    </div>

                    <div className="border-t border-border bg-background/40 p-5 sm:px-7">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Wallet address</span>
                            <button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-lg px-2 text-xs text-primary transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary" onClick={() => void copy()}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? 'Copied' : 'Copy address'}</button>
                        </div>
                        <code className="block select-all break-all font-mono text-xs leading-6 text-foreground/85">{address}</code>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                            <a href={getSolscanAccountUrl(address)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1.5 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">View on Solscan<ExternalLink size={12} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a>
                            {balance.dataUpdatedAt > 0 && <span className="text-muted-foreground">Updated {new Date(balance.dataUpdatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>}
                        </div>
                        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">{copyError || (copied ? 'Address copied to clipboard.' : '')}</p>
                    </div>
                </section>

                <section className="overflow-hidden rounded-2xl border border-border bg-card" aria-labelledby="managed-activity-title">
                    <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-5 sm:px-6">
                        <h2 id="managed-activity-title" className="text-sm font-semibold">Recent account activity</h2>
                        <Link href="/app/wallet?tab=history" className="inline-flex min-h-8 items-center gap-1 text-xs text-primary">View all<ArrowRight size={13} aria-hidden="true" /></Link>
                    </div>
                    {activity.isPending ? <div className="space-y-3 p-6" role="status"><span className="sr-only">Loading recent activity…</span>{[0, 1].map((n) => <div key={n} className="h-9 animate-pulse rounded bg-secondary motion-reduce:animate-none" />)}</div> : activity.isError ? <div className="p-6 text-sm text-muted-foreground" role="alert">Recent activity is unavailable. <button type="button" className="text-primary underline" onClick={() => void activity.refetch()}>Try again</button></div> : activity.data?.transactions.length ? (
                        <ul className="divide-y divide-border">
                            {activity.data.transactions.map((transaction) => <li key={transaction.id} className="flex items-center justify-between gap-3 px-5 py-4 sm:px-6">
                                <div className="min-w-0"><p className="truncate text-sm font-medium">{transaction.description || transaction.type}</p><p className="mt-1 text-xs capitalize text-muted-foreground">{new Date(transaction.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {transaction.status || 'Status not reported'}</p></div>
                                <span className="shrink-0 font-mono text-xs">{formatSOL(transaction.amount_lamports != null ? transaction.amount_lamports / LAMPORTS_PER_SOL : transaction.amount)} SOL</span>
                            </li>)}
                        </ul>
                    ) : <div className="flex items-start gap-3 px-5 py-7 sm:px-6"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"><Activity size={17} aria-hidden="true" /></span><div><p className="text-sm font-medium">Your activity starts here</p><p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">Purchases, refunds, and account transfers will appear here as you use ProxyHubb.</p></div></div>}
                    <p className="border-t border-border px-5 py-3 text-[11px] leading-5 text-muted-foreground sm:px-6">Account records are shown here. See Solscan for the wallet&apos;s full on-chain history.</p>
                </section>
            </div>

            <aside className="min-w-0 space-y-5" aria-label="About your managed wallet">
                <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                    <div className="mb-6 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"><ShieldCheck size={15} className="text-primary" aria-hidden="true" />Google-connected wallet</div>
                    <h2 className="text-xl font-semibold leading-tight tracking-tight">A wallet, without<br />the extra setup.</h2>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">Your Solana wallet is part of your ProxyHubb account. Sign in with Google to access it.</p>
                    <dl className="mt-6 divide-y divide-border">
                        <div className="py-4"><dt className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck size={15} className="text-primary" aria-hidden="true" />Managed by ProxyHubb</dt><dd className="mt-2 text-xs leading-5 text-muted-foreground">ProxyHubb holds the signing keys and signs transactions for your account.</dd></div>
                        <div className="py-4"><dt className="flex items-center gap-2 text-xs font-semibold"><KeyRound size={15} className="text-primary" aria-hidden="true" />No extension to connect</dt><dd className="mt-2 text-xs leading-5 text-muted-foreground">You don&apos;t need a separate wallet app or a seed phrase to get started.</dd></div>
                        <div className="py-4"><dt className="flex items-center gap-2 text-xs font-semibold"><ArrowDownLeft size={15} className="text-primary" aria-hidden="true" />Unused funds come back</dt><dd className="mt-2 text-xs leading-5 text-muted-foreground">Funds returned from settled orders stay in this wallet for future purchases.</dd></div>
                    </dl>
                    <Link href="/app/settings?tab=security" className="mt-2 inline-flex min-h-10 items-center gap-2 text-xs font-medium text-primary">Account security<ArrowUpRight size={14} aria-hidden="true" /></Link>
                </section>
                <section className="rounded-2xl border border-primary/15 bg-primary/5 p-5 sm:p-6">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{workspace === 'seller' ? 'Your earnings' : 'Put your wallet to work'}</p>
                    <h2 className="mt-3 text-base font-semibold">{workspace === 'seller' ? 'Keep track of every payout.' : 'Your next connection starts here.'}</h2>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">{workspace === 'seller' ? 'Review provider earnings and settlement records in your seller workspace.' : 'Explore available proxy capacity and review the payment details before placing an order.'}</p>
                    <Link className="mt-4 inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-primary" href={workspace === 'seller' ? '/provider/earnings' : '/marketplace'}>{workspace === 'seller' ? 'View earnings' : 'Browse proxies'}<ArrowRight size={14} aria-hidden="true" /></Link>
                </section>
            </aside>

            <Modal open={receiveOpen} onOpenChange={setReceiveOpen} title="Receive SOL" description={`Your ProxyHubb wallet on Solana ${networkLabel}.`} returnFocusRef={receiveTrigger} size="sm">
                <div className="flex flex-col items-center gap-5">
                    <div className="rounded-2xl border border-border bg-white p-4"><QRCodeSVG value={address} size={184} level="M" title="Your Solana wallet address" /></div>
                    <div className="w-full rounded-xl border border-border bg-secondary/40 p-4"><p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Solana {networkLabel} address</p><code className="block select-all break-all text-xs leading-6">{address}</code></div>
                    <button type="button" className="ui-button min-h-11 w-full gap-2" onClick={() => void copy()}>{copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copied ? 'Copied' : 'Copy wallet address'}</button>
                    <p className="text-center text-xs leading-5 text-muted-foreground">{testFunds ? `Only send ${networkLabel.toLowerCase()} SOL to this address. Do not send mainnet SOL or real funds.` : 'Only send SOL on the Solana network to this address.'}</p>
                    <p role="status" aria-live="polite" className="text-center text-xs text-muted-foreground">{copyError || (copied ? 'Address copied to clipboard.' : '')}</p>
                </div>
            </Modal>
        </div>
    );
}
