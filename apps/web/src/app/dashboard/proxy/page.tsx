"use client";

import { useEffect, useState } from 'react';
import { createSession, getSessions, Session } from '@/lib/api';
import {
    Globe,
    Shield,
    Loader2,
    Copy,
    Terminal,
    Wifi,
    WifiOff,
    Server,
    Activity,
    Zap,
    CheckCircle,
    XCircle,
    ArrowRight,
    RefreshCw,
    Settings,
    ExternalLink,
    Lock,
    Hexagon,
    ChevronRight,
    Search,
    ShieldCheck
} from 'lucide-react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { GlassCard } from '@/components/ui/glass-card';

// Get proxy endpoint from environment or default
const PROXY_ENDPOINT = process.env.NEXT_PUBLIC_PROXY_ENDPOINT || 'proxy.proxyhub.io:3128';

export default function ProxyPage() {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [testing, setTesting] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'online' | 'offline'>('idle');
    const [copied, setCopied] = useState<string | null>(null);

    useEffect(() => {
        fetchSessions();
    }, []);

    async function fetchSessions() {
        try {
            const data = await getSessions();
            setSessions(data.filter(s => s.status === 'active'));
        } catch (error) {
            console.error('Failed to fetch sessions:', error);
        } finally {
            setLoading(false);
        }
    }

    async function handleQuickStart(type: 'rotating' | 'sticky') {
        setCreating(true);
        try {
            const result = await createSession({ type });
            await fetchSessions();
            // Auto-copy credentials
            if (result.proxy_credentials) {
                const curlCmd = `curl -x ${result.proxy_credentials.username}:${result.proxy_credentials.password}@${PROXY_ENDPOINT} https://httpbin.org/ip`;
                navigator.clipboard.writeText(curlCmd);
                setCopied('curl');
                setTimeout(() => setCopied(null), 3000);
            }
        } catch (error) {
            console.error('Failed to create session:', error);
        } finally {
            setCreating(false);
        }
    }

    async function testConnection() {
        setTesting(true);
        setConnectionStatus('testing');
        try {
            const response = await fetch('/api/proxy/test');
            if (response.ok) {
                setConnectionStatus('online');
            } else {
                setConnectionStatus('offline');
            }
        } catch {
            setConnectionStatus('offline');
        } finally {
            setTesting(false);
        }
    }

    function copyToClipboard(text: string, label: string) {
        navigator.clipboard.writeText(text);
        setCopied(label);
        setTimeout(() => setCopied(null), 3000);
    }

    const activeSession = sessions[0];

    const containerVariants = {
        hidden: { opacity: 0 },
        show: {
            opacity: 1,
            transition: { staggerChildren: 0.1 }
        }
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 20 },
        show: { opacity: 1, y: 0 }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-40 gap-6">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
                <p className="font-mono text-[10px] uppercase font-black tracking-[0.4em] text-muted-foreground animate-pulse">Initializing Proxy Core...</p>
            </div>
        );
    }

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="space-y-10 pb-20"
        >
            {/* Header */}
            <motion.div variants={itemVariants} className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 border-b border-white/5 pb-8">
                <div className="space-y-1">
                    <div className="flex items-center gap-2 text-primary font-mono text-[10px] font-black uppercase tracking-[0.3em]">
                        <Hexagon size={12} className="animate-spin-slow" /> Decentralized Access Activated
                    </div>
                    <h1 className="text-4xl font-black font-mono uppercase tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-primary to-emerald-400">
                        Proxy Gateway
                    </h1>
                    <p className="text-muted-foreground font-mono text-[11px] max-w-lg opacity-60 uppercase tracking-tight">
                        SECURE INTERFACE FOR DISTRIBUTED RESIDENTIAL PROXY NETWORKS.
                    </p>
                </div>

                <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={testConnection}
                    disabled={testing}
                    className="flex items-center gap-3 px-6 py-3 glass-card !rounded-2xl border border-primary/20 hover:border-primary/50 text-[10px] font-black font-mono uppercase tracking-widest transition-all text-primary"
                >
                    {testing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                    Scan Connection
                </motion.button>
            </motion.div>

            {/* Connection Telemetry */}
            <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Endpoint Card */}
                <GlassCard className="p-6 bg-white/2 border-white/5 group relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform">
                        <Terminal size={60} className="text-primary" />
                    </div>
                    <label className="text-[9px] font-mono font-black uppercase text-muted-foreground/40 mb-3 block tracking-[0.2em]">Gateway Endpoint</label>
                    <div className="flex items-center gap-3 bg-black/40 p-3 rounded-xl border border-white/5">
                        <code className="text-primary font-mono text-xs font-black flex-1 truncate">{PROXY_ENDPOINT}</code>
                        <button
                            onClick={() => copyToClipboard(PROXY_ENDPOINT, 'endpoint')}
                            className="w-8 h-8 flex items-center justify-center glass-card border-white/10 hover:border-primary/50 text-muted-foreground hover:text-primary transition-all rounded-lg"
                        >
                            {copied === 'endpoint' ? <CheckCircle size={14} className="text-emerald-500" /> : <Copy size={14} />}
                        </button>
                    </div>
                </GlassCard>

                {/* Status Card */}
                <GlassCard className="p-6 bg-white/2 border-white/5 relative overflow-hidden">
                    <label className="text-[9px] font-mono font-black uppercase text-muted-foreground/40 mb-3 block tracking-[0.2em]">Signal Integrity</label>
                    <div className="flex items-center gap-4 py-1.5">
                        {connectionStatus === 'online' && (
                            <>
                                <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                                    <Wifi className="text-emerald-500" size={24} />
                                </div>
                                <div>
                                    <span className="text-emerald-500 font-mono text-xl font-black uppercase tracking-tighter">Synchronized</span>
                                    <p className="text-[9px] font-mono text-muted-foreground/40 uppercase tracking-widest">Minimal jitter detected</p>
                                </div>
                            </>
                        )}
                        {connectionStatus === 'offline' && (
                            <>
                                <div className="p-3 bg-rose-500/10 rounded-xl border border-rose-500/20">
                                    <WifiOff className="text-rose-500" size={24} />
                                </div>
                                <span className="text-rose-500 font-mono text-xl font-black uppercase tracking-tighter">Connection Lost</span>
                            </>
                        )}
                        {connectionStatus === 'testing' && (
                            <>
                                <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20">
                                    <Loader2 className="text-amber-500 animate-spin" size={24} />
                                </div>
                                <span className="text-amber-500 font-mono text-xl font-black uppercase tracking-tighter animate-pulse">Probing...</span>
                            </>
                        )}
                        {connectionStatus === 'idle' && (
                            <>
                                <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                                    <Activity className="text-muted-foreground/40" size={24} />
                                </div>
                                <span className="text-muted-foreground/40 font-mono text-xl font-black uppercase tracking-tighter">Standby</span>
                            </>
                        )}
                    </div>
                </GlassCard>

                {/* Active Stream Card */}
                <GlassCard className="p-6 bg-white/2 border-white/5 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform">
                        <Zap size={60} className="text-primary" />
                    </div>
                    <label className="text-[9px] font-mono font-black uppercase text-muted-foreground/40 mb-3 block tracking-[0.2em]">Active Channels</label>
                    <div className="flex items-end justify-between">
                        <div className="text-4xl font-mono font-black text-foreground tracking-tighter">{sessions.length}</div>
                        <Link href="/dashboard/sessions" className="group flex items-center gap-2 p-2 px-4 glass-card border-white/10 hover:border-primary/50 text-[9px] font-black font-mono uppercase tracking-widest text-muted-foreground hover:text-primary transition-all rounded-xl shadow-lg">
                            Manage Streams <ChevronRight size={12} className="group-hover:translate-x-1 transition-transform" />
                        </Link>
                    </div>
                </GlassCard>
            </motion.div>

            {/* Acquisition Mode / Quick Setup */}
            <motion.div variants={itemVariants} className="space-y-6">
                <div className="flex items-center gap-3 px-4">
                    <Zap size={18} className="text-primary" />
                    <h2 className="text-sm font-black font-mono uppercase tracking-[0.2em]">Acquisition Protocols</h2>
                </div>

                {activeSession ? (
                    <div className="grid grid-cols-1 lg:grid-cols-1 gap-6">
                        <GlassCard className="p-8 border-emerald-500/20 bg-emerald-500/5 relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-6 opacity-[0.03] group-hover:opacity-[0.08] transition-all">
                                <ShieldCheck size={180} className="text-emerald-500" />
                            </div>
                            <div className="flex items-center gap-4 mb-8 relative z-10">
                                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                                    <CheckCircle className="text-emerald-500 animate-pulse" size={20} />
                                </div>
                                <div>
                                    <span className="text-emerald-500 font-mono text-lg font-black uppercase tracking-tighter">Session Authorized</span>
                                    <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest">
                                        ID: {activeSession.id} | Protocol: {activeSession.type.toUpperCase()}
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
                                {/* cURL Example */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-black font-mono uppercase text-primary tracking-widest">cURL Intercept</span>
                                        <motion.button
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            onClick={() => copyToClipboard(`curl -x user:pass@${PROXY_ENDPOINT} https://httpbin.org/ip`, 'curl')}
                                            className="text-muted-foreground hover:text-primary transition-all text-[9px] font-black font-mono uppercase flex items-center gap-2"
                                        >
                                            {copied === 'curl' ? <CheckCircle size={12} className="text-emerald-500" /> : <Copy size={12} />}
                                            Copy Payload
                                        </motion.button>
                                    </div>
                                    <div className="bg-black/60 border border-white/5 rounded-2xl p-6 font-mono text-xs text-white/50 break-all leading-relaxed shadow-inner">
                                        <span className="text-emerald-500">$</span> curl -x
                                        <span className="text-primary italic"> {activeSession.id.substring(0, 8)}:********</span>@{PROXY_ENDPOINT} https://httpbin.org/ip
                                    </div>
                                </div>

                                {/* Node.js Example */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-black font-mono uppercase text-primary tracking-widest">Node.js Fragment</span>
                                        <motion.button
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            onClick={() => copyToClipboard(`const axios = require('axios');\nconst proxy = 'http://user:pass@${PROXY_ENDPOINT}';\naxios.get('https://httpbin.org/ip', { proxy }).then(res => console.log(res.data));`, 'node')}
                                            className="text-muted-foreground hover:text-primary transition-all text-[9px] font-black font-mono uppercase flex items-center gap-2"
                                        >
                                            {copied === 'node' ? <CheckCircle size={12} className="text-emerald-500" /> : <Copy size={12} />}
                                            Copy Payload
                                        </motion.button>
                                    </div>
                                    <div className="bg-black/60 border border-white/5 rounded-2xl p-6 font-mono text-[11px] text-white/50 overflow-x-auto shadow-inner">
                                        <code className="block whitespace-pre">
                                            {`const axios = require('axios');\nconst proxy = 'http://${activeSession.id.substring(0, 8)}:***@${PROXY_ENDPOINT}';\naxios.get('https://...', { proxy });`}
                                        </code>
                                    </div>
                                </div>
                            </div>
                        </GlassCard>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <motion.button
                            whileHover={{ y: -8, scale: 1.01 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => handleQuickStart('rotating')}
                            disabled={creating}
                            className="group p-8 glass-card border-white/5 bg-white/2 hover:bg-white/5 hover:border-primary/40 transition-all rounded-3xl text-left relative overflow-hidden disabled:opacity-50 shadow-xl"
                        >
                            <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-15 transition-all transform group-hover:scale-125 group-hover:rotate-12 duration-700">
                                <Globe size={180} className="text-primary" />
                            </div>
                            <div className="relative z-10">
                                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 mb-6 shadow-[0_0_20px_rgba(16,185,129,0.1)]">
                                    {creating ? <Loader2 size={24} className="animate-spin text-primary" /> : <RefreshCw size={24} className="text-primary" />}
                                </div>
                                <h3 className="text-2xl font-black font-mono uppercase tracking-tighter text-foreground group-hover:text-primary transition-colors mb-3">
                                    Rotating Stream
                                </h3>
                                <p className="text-[11px] font-mono font-black text-muted-foreground uppercase opacity-40 leading-relaxed tracking-widest">
                                    NEW IDENTITY PER REQUEST. IDEAL FOR AGGRESSIVE DATA HARVESTING AND ANONYMIZED DISCOVERY.
                                </p>
                            </div>
                        </motion.button>

                        <motion.button
                            whileHover={{ y: -8, scale: 1.01 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => handleQuickStart('sticky')}
                            disabled={creating}
                            className="group p-8 glass-card border-white/5 bg-white/2 hover:bg-white/5 hover:border-primary/40 transition-all rounded-3xl text-left relative overflow-hidden disabled:opacity-50 shadow-xl"
                        >
                            <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-15 transition-all transform group-hover:scale-125 group-hover:-rotate-12 duration-700">
                                <Shield size={180} className="text-blue-500" />
                            </div>
                            <div className="relative z-10">
                                <div className="w-14 h-14 rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20 mb-6 shadow-[0_0_20px_rgba(59,130,246,0.1)]">
                                    {creating ? <Loader2 size={24} className="animate-spin text-blue-500" /> : <Lock size={24} className="text-blue-500" />}
                                </div>
                                <h3 className="text-2xl font-black font-mono uppercase tracking-tighter text-foreground group-hover:text-blue-400 transition-colors mb-3">
                                    Sticky Core
                                </h3>
                                <p className="text-[11px] font-mono font-black text-muted-foreground uppercase opacity-40 leading-relaxed tracking-widest">
                                    PERSISTENT IDENTITY FRAGMENTS. PERFECT FOR SECURE ACCOUNT SIMULATION AND LINEAR SESSIONS.
                                </p>
                            </div>
                        </motion.button>
                    </div>
                )}
            </motion.div>

            {/* Network Analytics Preview */}
            <motion.div variants={itemVariants} className="glass-card p-8 bg-white/2 border-white/5 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 -mr-32 -mt-32 rounded-full blur-3xl"></div>

                <div className="flex items-center justify-between mb-10 relative z-10">
                    <h2 className="text-sm font-black font-mono uppercase tracking-[0.2em] flex items-center gap-3">
                        <Activity size={18} className="text-primary/70" /> Real-time Telemetry
                    </h2>
                    <Link href="/dashboard/usage" className="text-[10px] font-black font-mono uppercase tracking-[0.3em] text-primary hover:text-emerald-400 transition-all flex items-center gap-2 px-4 py-2 glass-card border-white/10">
                        ANALYTICS VAULT <ExternalLink size={12} />
                    </Link>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-6 relative z-10">
                    {[
                        { label: "Requests Today", value: "14,302", color: "text-foreground" },
                        { label: "Data Pipeline", value: "1.24 GB", color: "text-primary" },
                        { label: "Avg Latency", value: "42ms", color: "text-foreground" },
                        { label: "Success index", value: "99.98%", color: "text-emerald-500" },
                    ].map((stat, i) => (
                        <div key={i} className="p-6 glass-card bg-white/5 border-white/5 rounded-2xl group hover:bg-white/10 transition-all">
                            <div className={`text-3xl font-mono font-black tracking-tighter mb-2 ${stat.color}`}>{stat.value}</div>
                            <div className="text-[9px] font-mono font-black uppercase text-muted-foreground/30 tracking-widest">{stat.label}</div>
                        </div>
                    ))}
                </div>
            </motion.div>

            {/* Integration Matrices */}
            <motion.div variants={itemVariants} className="glass-card p-8 bg-white/2 border-white/5">
                <h2 className="text-sm font-black font-mono uppercase tracking-[0.2em] mb-10 flex items-center gap-3 relative z-10">
                    <Settings size={18} className="text-muted-foreground/60" /> Integration Matrices
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6 relative z-10">
                    {[
                        { name: 'Python', icon: '🐍', bg: 'hover:bg-blue-500/10' },
                        { name: 'Node.js', icon: '⬢', bg: 'hover:bg-emerald-500/10' },
                        { name: 'Golang', icon: 'Ξ', bg: 'hover:bg-cyan-500/10' },
                        { name: 'Rest API', icon: '〉', bg: 'hover:bg-primary/10' },
                    ].map((guide) => (
                        <button
                            key={guide.name}
                            className={`p-6 glass-card border-white/10 ${guide.bg} transition-all rounded-2xl text-center group active:scale-95`}
                        >
                            <div className="text-4xl mb-4 group-hover:scale-110 transition-transform duration-500 grayscale opacity-40 group-hover:grayscale-0 group-hover:opacity-100">{guide.icon}</div>
                            <div className="text-[10px] font-black font-mono uppercase tracking-widest text-muted-foreground group-hover:text-foreground transition-colors">{guide.name}</div>
                        </button>
                    ))}
                </div>
            </motion.div>
        </motion.div>
    );
}
