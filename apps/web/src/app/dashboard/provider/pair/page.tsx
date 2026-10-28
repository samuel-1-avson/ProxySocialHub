'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Laptop, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { ApiError } from '@/lib/api/client';
import {
    decideProviderPairing,
    lookupProviderPairing,
    normalizePairingCode,
    type PairingRequestInfo,
} from '@/lib/api/provider';

/**
 * Approve a computer that ran `provider-node pair`. The link the node prints carries the
 * code (?code=BCDF-GHJK); without it the owner can type the code shown on the computer.
 */
export default function PairDevicePage() {
    // useSearchParams needs a Suspense boundary for the static build.
    return (
        <Suspense fallback={null}>
            <PairDevice />
        </Suspense>
    );
}

const PLATFORM_LABELS: Record<string, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

function describeSystem(info: PairingRequestInfo): string {
    const os = PLATFORM_LABELS[info.platform] ?? (info.platform || 'Unknown system');
    return [os, info.arch, info.client_version && `provider-node ${info.client_version}`]
        .filter(Boolean)
        .join(' · ');
}

function askedAgo(createdAt: string): string {
    const seconds = Math.max(0, Math.round((Date.now() - new Date(createdAt).getTime()) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.round(seconds / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
}

function PairDevice() {
    const params = useSearchParams();
    const urlCode = normalizePairingCode(params.get('code'));
    const [typed, setTyped] = useState('');
    const [entered, setEntered] = useState<string | null>(null);
    const [typedError, setTypedError] = useState(false);
    const code = urlCode ?? entered;

    const lookup = useQuery({
        queryKey: ['provider-pairing', code],
        queryFn: () => lookupProviderPairing(code as string),
        enabled: code !== null,
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity,
    });

    const decide = useMutation({
        mutationFn: (decision: 'approve' | 'deny') => decideProviderPairing(code as string, decision),
    });

    const notFound = lookup.error instanceof ApiError && lookup.error.status === 404;
    const info = lookup.data;

    function submitTyped(event: React.FormEvent) {
        event.preventDefault();
        const normalized = normalizePairingCode(typed);
        setTypedError(normalized === null);
        if (normalized) setEntered(normalized);
    }

    return (
        <div className="mx-auto max-w-xl space-y-6 p-4 md:p-6">
            <header className="space-y-1">
                <h1 className="text-2xl font-bold">Connect a computer</h1>
                <p className="text-sm text-muted-foreground">
                    Approve the computer that is waiting to join your provider account.
                </p>
            </header>

            {code === null && (
                <GlassCard hoverEffect={false} className="p-5">
                    <form onSubmit={submitTyped} className="space-y-3">
                        <label htmlFor="pair-code" className="block text-sm font-medium">
                            Code shown on your computer
                        </label>
                        <input
                            id="pair-code"
                            value={typed}
                            onChange={(e) => setTyped(e.target.value)}
                            placeholder="BCDF-GHJK"
                            maxLength={12}
                            autoFocus
                            autoComplete="off"
                            spellCheck={false}
                            className="w-full rounded-xl border border-border bg-background px-4 py-3 font-mono text-lg uppercase tracking-widest"
                        />
                        {typedError && (
                            <p role="alert" className="text-sm text-amber-500">
                                That doesn&apos;t look like a code. Codes have 8 letters, like BCDF-GHJK.
                            </p>
                        )}
                        <button
                            type="submit"
                            className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                        >
                            Continue
                        </button>
                    </form>
                    <p className="mt-4 text-xs text-muted-foreground">
                        No code yet? On the computer you want to connect, open a terminal and run{' '}
                        <code className="font-mono">provider-node pair</code>.
                    </p>
                </GlassCard>
            )}

            {code !== null && lookup.isLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 size={16} className="animate-spin" /> Looking up {code}…
                </div>
            )}

            {code !== null && notFound && (
                <GlassCard hoverEffect={false} className="space-y-2 border-amber-500/30 bg-amber-500/5 p-5">
                    <div className="flex items-center gap-2 font-semibold">
                        <XCircle size={18} className="text-amber-500" /> We couldn&apos;t find that code
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Codes last 10 minutes and work once. It may have expired or already been used. On your
                        computer, run <code className="font-mono">provider-node pair</code> again to get a new one.
                    </p>
                    <Link href="/dashboard/provider/pair" className="text-sm font-medium text-primary hover:underline">
                        Enter a different code
                    </Link>
                </GlassCard>
            )}

            {code !== null && lookup.isError && !notFound && (
                <p role="alert" className="text-sm text-amber-500">
                    Something went wrong looking up that code. Please try again in a moment.
                </p>
            )}

            {info && !decide.isSuccess && (
                <GlassCard hoverEffect={false} className="space-y-5 p-5">
                    <div className="flex items-start gap-3">
                        <Laptop size={28} className="mt-0.5 shrink-0 text-primary" />
                        <div className="min-w-0">
                            <p className="truncate text-lg font-semibold">{info.device_name}</p>
                            <p className="text-sm text-muted-foreground">{describeSystem(info)}</p>
                            <p className="text-xs text-muted-foreground">Asked {askedAgo(info.created_at)}</p>
                        </div>
                    </div>

                    <div className="rounded-xl bg-muted/40 p-4 text-center">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            The code on that computer should read
                        </p>
                        <p className="mt-1 font-mono text-3xl font-bold tracking-widest">{info.user_code}</p>
                    </div>

                    <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-500" />
                        <p className="text-sm">
                            Only approve if you started this yourself, just now, on a computer you own, and the
                            code above matches what that computer shows. Approving lets it run as a node on your
                            account, and buyers&apos; internet traffic will leave through its connection.
                        </p>
                    </div>

                    {decide.isError && (
                        <p role="alert" className="text-sm text-amber-500">
                            {decide.error instanceof ApiError && decide.error.status === 404
                                ? 'This request has expired or was already handled. Run the command on your computer again.'
                                : 'Could not save your choice. Please try again.'}
                        </p>
                    )}

                    <div className="flex flex-wrap gap-3">
                        <button
                            type="button"
                            disabled={decide.isPending}
                            onClick={() => decide.mutate('approve')}
                            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                        >
                            {decide.isPending ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                            Approve this computer
                        </button>
                        <button
                            type="button"
                            disabled={decide.isPending}
                            onClick={() => decide.mutate('deny')}
                            className="rounded-xl border border-border px-5 py-2.5 text-sm font-semibold hover:bg-muted/40 disabled:opacity-60"
                        >
                            This isn&apos;t mine, deny
                        </button>
                    </div>
                </GlassCard>
            )}

            {decide.isSuccess && (
                <GlassCard
                    hoverEffect={false}
                    className={
                        decide.data.status === 'approved'
                            ? 'space-y-2 border-emerald-500/30 bg-emerald-500/5 p-5'
                            : 'space-y-2 p-5'
                    }
                >
                    {decide.data.status === 'approved' ? (
                        <>
                            <div className="flex items-center gap-2 font-semibold text-emerald-500">
                                <CheckCircle2 size={18} /> Approved
                            </div>
                            <p className="text-sm text-muted-foreground">
                                Your computer will finish setting itself up in a few seconds. There is nothing to
                                copy or paste, and you can close this page.
                            </p>
                            <Link href="/dashboard/provider/nodes" className="text-sm font-medium text-primary hover:underline">
                                See my nodes
                            </Link>
                        </>
                    ) : (
                        <>
                            <div className="flex items-center gap-2 font-semibold">
                                <XCircle size={18} /> Denied
                            </div>
                            <p className="text-sm text-muted-foreground">
                                That computer did not receive anything, and the code can no longer be used.
                            </p>
                        </>
                    )}
                </GlassCard>
            )}
        </div>
    );
}
