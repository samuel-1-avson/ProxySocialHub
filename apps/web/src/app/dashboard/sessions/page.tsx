"use client";

import { useEffect, useState } from 'react';
import { createSession, getSessions, terminateSession, Session } from '@/lib/api';
import { ExternalLink, Terminal, Globe, Shield, Loader2, Copy, Trash2, Plus, Clock } from 'lucide-react';

export default function SessionsPage() {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [newCredentials, setNewCredentials] = useState<{ username: string; password: string; endpoint: string } | null>(null);

    useEffect(() => {
        fetchSessions();
    }, []);

    async function fetchSessions() {
        try {
            const data = await getSessions();
            setSessions(data);
        } catch (error) {
            console.error('Failed to fetch sessions:', error);
        } finally {
            setLoading(false);
        }
    }

    async function handleCreateSession(type: 'rotating' | 'sticky') {
        setCreating(true);
        try {
            const result = await createSession(type);
            setNewCredentials(result.proxy_credentials);
            await fetchSessions();
        } catch (error) {
            console.error('Failed to create session:', error);
            alert('Failed to create session. Please try again.');
        } finally {
            setCreating(false);
        }
    }

    async function handleTerminate(sessionId: string) {
        if (!confirm('TERMINATE SESSION? THIS ACTION CANNOT BE UNDONE.')) return;
        try {
            await terminateSession(sessionId);
            await fetchSessions();
        } catch (error) {
            console.error('Failed to terminate session:', error);
        }
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-40 gap-4">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Scanning Active Tunnels...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex flex-col gap-2 border-b border-border pb-6">
                <div className="flex items-center gap-2 text-primary font-mono text-xs font-bold uppercase tracking-widest">
                    <Terminal size={14} />
                    Connection Manager
                </div>
                <h1 className="text-3xl font-bold font-mono uppercase tracking-tight">Active Sessions</h1>
                <p className="text-muted-foreground font-mono text-xs max-w-lg">
                    MANAGE PROXY TUNNELS AND CREDENTIALS.
                </p>
            </div>

            {/* Create Session */}
            <div className="card-retro p-6 bg-card">
                <h2 className="text-sm font-bold font-mono uppercase border-b border-dashed border-border pb-4 mb-6 flex items-center gap-2">
                    <Plus size={16} /> Initiate New Session
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <button
                        onClick={() => handleCreateSession('rotating')}
                        disabled={creating}
                        className="group p-6 border border-border bg-secondary/10 hover:bg-secondary/30 hover:border-primary transition-all rounded-sm text-left relative overflow-hidden disabled:opacity-50"
                    >
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Globe size={48} />
                        </div>
                        <div className="relative z-10">
                            <h3 className="text-sm font-bold font-mono uppercase text-foreground group-hover:text-primary transition-colors mb-2">Rotating Session</h3>
                            <p className="text-xs font-mono text-muted-foreground leading-relaxed">
                                IP ROTATES WITH EACH REQUEST. OPTIMIZED FOR DATA EXTRACTION AND ANONYMITY.
                            </p>
                        </div>
                    </button>

                    <button
                        onClick={() => handleCreateSession('sticky')}
                        disabled={creating}
                        className="group p-6 border border-border bg-secondary/10 hover:bg-secondary/30 hover:border-primary transition-all rounded-sm text-left relative overflow-hidden disabled:opacity-50"
                    >
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Shield size={48} />
                        </div>
                        <div className="relative z-10">
                            <h3 className="text-sm font-bold font-mono uppercase text-foreground group-hover:text-primary transition-colors mb-2">Sticky Session</h3>
                            <p className="text-xs font-mono text-muted-foreground leading-relaxed">
                                STATIC IP ASSIGNMENT. OPTIMIZED FOR ACCOUNT MANAGEMENT AND PERSISTENCE.
                            </p>
                        </div>
                    </button>
                </div>
            </div>

            {/* New Credentials Modal */}
            {newCredentials && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-card w-full max-w-md border border-primary shadow-[0_0_30px_rgba(34,197,94,0.1)] p-6 card-retro animate-in zoom-in-95">
                        <h3 className="text-lg font-bold font-mono uppercase text-primary mb-2">Tunnel Established</h3>
                        <p className="text-[10px] font-mono uppercase text-muted-foreground mb-6">SECURE CREDENTIALS GENERATED.</p>

                        <div className="space-y-4 bg-black border border-primary/20 rounded-sm p-4 font-mono text-xs">
                            <div>
                                <label className="text-muted-foreground block mb-1 uppercase text-[10px] font-bold">Endpoint</label>
                                <p className="text-white break-all">{newCredentials.endpoint}</p>
                            </div>
                            <div>
                                <label className="text-muted-foreground block mb-1 uppercase text-[10px] font-bold">Username</label>
                                <p className="text-primary break-all">{newCredentials.username}</p>
                            </div>
                            <div>
                                <label className="text-muted-foreground block mb-1 uppercase text-[10px] font-bold">Password</label>
                                <p className="text-white break-all">{newCredentials.password}</p>
                            </div>
                        </div>

                        <div className="mt-6 flex gap-4">
                            <button
                                onClick={() => {
                                    navigator.clipboard.writeText(
                                        `${newCredentials.endpoint}\n${newCredentials.username}\n${newCredentials.password}`
                                    );
                                }}
                                className="flex-1 btn-retro btn-retro-outline flex items-center justify-center gap-2"
                            >
                                <Copy size={14} /> COPY ALL
                            </button>
                            <button
                                onClick={() => setNewCredentials(null)}
                                className="flex-1 btn-retro btn-retro-primary justify-center"
                            >
                                ACKNOWLEDGED
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Sessions List */}
            <div className="card-retro p-0 bg-card overflow-hidden">
                <div className="px-6 py-4 border-b border-border bg-secondary/10 flex items-center justify-between">
                    <h2 className="text-sm font-bold font-mono uppercase flex items-center gap-2">
                        <Terminal size={16} /> Active Tunnels
                    </h2>
                    <span className="text-[10px] font-mono font-bold uppercase text-muted-foreground">
                        {sessions.length} / 10 SLOTS
                    </span>
                </div>

                {sessions.length === 0 ? (
                    <div className="p-12 text-center border-b border-border">
                        <p className="text-xs font-mono font-bold uppercase text-muted-foreground mb-4">NO ACTIVE TUNNELS DETECTED.</p>
                        <button onClick={() => handleCreateSession('rotating')} className="text-primary hover:underline text-xs font-mono uppercase">
                            INITIATE CONNECTION
                        </button>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs font-mono">
                            <thead className="bg-secondary/20">
                                <tr className="border-b border-border">
                                    <th className="px-6 py-3 font-bold text-muted-foreground uppercase">Session ID</th>
                                    <th className="px-6 py-3 font-bold text-muted-foreground uppercase">Type</th>
                                    <th className="px-6 py-3 font-bold text-muted-foreground uppercase">Status</th>
                                    <th className="px-6 py-3 font-bold text-muted-foreground uppercase">Created</th>
                                    <th className="px-6 py-3 font-bold text-muted-foreground uppercase text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                                {sessions.map((session) => (
                                    <tr key={session.id} className="hover:bg-secondary/10 transition-colors">
                                        <td className="px-6 py-4 font-bold">
                                            <div className="flex flex-col gap-1">
                                                <span>{session.id.slice(0, 8)}...</span>
                                                {session.tx_hash && (
                                                    <a
                                                        href={`https://bittensor.subscan.io/extrinsic/${session.tx_hash}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex items-center gap-1 text-[8px] text-primary hover:underline font-bold uppercase tracking-wider"
                                                    >
                                                        <ExternalLink size={8} /> ON-CHAIN
                                                    </a>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 uppercase font-bold">{session.type}</td>
                                        <td className="px-6 py-4">
                                            <span
                                                className={`px-2 py-0.5 rounded-sm border text-[10px] font-bold uppercase ${session.status === 'active'
                                                    ? 'bg-green-500/10 text-green-500 border-green-500/20'
                                                    : 'bg-secondary text-muted-foreground border-border'
                                                    }`}
                                            >
                                                {session.status}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-muted-foreground flex items-center gap-1">
                                            <Clock size={12} />
                                            {new Date(session.created_at).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            {session.status === 'active' && (
                                                <button
                                                    onClick={() => handleTerminate(session.id)}
                                                    className="text-destructive hover:bg-destructive/10 p-2 rounded-sm transition-colors"
                                                    title="Terminate Session"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
