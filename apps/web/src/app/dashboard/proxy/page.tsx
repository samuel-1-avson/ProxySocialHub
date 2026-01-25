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
    ExternalLink
} from 'lucide-react';
import Link from 'next/link';

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
            // Test the proxy endpoint
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

    const activeSession = sessions[0]; // Get first active session

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-40 gap-4">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Initializing Proxy System...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex flex-col gap-2 border-b border-border pb-6">
                <div className="flex items-center gap-2 text-primary font-mono text-xs font-bold uppercase tracking-widest">
                    <Globe size={14} />
                    Decentralized Proxy Network
                </div>
                <h1 className="text-3xl font-bold font-mono uppercase tracking-tight">Proxy Gateway</h1>
                <p className="text-muted-foreground font-mono text-xs max-w-lg">
                    CONNECT TO THE DECENTRALIZED RESIDENTIAL PROXY NETWORK.
                </p>
            </div>

            {/* Connection Status */}
            <div className="card-retro p-6 bg-card relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl" />
                <div className="relative z-10">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-sm font-bold font-mono uppercase flex items-center gap-2">
                            <Server size={16} />
                            Gateway Status
                        </h2>
                        <button
                            onClick={testConnection}
                            disabled={testing}
                            className="btn-retro btn-retro-outline text-xs flex items-center gap-2"
                        >
                            {testing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            TEST CONNECTION
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* Endpoint */}
                        <div className="p-4 bg-black/30 border border-border rounded-sm">
                            <label className="text-[10px] font-mono uppercase text-muted-foreground mb-2 block">Proxy Endpoint</label>
                            <div className="flex items-center gap-2">
                                <code className="text-primary font-mono text-sm flex-1 truncate">{PROXY_ENDPOINT}</code>
                                <button
                                    onClick={() => copyToClipboard(PROXY_ENDPOINT, 'endpoint')}
                                    className="text-muted-foreground hover:text-primary transition-colors"
                                >
                                    {copied === 'endpoint' ? <CheckCircle size={16} className="text-green-500" /> : <Copy size={16} />}
                                </button>
                            </div>
                        </div>

                        {/* Status */}
                        <div className="p-4 bg-black/30 border border-border rounded-sm">
                            <label className="text-[10px] font-mono uppercase text-muted-foreground mb-2 block">Status</label>
                            <div className="flex items-center gap-2">
                                {connectionStatus === 'online' && (
                                    <>
                                        <Wifi className="text-green-500" size={20} />
                                        <span className="text-green-500 font-mono font-bold uppercase">Online</span>
                                    </>
                                )}
                                {connectionStatus === 'offline' && (
                                    <>
                                        <WifiOff className="text-red-500" size={20} />
                                        <span className="text-red-500 font-mono font-bold uppercase">Offline</span>
                                    </>
                                )}
                                {connectionStatus === 'testing' && (
                                    <>
                                        <Loader2 className="text-yellow-500 animate-spin" size={20} />
                                        <span className="text-yellow-500 font-mono font-bold uppercase">Testing...</span>
                                    </>
                                )}
                                {connectionStatus === 'idle' && (
                                    <>
                                        <Activity className="text-muted-foreground" size={20} />
                                        <span className="text-muted-foreground font-mono font-bold uppercase">Not Tested</span>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Active Sessions */}
                        <div className="p-4 bg-black/30 border border-border rounded-sm">
                            <label className="text-[10px] font-mono uppercase text-muted-foreground mb-2 block">Active Sessions</label>
                            <div className="flex items-center justify-between">
                                <span className="text-2xl font-mono font-bold text-primary">{sessions.length}</span>
                                <Link href="/dashboard/sessions" className="text-primary hover:underline text-xs font-mono uppercase flex items-center gap-1">
                                    Manage <ArrowRight size={12} />
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Quick Setup */}
            <div className="card-retro p-6 bg-card">
                <h2 className="text-sm font-bold font-mono uppercase border-b border-dashed border-border pb-4 mb-6 flex items-center gap-2">
                    <Zap size={16} />
                    Quick Setup
                </h2>

                {activeSession ? (
                    <div className="space-y-6">
                        <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-sm">
                            <div className="flex items-center gap-2 mb-2">
                                <CheckCircle className="text-green-500" size={16} />
                                <span className="text-green-500 font-mono text-sm font-bold uppercase">Session Active</span>
                            </div>
                            <p className="text-xs font-mono text-muted-foreground">
                                Session ID: {activeSession.id.slice(0, 8)}... | Type: {activeSession.type.toUpperCase()}
                            </p>
                        </div>

                        <div className="space-y-4">
                            <h3 className="text-xs font-mono font-bold uppercase text-muted-foreground">Connection Examples</h3>

                            {/* cURL Example */}
                            <div className="bg-black border border-border rounded-sm p-4">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] font-mono uppercase text-primary font-bold">cURL</span>
                                    <button
                                        onClick={() => copyToClipboard(`curl -x username:password@${PROXY_ENDPOINT} https://httpbin.org/ip`, 'curl')}
                                        className="text-muted-foreground hover:text-primary transition-colors text-xs flex items-center gap-1"
                                    >
                                        {copied === 'curl' ? <CheckCircle size={12} className="text-green-500" /> : <Copy size={12} />}
                                        Copy
                                    </button>
                                </div>
                                <code className="text-xs font-mono text-white/80 break-all">
                                    curl -x username:password@{PROXY_ENDPOINT} https://httpbin.org/ip
                                </code>
                            </div>

                            {/* Python Example */}
                            <div className="bg-black border border-border rounded-sm p-4">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] font-mono uppercase text-primary font-bold">Python</span>
                                    <button
                                        onClick={() => copyToClipboard(`import requests\nproxies = {"http": "http://user:pass@${PROXY_ENDPOINT}", "https": "http://user:pass@${PROXY_ENDPOINT}"}\nresponse = requests.get("https://httpbin.org/ip", proxies=proxies)`, 'python')}
                                        className="text-muted-foreground hover:text-primary transition-colors text-xs flex items-center gap-1"
                                    >
                                        {copied === 'python' ? <CheckCircle size={12} className="text-green-500" /> : <Copy size={12} />}
                                        Copy
                                    </button>
                                </div>
                                <pre className="text-xs font-mono text-white/80 overflow-x-auto">
                                    {`import requests
proxies = {"http": "http://user:pass@${PROXY_ENDPOINT}"}
response = requests.get("https://httpbin.org/ip", proxies=proxies)`}
                                </pre>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <button
                            onClick={() => handleQuickStart('rotating')}
                            disabled={creating}
                            className="group p-6 border border-border bg-secondary/10 hover:bg-secondary/30 hover:border-primary transition-all rounded-sm text-left relative overflow-hidden disabled:opacity-50"
                        >
                            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                <Globe size={48} />
                            </div>
                            <div className="relative z-10">
                                <h3 className="text-sm font-bold font-mono uppercase text-foreground group-hover:text-primary transition-colors mb-2 flex items-center gap-2">
                                    {creating && <Loader2 size={14} className="animate-spin" />}
                                    Rotating Proxy
                                </h3>
                                <p className="text-xs font-mono text-muted-foreground leading-relaxed">
                                    NEW IP EACH REQUEST. IDEAL FOR WEB SCRAPING AND DATA COLLECTION.
                                </p>
                            </div>
                        </button>

                        <button
                            onClick={() => handleQuickStart('sticky')}
                            disabled={creating}
                            className="group p-6 border border-border bg-secondary/10 hover:bg-secondary/30 hover:border-primary transition-all rounded-sm text-left relative overflow-hidden disabled:opacity-50"
                        >
                            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                <Shield size={48} />
                            </div>
                            <div className="relative z-10">
                                <h3 className="text-sm font-bold font-mono uppercase text-foreground group-hover:text-primary transition-colors mb-2 flex items-center gap-2">
                                    {creating && <Loader2 size={14} className="animate-spin" />}
                                    Sticky Session
                                </h3>
                                <p className="text-xs font-mono text-muted-foreground leading-relaxed">
                                    MAINTAIN SAME IP. PERFECT FOR ACCOUNT MANAGEMENT AND TESTING.
                                </p>
                            </div>
                        </button>
                    </div>
                )}
            </div>

            {/* Usage Statistics */}
            <div className="card-retro p-6 bg-card">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-sm font-bold font-mono uppercase flex items-center gap-2">
                        <Activity size={16} />
                        Usage Statistics
                    </h2>
                    <Link href="/dashboard/usage" className="text-primary hover:underline text-xs font-mono uppercase flex items-center gap-1">
                        View Details <ExternalLink size={12} />
                    </Link>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 bg-black/30 border border-border rounded-sm text-center">
                        <div className="text-2xl font-mono font-bold text-primary mb-1">0</div>
                        <div className="text-[10px] font-mono uppercase text-muted-foreground">Requests Today</div>
                    </div>
                    <div className="p-4 bg-black/30 border border-border rounded-sm text-center">
                        <div className="text-2xl font-mono font-bold text-primary mb-1">0 MB</div>
                        <div className="text-[10px] font-mono uppercase text-muted-foreground">Data Transfer</div>
                    </div>
                    <div className="p-4 bg-black/30 border border-border rounded-sm text-center">
                        <div className="text-2xl font-mono font-bold text-primary mb-1">--</div>
                        <div className="text-[10px] font-mono uppercase text-muted-foreground">Avg Latency</div>
                    </div>
                    <div className="p-4 bg-black/30 border border-border rounded-sm text-center">
                        <div className="text-2xl font-mono font-bold text-primary mb-1">99.9%</div>
                        <div className="text-[10px] font-mono uppercase text-muted-foreground">Success Rate</div>
                    </div>
                </div>
            </div>

            {/* Documentation Links */}
            <div className="card-retro p-6 bg-card">
                <h2 className="text-sm font-bold font-mono uppercase border-b border-dashed border-border pb-4 mb-6 flex items-center gap-2">
                    <Settings size={16} />
                    Integration Guides
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                        { name: 'Python', icon: '🐍' },
                        { name: 'Node.js', icon: '⬢' },
                        { name: 'cURL', icon: '〉' },
                        { name: 'Mobile', icon: '📱' },
                    ].map((guide) => (
                        <button
                            key={guide.name}
                            className="p-4 border border-border hover:border-primary bg-secondary/10 hover:bg-secondary/20 transition-all rounded-sm text-center group"
                        >
                            <div className="text-2xl mb-2">{guide.icon}</div>
                            <div className="text-xs font-mono uppercase font-bold group-hover:text-primary transition-colors">{guide.name}</div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
