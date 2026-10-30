'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, CheckCircle2, Loader2, Smartphone, AlertCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api/client';
import { getErrorMessage } from '@/lib/utils';
import {
    CASHOUT_DONE,
    MOMO_NETWORKS,
    confirmCashout,
    getCashout,
    getCashoutOverview,
    quoteCashout,
    setCashoutDestination,
    type CashoutQuote,
    type CashoutResult,
    type CashoutStatus,
    type MomoNetwork,
} from '@/lib/api/cashout';
import { Modal } from '@/components/patterns/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';

const PROVIDER_ROLES = ['provider', 'admin', 'superadmin', 'moderator', 'both'];

const STATUS_LABEL: Record<CashoutStatus, string> = {
    quoted: 'Quote',
    confirmed: 'Starting',
    sweeping: 'Moving funds',
    swept: 'Sending',
    transferring: 'Sending to MoMo',
    completed: 'Sent',
    refunding: 'Returning funds',
    refunded: 'Returned to wallet',
    expired: 'Expired',
    failed: 'Failed',
};

function networkLabel(code: string) {
    return MOMO_NETWORKS.find((n) => n.code === code)?.label ?? code;
}

const ghs = (n: number) => `GH₵${n.toFixed(2)}`;

/**
 * Cash out earnings to Mobile Money, for providers whose wallet ProxyHubb holds
 * (Google sign-up). The server moves the SOL and pays cedis through Paystack.
 */
