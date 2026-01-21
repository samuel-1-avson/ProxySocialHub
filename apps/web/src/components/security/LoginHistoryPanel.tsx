"use client";

import { useState, useEffect } from 'react';
import { fetchWithAuth } from '@/lib/auth';
import { Clock, Check, X, AlertTriangle, Loader2, RefreshCw, Filter } from 'lucide-react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface AuditLog {
    id: string;
    event_type: string;
    severity: string;
    ip_address: string;
    description: string;
    success: boolean;
    created_at: string;
}

interface LogsResponse {
    logs: AuditLog[];
    count: number;
}

export default function LoginHistoryPanel() {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState<'all' | 'success' | 'failed'>('all');

    useEffect(() => {
        loadLogs();
    }, []);

    const loadLogs = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/v1/audit/logs?limit=50`);
            if (!res.ok) throw new Error('Failed to load logs');
            const data: LogsResponse = await res.json();
            // Filter for auth-related events
            const authLogs = (data.logs || []).filter(log =>
                log.event_type.startsWith('auth.')
            );
            setLogs(authLogs);
        } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const getEventLabel = (eventType: string) => {
        const labels: Record<string, string> = {
            'auth.login': 'Login',
            'auth.login_failed': 'Failed Login',
            'auth.logout': 'Logout',
            'auth.mfa_enabled': 'MFA Enabled',
            'auth.mfa_disabled': 'MFA Disabled',
            'auth.mfa_verified': 'MFA Verified',
            'auth.password_reset': 'Password Reset',
            'auth.session_revoked': 'Session Revoked',
        };
        return labels[eventType] || eventType.replace('auth.', '').replace(/_/g, ' ');
    };

    const getSeverityIcon = (log: AuditLog) => {
        if (!log.success || log.event_type === 'auth.login_failed') {
            return <X className="w-4 h-4 text-red-500" />;
        }
        if (log.severity === 'warning') {
            return <AlertTriangle className="w-4 h-4 text-amber-500" />;
        }
        return <Check className="w-4 h-4 text-green-500" />;
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        const isYesterday = new Date(now.getTime() - 86400000).toDateString() === date.toDateString();

        if (isToday) return `Today at ${date.toLocaleTimeString()}`;
        if (isYesterday) return `Yesterday at ${date.toLocaleTimeString()}`;
        return date.toLocaleString();
    };

    const filteredLogs = logs.filter(log => {
        if (filter === 'success') return log.success && log.event_type !== 'auth.login_failed';
        if (filter === 'failed') return !log.success || log.event_type === 'auth.login_failed';
        return true;
    });

    if (loading && logs.length === 0) {
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
                    <h3 className="text-sm font-bold font-mono uppercase flex items-center gap-2">
                        <Clock size={14} className="text-primary" />
                        Login History
                    </h3>
                    <p className="text-[10px] font-mono text-muted-foreground">
                        {logs.length} RECENT EVENT{logs.length !== 1 ? 'S' : ''}
                    </p>
                </div>
                <div className="flex gap-2">
                    <div className="flex border border-border rounded-sm overflow-hidden text-[10px] font-mono">
                        <button
                            onClick={() => setFilter('all')}
                            className={`px-2 py-1 ${filter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-secondary/80'}`}
                        >
                            ALL
                        </button>
                        <button
                            onClick={() => setFilter('success')}
                            className={`px-2 py-1 border-l border-border ${filter === 'success' ? 'bg-green-500/20 text-green-500' : 'bg-secondary hover:bg-secondary/80'}`}
                        >
                            SUCCESS
                        </button>
                        <button
                            onClick={() => setFilter('failed')}
                            className={`px-2 py-1 border-l border-border ${filter === 'failed' ? 'bg-red-500/20 text-red-500' : 'bg-secondary hover:bg-secondary/80'}`}
                        >
                            FAILED
                        </button>
                    </div>
                    <button
                        onClick={loadLogs}
                        className="btn-retro btn-retro-outline py-1.5 px-3 text-[10px] flex items-center gap-1.5"
                    >
                        <RefreshCw size={12} />
                    </button>
                </div>
            </div>

            {error && (
                <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-2 rounded-sm text-xs font-mono">
                    {error}
                </div>
            )}

            {/* Logs List */}
            <div className="border border-border rounded-sm overflow-hidden">
                <table className="w-full text-xs font-mono">
                    <thead className="bg-secondary border-b border-border">
                        <tr className="text-left text-[10px] uppercase text-muted-foreground">
                            <th className="py-2 px-3 w-8"></th>
                            <th className="py-2 px-3">Event</th>
                            <th className="py-2 px-3 hidden md:table-cell">IP Address</th>
                            <th className="py-2 px-3">Time</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {filteredLogs.map((log) => (
                            <tr key={log.id} className="hover:bg-secondary/30 transition-colors">
                                <td className="py-2 px-3">
                                    {getSeverityIcon(log)}
                                </td>
                                <td className="py-2 px-3">
                                    <span className="font-bold">{getEventLabel(log.event_type)}</span>
                                    {log.description && (
                                        <p className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                                            {log.description}
                                        </p>
                                    )}
                                </td>
                                <td className="py-2 px-3 text-muted-foreground hidden md:table-cell">
                                    {log.ip_address || '—'}
                                </td>
                                <td className="py-2 px-3 text-muted-foreground text-[10px]">
                                    {formatDate(log.created_at)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {filteredLogs.length === 0 && !loading && (
                <div className="text-center py-8 text-muted-foreground">
                    <Clock size={24} className="mx-auto mb-2 opacity-30" />
                    <p className="font-mono text-[10px]">NO EVENTS FOUND</p>
                </div>
            )}
        </div>
    );
}
