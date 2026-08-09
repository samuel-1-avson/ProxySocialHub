'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/glass-card';
import { motion, AnimatePresence } from 'framer-motion';
import {
    CheckCircle2, ArrowRight, ArrowLeft, Server, Fingerprint,
    FileCode, Wifi, Loader2, AlertCircle, ChevronRight
} from 'lucide-react';
import {
    createProviderToken, createNode,
    type CreateTokenResponse,
} from '@/lib/api/provider';
import { ProviderNodeConnectPanel } from '@/components/provider/ProviderNodeConnectPanel';
import { saveProviderApiKey } from '@/lib/provider-config';
import Link from 'next/link';

const STEPS = [
    { id: 'welcome', title: 'Welcome', icon: Server },
    { id: 'token', title: 'API Token', icon: Fingerprint },
    { id: 'node', title: 'Register Node', icon: Wifi },
    { id: 'install', title: 'Install CLI', icon: FileCode },
    { id: 'done', title: 'Done', icon: CheckCircle2 },
];

export default function SetupPage() {
    const router = useRouter();
    const qc = useQueryClient();
    const [step, setStep] = useState(0);

    // Token state
    const [tokenName, setTokenName] = useState('my-node');
    const [createdToken, setCreatedToken] = useState<CreateTokenResponse | null>(null);

    // Node state
    const [nodeName, setNodeName] = useState('');
    const [nodeCountry, setNodeCountry] = useState('');
    const [nodeCity, setNodeCity] = useState('');
    const [nodeCreated, setNodeCreated] = useState(false);
    const [registeredNodeId, setRegisteredNodeId] = useState<string | null>(null);

    const tokenMutation = useMutation({
        mutationFn: () => createProviderToken({ name: tokenName }),
        onSuccess: (res) => {
            setCreatedToken(res);
            saveProviderApiKey(res.token);
            qc.invalidateQueries({ queryKey: ['provider-tokens'] });
            setStep(2);
        },
    });

    const nodeMutation = useMutation({
        mutationFn: async () => {
            const node = await createNode({
                name: nodeName,
                country: nodeCountry || undefined,
                city: nodeCity || undefined,
            });
            // Always mint a fresh token bound to this node so Install never needs hand-editing.
            const token = await createProviderToken({
                name: `${nodeName || 'node'}-cli`.slice(0, 100),
                node_id: node.id,
            });
            return { node, token };
        },
        onSuccess: ({ node, token }) => {
            setNodeCreated(true);
            setRegisteredNodeId(node.id);
            setCreatedToken(token);
            saveProviderApiKey(token.token, node.id);
            qc.invalidateQueries({ queryKey: ['my-nodes'] });
            qc.invalidateQueries({ queryKey: ['provider-tokens'] });
            setStep(3);
        },
    });

    function next() { setStep((s) => Math.min(s + 1, STEPS.length - 1)); }
    function prev() { setStep((s) => Math.max(s - 1, 0)); }

    return (
        <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex flex-col gap-2 border-b border-border pb-6">
                <div className="flex items-center gap-2 text-primary font-mono text-xs font-bold uppercase tracking-widest">
                    <Server size={14} />
                    Getting Started
                </div>
                <h1 className="text-3xl font-bold font-mono uppercase tracking-tight">Setup Wizard</h1>
                <p className="text-muted-foreground font-mono text-xs">
                    GET YOUR NODE UP AND RUNNING IN MINUTES.
                </p>
            </div>

            {/* Step indicator */}
            <div className="flex items-center gap-1">
                {STEPS.map((s, i) => {
                    const Icon = s.icon;
                    const done = i < step;
                    const active = i === step;
                    return (
                        <div key={s.id} className="flex items-center gap-1 flex-1">
                            <div className={`flex items-center justify-center w-8 h-8 rounded-xl border transition-all ${
                                done
                                    ? 'bg-primary border-primary text-primary-foreground'
                                    : active
                                    ? 'bg-primary/20 border-primary/50 text-primary'
                                    : 'bg-white/5 border-white/10 text-muted-foreground'
                            }`}>
                                {done ? <CheckCircle2 size={14} /> : <Icon size={13} />}
                            </div>
                            {i < STEPS.length - 1 && (
                                <div className={`h-0.5 flex-1 transition-colors ${done ? 'bg-primary' : 'bg-white/10'}`} />
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Step content */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={step}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.25 }}
                >
                    {step === 0 && <WelcomeStep onNext={next} />}
                    {step === 1 && (
                        <TokenStep
                            name={tokenName}
                            onNameChange={setTokenName}
                            onCreate={() => tokenMutation.mutate()}
                            loading={tokenMutation.isPending}
                            error={tokenMutation.error?.message}
                            onBack={prev}
                        />
                    )}
                    {step === 2 && (
                        <NodeStep
                            token={createdToken}
                            name={nodeName}
                            country={nodeCountry}
                            city={nodeCity}
                            onNameChange={setNodeName}
                            onCountryChange={setNodeCountry}
                            onCityChange={setNodeCity}
                            onRegister={() => nodeMutation.mutate()}
                            loading={nodeMutation.isPending}
                            error={nodeMutation.error?.message}
                            onBack={prev}
                        />
                    )}
                    {step === 3 && (
                        <InstallStep
                            token={createdToken}
                            nodeId={registeredNodeId}
                            onNext={next}
                            onBack={prev}
                        />
                    )}
                    {step === 4 && (
                        <DoneStep
                            nodeCreated={nodeCreated}
                            onFinish={() => router.push('/dashboard/provider')}
                        />
                    )}
                </motion.div>
            </AnimatePresence>
        </div>
    );
}

// ─────────────── Step 0: Welcome ───────────────
function WelcomeStep({ onNext }: { onNext: () => void }) {
    return (
        <GlassCard hoverEffect={false}>
            <div className="text-center py-4 space-y-6">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/20 flex items-center justify-center border border-primary/30">
                    <Server size={28} className="text-primary" />
                </div>
                <div>
                    <h2 className="text-xl font-bold font-mono mb-2">Welcome to ProxyHub Provider</h2>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                        This wizard will help you set up your node in 3 steps:
                    </p>
                </div>
                <div className="text-left space-y-3 max-w-xs mx-auto">
                    {[
                        { icon: Fingerprint, title: 'Create an API token', desc: 'For the CLI to authenticate' },
                        { icon: Wifi, title: 'Register your node', desc: 'Name and location' },
                        { icon: FileCode, title: 'Install the CLI', desc: 'Connect to the network' },
                    ].map(({ icon: Icon, title, desc }) => (
                        <div key={title} className="flex items-center gap-3 bg-white/5 rounded-xl p-3">
                            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                                <Icon size={14} className="text-primary" />
                            </div>
                            <div>
                                <p className="text-xs font-bold font-mono">{title}</p>
                                <p className="text-[10px] text-muted-foreground font-mono">{desc}</p>
                            </div>
                        </div>
                    ))}
                </div>
                <button
                    onClick={onNext}
                    className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-xl font-mono text-sm font-bold mx-auto hover:bg-primary/90 transition-colors"
                >
                    Get Started
                    <ArrowRight size={16} />
                </button>
            </div>
        </GlassCard>
    );
}

// ─────────────── Step 1: API Token ───────────────
function TokenStep({
    name, onNameChange, onCreate, loading, error, onBack,
}: {
    name: string;
    onNameChange: (v: string) => void;
    onCreate: () => void;
    loading: boolean;
    error?: string;
    onBack: () => void;
}) {
    return (
        <GlassCard hoverEffect={false}>
            <div className="space-y-5">
                <div>
                    <h2 className="text-lg font-bold font-mono mb-1">Create an API Token</h2>
                    <p className="text-xs text-muted-foreground font-mono">
                        The CLI uses this token to authenticate with ProxyHub. You can create multiple tokens — one per node is recommended.
                    </p>
                </div>
                <div>
                    <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block mb-1.5">
                        Token Name
                    </label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => onNameChange(e.target.value)}
                        placeholder="e.g. home-server, vps-1"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-primary/50 transition-colors"
                    />
                </div>
                {error && (
                    <div className="flex items-center gap-2 text-red-400 text-xs font-mono">
                        <AlertCircle size={12} />
                        {error}
                    </div>
                )}
                <div className="flex items-center justify-between gap-3">
                    <button onClick={onBack} className="flex items-center gap-1 text-muted-foreground hover:text-foreground font-mono text-xs">
                        <ArrowLeft size={12} /> Back
                    </button>
                    <button
                        onClick={onCreate}
                        disabled={!name.trim() || loading}
                        className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl font-mono text-xs font-bold disabled:opacity-50"
                    >
                        {loading ? <Loader2 size={12} className="animate-spin" /> : null}
                        Create Token
                        <ArrowRight size={12} />
                    </button>
                </div>
            </div>
        </GlassCard>
    );
}

// ─────────────── Step 2: Node Registration ───────────────
function NodeStep({
    token, name, country, city,
    onNameChange, onCountryChange, onCityChange,
    onRegister, loading, error, onBack,
}: {
    token: CreateTokenResponse | null;
    name: string;
    country: string;
    city: string;
    onNameChange: (v: string) => void;
    onCountryChange: (v: string) => void;
    onCityChange: (v: string) => void;
    onRegister: () => void;
    loading: boolean;
    error?: string;
    onBack: () => void;
}) {
    return (
        <GlassCard hoverEffect={false}>
            <div className="space-y-5">
                <div>
                    <h2 className="text-lg font-bold font-mono mb-1">Register Your Node</h2>
                    <p className="text-xs text-muted-foreground font-mono">
                        Give your node a name so you can identify it in the dashboard. Location is optional but improves routing.
                    </p>
                </div>

                {token && (
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">
                        <p className="text-[10px] font-mono text-emerald-400 mb-1 font-bold uppercase">Token created</p>
                        <p className="text-xs font-mono text-emerald-300/80">
                            Save <strong>{token.name}</strong> — you'll need it for the CLI config.
                        </p>
                    </div>
                )}

                <div className="space-y-3">
                    <div>
                        <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block mb-1.5">
                            Node Name *
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => onNameChange(e.target.value)}
                            placeholder="e.g. home-server, us-east-vps"
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-primary/50 transition-colors"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block mb-1.5">
                                Country (optional)
                            </label>
                            <input
                                type="text"
                                value={country}
                                onChange={(e) => onCountryChange(e.target.value)}
                                placeholder="US"
                                maxLength={2}
                                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-primary/50 transition-colors uppercase"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block mb-1.5">
                                City (optional)
                            </label>
                            <input
                                type="text"
                                value={city}
                                onChange={(e) => onCityChange(e.target.value)}
                                placeholder="New York"
                                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-primary/50 transition-colors"
                            />
                        </div>
                    </div>
                </div>

                {error && (
                    <div className="flex items-center gap-2 text-red-400 text-xs font-mono">
                        <AlertCircle size={12} />
                        {error}
                    </div>
                )}

                <div className="flex items-center justify-between gap-3">
                    <button onClick={onBack} className="flex items-center gap-1 text-muted-foreground hover:text-foreground font-mono text-xs">
                        <ArrowLeft size={12} /> Back
                    </button>
                    <button
                        onClick={onRegister}
                        disabled={!name.trim() || loading}
                        className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl font-mono text-xs font-bold disabled:opacity-50"
                    >
                        {loading ? <Loader2 size={12} className="animate-spin" /> : null}
                        Register Node
                        <ArrowRight size={12} />
                    </button>
                </div>
            </div>
        </GlassCard>
    );
}

// ─────────────── Step 3: Install CLI ───────────────
function InstallStep({
    token, nodeId, onNext, onBack,
}: {
    token: CreateTokenResponse | null;
    nodeId: string | null;
    onNext: () => void;
    onBack: () => void;
}) {
    return (
        <GlassCard hoverEffect={false}>
            <div className="space-y-5">
                <div>
                    <h2 className="text-lg font-bold font-mono mb-1">Install &amp; start</h2>
                    <p className="text-xs text-muted-foreground font-mono">
                        Download the CLI once, paste the install script (writes config for you), then start. No editing{' '}
                        <code className="text-primary/80">provider.toml</code> by hand.
                    </p>
                </div>

                <div className="space-y-3">
                    <div className="flex gap-3">
                        <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center font-mono text-xs font-black shrink-0 mt-0.5">
                            1
                        </div>
                        <div className="flex-1">
                            <p className="text-xs font-bold font-mono mb-1">Download the CLI</p>
                            <Link
                                href="/dashboard/provider/cli"
                                className="text-xs text-primary font-mono hover:underline flex items-center gap-1"
                            >
                                Go to CLI & Tools page <ChevronRight size={10} />
                            </Link>
                        </div>
                    </div>

                    {nodeId ? (
                        <div className="flex gap-3">
                            <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center font-mono text-xs font-black shrink-0 mt-0.5">
                                2
                            </div>
                            <div className="flex-1">
                                <p className="text-xs font-bold font-mono mb-2">Install config &amp; run</p>
                                <ProviderNodeConnectPanel
                                    nodeId={nodeId}
                                    apiKey={token?.token ?? null}
                                />
                            </div>
                        </div>
                    ) : (
                        <p className="text-[10px] font-mono text-amber-400/90 px-9">
                            Register a node in the previous step to generate a ready-to-run config.
                        </p>
                    )}
                </div>

                <div className="flex items-center justify-between gap-3 pt-2">
                    <button onClick={onBack} className="flex items-center gap-1 text-muted-foreground hover:text-foreground font-mono text-xs">
                        <ArrowLeft size={12} /> Back
                    </button>
                    <button
                        onClick={onNext}
                        className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl font-mono text-xs font-bold"
                    >
                        Finish Setup
                        <ArrowRight size={12} />
                    </button>
                </div>
            </div>
        </GlassCard>
    );
}

// ─────────────── Step 4: Done ───────────────
function DoneStep({ nodeCreated, onFinish }: { nodeCreated: boolean; onFinish: () => void }) {
    return (
        <GlassCard hoverEffect={false}>
            <div className="text-center py-6 space-y-5">
                <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
                    <CheckCircle2 size={32} className="text-emerald-400" />
                </div>
                <div>
                    <h2 className="text-xl font-bold font-mono mb-2">You're all set!</h2>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                        {nodeCreated
                            ? 'Open Connect → Setup this PC (one click). It saves config, installs the app if needed, and starts your node.'
                            : 'Register a node, then use Connect → Setup this PC (one click).'}
                    </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <button
                        onClick={onFinish}
                        className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-xl font-mono text-sm font-bold hover:bg-primary/90 transition-colors"
                    >
                        Go to Dashboard
                        <ArrowRight size={14} />
                    </button>
                    <Link
                        href="/dashboard/provider/nodes"
                        className="flex items-center gap-2 px-6 py-3 bg-white/10 rounded-xl font-mono text-sm font-bold hover:bg-white/15 transition-colors"
                    >
                        View My Nodes
                    </Link>
                </div>
            </div>
        </GlassCard>
    );
}