export function CashOutCard() {
    const { user } = useAuth();
    const qc = useQueryClient();
    const visible = !!user?.managed_wallet?.address && PROVIDER_ROLES.includes(user?.role ?? '');

    const overview = useQuery({
        queryKey: ['cashout-overview'],
        queryFn: getCashoutOverview,
        enabled: visible,
        retry: false,
        staleTime: 30_000,
    });

    const [editing, setEditing] = useState(false);
    // Read the clock once per mount; the card reloads when the number changes.
    const [mountedAt] = useState(() => Date.now());
    const [network, setNetwork] = useState<MomoNetwork>('MTN');
    const [phone, setPhone] = useState('');
    const [name, setName] = useState('');
    const [amount, setAmount] = useState('');
    const [quote, setQuote] = useState<CashoutQuote | null>(null);
    const [result, setResult] = useState<CashoutResult | null>(null);
    const [error, setError] = useState('');

    const saveDestination = useMutation({
        mutationFn: () => setCashoutDestination({ network, phone, account_name: name }),
        onSuccess: async () => {
            setEditing(false);
            setError('');
            await qc.invalidateQueries({ queryKey: ['cashout-overview'] });
        },
        onError: (err) => setError(getErrorMessage(err)),
    });

    const getQuote = useMutation({
        mutationFn: () => quoteCashout(Number(amount)),
        onSuccess: (q) => {
            setError('');
            setResult(null);
            setQuote(q);
        },
        onError: (err) => setError(getErrorMessage(err)),
    });

    if (!visible) return null;
    // Feature off on this server: show nothing rather than an error.
    if (overview.error instanceof ApiError && overview.error.status === 503) return null;

    const data = overview.data;
    const dest = data?.destination;
    const showForm = editing || (!overview.isLoading && !dest);
    const destReady = dest ? new Date(dest.ready_at).getTime() <= mountedAt : false;

    async function onGoogleConfirmed(credential: string) {
        if (!quote) return;
        setError('');
        try {
            let res = await confirmCashout(quote.id, credential);
            setResult(res);
            const deadline = Date.now() + 180_000;
            while (!CASHOUT_DONE.includes(res.status) && Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, 4000));
                res = await getCashout(quote.id);
                setResult(res);
            }
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            void qc.invalidateQueries({ queryKey: ['cashout-overview'] });
        }
    }

    function closeModal() {
        setQuote(null);
        setResult(null);
        setError('');
    }

    const working = !!result && !CASHOUT_DONE.includes(result.status);

    return (
        <div className="rounded-lg border border-success/20 bg-success/5 p-5 space-y-4">
            <div className="flex items-center gap-3">
                <div className="w-9 h-9 shrink-0 rounded-lg bg-success/10 border border-success/20 flex items-center justify-center">
                    <ArrowDownToLine size={16} className="text-success" />
                </div>
                <div>
                    <p className="font-mono text-xs font-semibold text-success">
                        Cash out to Mobile Money
                    </p>
                    <p className="text-sm">
                        {overview.isLoading ? (
                            <Loader2 size={14} className="inline animate-spin" />
                        ) : data?.spendable_ghs_estimate != null ? (
                            <>Available: about <span className="font-mono">{ghs(data.spendable_ghs_estimate)}</span></>
                        ) : (
                            'Your earnings, paid in cedis'
                        )}
                    </p>
                </div>
            </div>

            {showForm ? (
                <div className="grid gap-2 sm:grid-cols-3">
                    <select
                        aria-label="Mobile Money network"
                        value={network}
                        onChange={(e) => setNetwork(e.target.value as MomoNetwork)}
                        className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
                    >
                        {MOMO_NETWORKS.map((n) => (
                            <option key={n.code} value={n.code}>{n.label}</option>
                        ))}
                    </select>
                    <Input
                        aria-label="Mobile Money number"
                        inputMode="tel"
                        placeholder="024 123 4567"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                    />
                    <Input
                        aria-label="Name on the account"
                        placeholder="Name on the account"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                    <div className="sm:col-span-3 flex gap-2">
                        <Button
                            type="button"
                            onClick={() => saveDestination.mutate()}
                            disabled={!phone || !name || saveDestination.isPending}
                            isLoading={saveDestination.isPending}
                        >
                            Save number
                        </Button>
                        {dest && (
                            <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                                Cancel
                            </Button>
                        )}
                    </div>
                    {dest && (
                        <p className="sm:col-span-3 text-xs text-muted-foreground">
                            For your safety, a new number can receive cash-outs 24 hours after you change it.
                        </p>
                    )}
                </div>
            ) : dest ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="inline-flex items-center gap-2">
                        <Smartphone size={14} className="text-muted-foreground" />
                        {networkLabel(dest.network)} ···{dest.phone_last4} · {dest.name}
                    </span>
                    <button type="button" onClick={() => setEditing(true)} className="text-xs underline text-muted-foreground">
                        Change
                    </button>
                    {!destReady && (
                        <p className="w-full text-xs text-warning">
                            New number: cash-outs open {new Date(dest.ready_at).toLocaleString()}.
                        </p>
                    )}
                </div>
            ) : null}

            {dest && !showForm && (
                <div className="flex gap-2">
                    <Input
                        aria-label="Amount in cedis"
                        inputMode="decimal"
                        placeholder={`Amount in GH₵ (min ${data?.limits.min_ghs ?? 5})`}
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                    />
                    <Button
                        type="button"
                        onClick={() => getQuote.mutate()}
                        disabled={!destReady || !(Number(amount) > 0) || getQuote.isPending}
                        isLoading={getQuote.isPending}
                    >
                        Cash out
                    </Button>
                </div>
            )}

            {error && !quote && (
                <p role="alert" className="flex items-center gap-2 text-xs text-warning">
                    <AlertCircle size={14} /> {error}
                </p>
            )}

            {!!data?.recent?.length && (
                <ul className="space-y-1 text-xs">
                    {data.recent.slice(0, 5).map((r) => (
                        <li key={r.id} className="flex justify-between text-muted-foreground">
                            <span>{new Date(r.created_at).toLocaleDateString()} · {ghs(r.amount_minor / 100)}</span>
                            <span className={r.status === 'completed' ? 'text-success' : r.status === 'failed' ? 'text-warning' : ''}>
                                {STATUS_LABEL[r.status]}
                            </span>
                        </li>
                    ))}
                </ul>
            )}

            {quote && (
                <Modal
                    open
                    onOpenChange={(open) => {
                        if (!open && !working) closeModal();
                    }}
                    title="Confirm cash-out"
                    description={`To ${networkLabel(quote.network)} ···${quote.phone_last4}`}
                    footer={
                        result && CASHOUT_DONE.includes(result.status) ? (
                            <Button type="button" className="w-full" onClick={closeModal}>Done</Button>
                        ) : null
                    }
                >
                    <div className="space-y-4 text-sm">
                        <div className="rounded-lg border border-border p-3 space-y-1 font-mono">
                            <div className="flex justify-between"><span>You receive</span><span>{ghs(quote.amount_ghs)}</span></div>
                            <div className="flex justify-between text-muted-foreground"><span>Fee</span><span>{ghs(quote.fee_ghs)}</span></div>
                            <div className="flex justify-between text-muted-foreground"><span>From your wallet</span><span>{quote.sol.toFixed(6)} SOL</span></div>
                        </div>

                        {!result ? (
                            <>
                                <p className="text-xs text-muted-foreground">
                                    To keep your earnings safe, confirm it&apos;s you with the Google account you signed up with.
                                </p>
                                <GoogleSignInButton text="continue_with" onCredential={onGoogleConfirmed} />
                            </>
                        ) : (
                            <div className="flex items-center gap-2">
                                {working ? (
                                    <Loader2 size={16} className="animate-spin" />
                                ) : result.status === 'completed' ? (
                                    <CheckCircle2 size={16} className="text-success" />
                                ) : (
                                    <AlertCircle size={16} className="text-warning" />
                                )}
                                <span>{result.message}</span>
                            </div>
                        )}
                        {error && (
                            <p role="alert" className="text-xs text-warning">{error}</p>
                        )}
                        {result && (
                            <p className="text-xs text-muted-foreground font-mono">Reference: {result.reference}</p>
                        )}
                    </div>
                </Modal>
            )}
        </div>
    );
}
