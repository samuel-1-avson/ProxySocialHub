"use client";

import { useState, useEffect } from 'react';
import { fetchWithAuth } from '@/lib/auth';
import { Monitor, Smartphone, Tablet, Clock, MapPin, Trash2, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { getErrorMessage } from '@/lib/utils';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081';

interface Session {
    id: string;
    ip_address: string;
    user_agent: string;
    device_type: string;
    browser: string;
    os: string;
    country: string;
    city: string;
    last_active_at: string;
    created_at: string;
    is_active: boolean;
}

interface SessionsResponse {
    sessions: Session[];
    count: number;
}

export default function SessionsPanel() {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [revoking, setRevoking] = useState<string | null>(null);

    useEffect(() => {
        loadSessions();
    }, []);

    const loadSessions = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/v1/security/sessions`);
            if (!res.ok) throw new Error('Failed to load sessions');
            const data: SessionsResponse = await res.json();
            setSessions(data.sessions || []);
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    const revokeSession = async (sessionId: string) => {
        setRevoking(sessionId);
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/v1/security/sessions/${sessionId}`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Failed to revoke session');
            setSessions(sessions.filter(s => s.id !== sessionId));
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setRevoking(null);
        }
    };

    const revokeAllSessions = async () => {
        if (!confirm('Are you sure you want to log out from all devices?')) return;

        setLoading(true);
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/v1/security/sessions`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Failed to revoke all sessions');
            setSessions([]);
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    const getDeviceIcon = (type: string) => {
        switch (type.toLowerCase().replace(' (current)', '')) {
            case 'mobile': return <Smartphone size={16} />;
            case 'tablet': return <Tablet size={16} />;
            default: return <Monitor size={16} />;
        }
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleString();
    };

    const getRelativeTime = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 5) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        return `${diffDays}d ago`;
    };

    if (loading && sessions.length === 0) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-bold font-mono uppercase">Active Sessions</h3>
                    <p className="text-[10px] font-mono text-muted-foreground">
                        {sessions.length} DEVICE{sessions.length !== 1 ? 'S' : ''} CONNECTED
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={loadSessions}
                        className="btn-retro btn-retro-outline py-1.5 px-3 text-[10px] flex items-center gap-1.5"
                    >
                        <RefreshCw size={12} /> REFRESH
                    </button>
                    {sessions.length > 1 && (
                        <button
                            onClick={revokeAllSessions}
                            className="btn-retro bg-destructive/10 text-destructive border-destructive/20 py-1.5 px-3 text-[10px] flex items-center gap-1.5 hover:bg-destructive/20"
                        >
                            <Trash2 size={12} /> REVOKE ALL
                        </button>
                    )}
                </div>
            </div>

            {error && (
                <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-2 rounded-sm text-xs font-mono">
                    {error}
                </div>
            )}

            {/* Sessions List */}
            <div className="space-y-3">
                {sessions.map((session) => {
                    const isCurrent = session.device_type.includes('(current)');
                    return (
                        <div
                            key={session.id}
                            className={`border rounded-sm p-4 ${isCurrent ? 'border-primary/30 bg-primary/5' : 'border-border bg-secondary/30'}`}
                        >
                            <div className="flex items-start justify-between">
                                <div className="flex items-start gap-3">
                                    <div className={`p-2 rounded-sm ${isCurrent ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                                        {getDeviceIcon(session.device_type)}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono text-sm font-bold">
                                                {session.browser || 'Unknown'} • {session.os || 'Unknown'}
                                            </span>
                                            {isCurrent && (
                                                <span className="px-1.5 py-0.5 bg-primary text-primary-foreground text-[9px] font-mono font-bold rounded-sm">
                                                    THIS DEVICE
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3 mt-1 text-[10px] font-mono text-muted-foreground">
                                            <span className="flex items-center gap-1">
                                                <MapPin size={10} />
                                                {session.ip_address}
                                                {session.country && ` • ${session.country}`}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <Clock size={10} />
                                                {getRelativeTime(session.last_active_at)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                {!isCurrent && (
                                    <button
                                        onClick={() => revokeSession(session.id)}
                                        disabled={revoking === session.id}
                                        className="text-destructive hover:bg-destructive/10 p-1.5 rounded-sm transition-colors"
                                        title="Revoke session"
                                    >
                                        {revoking === session.id ? (
                                            <Loader2 size={14} className="animate-spin" />
                                        ) : (
                                            <Trash2 size={14} />
                                        )}
                                    </button>
                                )}
                            </div>
                            <div className="mt-3 pt-3 border-t border-border/50 text-[9px] font-mono text-muted-foreground/60">
                                Session created: {formatDate(session.created_at)}
                            </div>
                        </div>
                    );
                })}
            </div>

            {sessions.length === 0 && !loading && (
                <div className="text-center py-12 text-muted-foreground">
                    <Monitor size={32} className="mx-auto mb-3 opacity-30" />
                    <p className="font-mono text-xs">NO ACTIVE SESSIONS</p>
                </div>
            )}
        </div>
    );
}
