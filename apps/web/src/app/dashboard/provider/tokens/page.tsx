'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/glass-card';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Fingerprint, Plus, Trash2, Copy, CheckCircle2, Eye, EyeOff,
    Clock, Loader2, AlertTriangle, ShieldCheck, X
} from 'lucide-react';
import {
    getProviderTokens, createProviderToken, revokeProviderToken,
    type ProviderToken, type CreateTokenResponse,
} from '@/lib/api/provider';

export default function TokensPage() {
    const qc = useQueryClient();
    const [showCreate, setShowCreate] = useState(false);
    const [newToken, setNewToken] = useState<CreateTokenResponse | null>(null);
    const [copied, setCopied] = useState(false);
    const [name, setName] = useState('');
    const [expiresIn, setExpiresIn] = useState<number>(0);
    const [revealedId, setRevealedId] = useState<string | null>(null);

    const { data, isLoading } = useQuery({
        queryKey: ['provider-tokens'],
        queryFn: getProviderTokens,
    });

    const createMutation = useMutation({
        mutationFn: () => createProviderToken({ name, expires_in: expiresIn }),
        onSuccess: (res) => {
            setNewToken(res);
            setShowCreate(false);
            setName('');
            setExpiresIn(0);
            qc.invalidateQueries({ queryKey: ['provider-tokens'] });
        },
    });

    const revokeMutation = useMutation({
        mutationFn: revokeProviderToken,
        onSuccess: () => qc.invalidateQueries({ queryKey: ['provider-tokens'] }),
    });

    const tokens = data?.tokens ?? [];

    function copyToken(value: string) {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex flex-col gap-2 border-b border-border pb-6">
                <div className="flex items-center gap-2 text-primary font-mono text-xs font-bold uppercase tracking-widest">
                    <Fingerprint size={14} />
                    Authentication
                </div>
                <div className="flex items-center justify-between">
                    <h1 className="text-3xl font-bold font-mono uppercase tracking-tight">API Tokens</h1>
                    <button
                        onClick={() => setShowCreate(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl font-mono text-xs font-bold uppercase tracking-wider hover:bg-primary/90 transition-colors"
                    >
                        <Plus size={14} />
                        New Token
                    </button>
                </div>
                <p className="text-muted-foreground font-mono text-xs max-w-lg">
                    TOKENS ARE USED BY THE PROVIDER CLI TO AUTHENTICATE WITH PROXYHUB.
                </p>
            </div>

            {/* Newly created token banner */}
            <AnimatePresence>
                {newToken && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5"
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-3">
                                <ShieldCheck size={20} className="text-emerald-400 mt-0.5 shrink-0" />
                                <div className="min-w-0">
                                    <p className="text-sm font-bold text-emerald-400 mb-1">
                                        Token created — copy it now
                                    </p>
                                    <p className="text-xs text-muted-foreground mb-3">
                                        This is the <strong>only time</strong> the raw token is shown. Store it securely.
                                    </p>
                                    <div className="flex items-center gap-2 bg-black/30 rounded-xl px-4 py-3 font-mono text-xs break-all">
                                        <span className="text-emerald-300 flex-1">{newToken.token}</span>
                                        <button
                                            onClick={() => copyToken(newToken.token)}
                                            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                            {copied ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Copy size={14} />}
                                        </button>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground mt-2 font-mono">
                                        Use with CLI: <code className="text-emerald-400">provider-cli config set api_key &lt;token&gt;</code>
                                    </p>
                                </div>
                            </div>
                            <button onClick={() => setNewToken(null)} className="text-muted-foreground hover:text-foreground">
                                <X size={16} />
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Create form */}
            <AnimatePresence>
                {showCreate && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                    >
                        <GlassCard hoverEffect={false}>
                            <h2 className="text-sm font-bold font-mono mb-4 flex items-center gap-2">
                                <Plus size={14} className="text-primary" />
                                Create New Token
                            </h2>
                            <div className="space-y-4">
                                <div>
                                    <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block mb-1.5">
                                        Token Name
                                    </label>
                                    <input
                                        type="text"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="e.g. home-server, vps-node-1"
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-primary/50 transition-colors"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block mb-1.5">
                                        Expiration
                                    </label>
                                    <select
                                        value={expiresIn}
                                        onChange={(e) => setExpiresIn(Number(e.target.value))}
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-primary/50 transition-colors"
                                    >
                                        <option value={0}>Never expires</option>
                                        <option value={30}>30 days</option>
                                        <option value={90}>90 days</option>
                                        <option value={365}>1 year</option>
                                    </select>
                                </div>
                                <div className="flex gap-3 pt-2">
                                    <button
                                        onClick={() => createMutation.mutate()}
                                        disabled={!name.trim() || createMutation.isPending}
                                        className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl font-mono text-xs font-bold uppercase disabled:opacity-50"
                                    >
                                        {createMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                                        Create Token
                                    </button>
                                    <button
                                        onClick={() => setShowCreate(false)}
                                        className="px-4 py-2 bg-white/10 rounded-xl font-mono text-xs font-bold uppercase hover:bg-white/15 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </GlassCard>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Token list */}
            {isLoading ? (
                <div className="flex items-center justify-center py-16">
                    <Loader2 className="animate-spin text-primary w-8 h-8" />
                </div>
            ) : tokens.length === 0 ? (
                <GlassCard hoverEffect={false}>
                    <div className="text-center py-10">
                        <Fingerprint className="mx-auto w-12 h-12 text-muted-foreground/20 mb-3" />
                        <p className="font-mono text-sm font-bold mb-1">No tokens yet</p>
                        <p className="font-mono text-xs text-muted-foreground">
                            Create a token to authenticate the provider CLI.
                        </p>
                    </div>
                </GlassCard>
            ) : (
                <div className="space-y-3">
                    {tokens.map((token, i) => (
                        <TokenRow
                            key={token.id}
                            token={token}
                            index={i}
                            revealed={revealedId === token.id}
                            onToggleReveal={() => setRevealedId(revealedId === token.id ? null : token.id)}
                            onRevoke={() => {
                                if (confirm(`Revoke token "${token.name}"? CLI nodes using it will lose access.`)) {
                                    revokeMutation.mutate(token.id);
                                }
                            }}
                            revoking={revokeMutation.isPending && revokeMutation.variables === token.id}
                        />
                    ))}
                </div>
            )}

            {/* Info box */}
            <GlassCard hoverEffect={false}>
                <div className="flex items-start gap-3">
                    <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
                    <div>
                        <p className="text-xs font-bold font-mono mb-1">Security reminder</p>
                        <p className="text-xs text-muted-foreground font-mono">
                            Each node should use its own unique token. Revoke tokens immediately if a node
                            is compromised or decommissioned. Tokens are stored encrypted — the raw value
                            is only shown once at creation.
                        </p>
                    </div>
                </div>
            </GlassCard>
        </div>
    );
}

function TokenRow({
    token, index, revealed, onToggleReveal, onRevoke, revoking,
}: {
    token: ProviderToken;
    index: number;
    revealed: boolean;
    onToggleReveal: () => void;
    onRevoke: () => void;
    revoking: boolean;
}) {
    const active = token.is_active;
    const expired = token.expires_at && new Date(token.expires_at) < new Date();

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.04, duration: 0.3 }}
            className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 hover:bg-white/[0.04] transition-colors"
        >
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${
                        active && !expired
                            ? 'bg-emerald-500/10 border-emerald-500/20'
                            : 'bg-red-500/10 border-red-500/20'
                    }`}>
                        <Fingerprint size={14} className={active && !expired ? 'text-emerald-400' : 'text-red-400'} />
                    </div>
                    <div className="min-w-0">
                        <p className="font-bold font-mono text-sm truncate">{token.name}</p>
                        <div className="flex items-center gap-3 mt-0.5">
                            <span className={`text-[9px] font-mono uppercase font-black px-2 py-0.5 rounded-full ${
                                expired
                                    ? 'bg-red-500/20 text-red-400'
                                    : active
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : 'bg-gray-500/20 text-gray-400'
                            }`}>
                                {expired ? 'Expired' : active ? 'Active' : 'Inactive'}
                            </span>
                            <span className="text-[9px] font-mono text-muted-foreground">
                                {token.masked}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="hidden sm:flex items-center gap-6 text-[10px] font-mono text-muted-foreground">
                    <div className="text-center">
                        <p className="text-white">{new Date(token.created_at).toLocaleDateString()}</p>
                        <p className="uppercase tracking-wider">Created</p>
                    </div>
                    <div className="text-center">
                        <p className="text-white">
                            {token.last_used
                                ? new Date(token.last_used).toLocaleDateString()
                                : 'Never'}
                        </p>
                        <p className="uppercase tracking-wider">Last Used</p>
                    </div>
                    {token.expires_at && (
                        <div className="text-center">
                            <p className={expired ? 'text-red-400' : 'text-white'}>
                                {new Date(token.expires_at).toLocaleDateString()}
                            </p>
                            <p className="uppercase tracking-wider">Expires</p>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={onToggleReveal}
                        title={revealed ? 'Hide' : 'Show masked token'}
                        className="p-2 rounded-lg hover:bg-white/10 transition-colors text-muted-foreground hover:text-foreground"
                    >
                        {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                        onClick={onRevoke}
                        disabled={revoking}
                        title="Revoke token"
                        className="p-2 rounded-lg hover:bg-red-500/10 transition-colors text-muted-foreground hover:text-red-400 disabled:opacity-50"
                    >
                        {revoking ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                </div>
            </div>

            <AnimatePresence>
                {revealed && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-3 pt-3 border-t border-white/5"
                    >
                        <div className="flex items-center gap-2 bg-black/20 rounded-xl px-4 py-2.5 font-mono text-xs text-muted-foreground">
                            <Clock size={10} />
                            <span>ID: {token.id}</span>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
