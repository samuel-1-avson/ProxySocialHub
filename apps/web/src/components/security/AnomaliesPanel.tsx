"use client";

import { useState, useEffect } from 'react';
import { fetchWithAuth } from '@/lib/auth';
import { AlertTriangle, MapPin, Clock, Check, Loader2, RefreshCw, Shield, Eye } from 'lucide-react';
import { getErrorMessage } from '@/lib/utils';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface Anomaly {
    id: string;
    anomaly_type: string;
    severity: string;
    detected_ip: string;
    detected_country: string;
    detected_city: string;
    expected_country: string;
    risk_score: number;
    action_taken: string;
    is_resolved: boolean;
    resolved_at: string | null;
    resolution: string | null;
    created_at: string;
}

interface AnomaliesResponse {
    anomalies: Anomaly[];
    count: number;
}

export default function AnomaliesPanel() {
    const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [resolving, setResolving] = useState<string | null>(null);
    const [showResolutionModal, setShowResolutionModal] = useState<string | null>(null);
    const [resolution, setResolution] = useState('');

    useEffect(() => {
        loadAnomalies();
    }, []);

    const loadAnomalies = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/v1/audit/anomalies`);
            if (!res.ok) throw new Error('Failed to load anomalies');
            const data: AnomaliesResponse = await res.json();
            setAnomalies(data.anomalies || []);
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    const resolveAnomaly = async (anomalyId: string) => {
        if (!resolution.trim()) {
            setError('Please provide a resolution');
            return;
        }

        setResolving(anomalyId);
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/v1/audit/anomalies/${anomalyId}/resolve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resolution }),
            });
            if (!res.ok) throw new Error('Failed to resolve anomaly');

            setAnomalies(anomalies.map(a =>
                a.id === anomalyId
                    ? { ...a, is_resolved: true, resolution, resolved_at: new Date().toISOString() }
                    : a
            ));
            setShowResolutionModal(null);
            setResolution('');
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setResolving(null);
        }
    };

    const getSeverityColor = (severity: string) => {
        switch (severity.toLowerCase()) {
            case 'critical': return 'text-red-500 bg-red-500/10 border-red-500/30';
            case 'high': return 'text-orange-500 bg-orange-500/10 border-orange-500/30';
            case 'medium': return 'text-amber-500 bg-amber-500/10 border-amber-500/30';
            case 'low': return 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30';
            default: return 'text-muted-foreground bg-secondary border-border';
        }
    };

    const getAnomalyTypeLabel = (type: string) => {
        const types: Record<string, string> = {
            'geo_change': 'Geographic Change',
            'device_change': 'New Device',
            'velocity': 'High Velocity',
            'impossible_travel': 'Impossible Travel',
        };
        return type.split(',').map(t => types[t] || t).join(', ');
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleString();
    };

    if (loading && anomalies.length === 0) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
        );
    }

    const unresolvedCount = anomalies.filter(a => !a.is_resolved).length;

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-bold font-mono uppercase flex items-center gap-2">
                        <Shield size={14} className="text-primary" />
                        Security Alerts
                    </h3>
                    <p className="text-[10px] font-mono text-muted-foreground">
                        {unresolvedCount > 0 ? (
                            <span className="text-amber-500">{unresolvedCount} UNRESOLVED ALERT{unresolvedCount !== 1 ? 'S' : ''}</span>
                        ) : (
                            <span className="text-green-500">ALL CLEAR</span>
                        )}
                    </p>
                </div>
                <button
                    onClick={loadAnomalies}
                    className="btn-retro btn-retro-outline py-1.5 px-3 text-[10px] flex items-center gap-1.5"
                >
                    <RefreshCw size={12} /> REFRESH
                </button>
            </div>

            {error && (
                <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-2 rounded-sm text-xs font-mono">
                    {error}
                </div>
            )}

            {/* Anomalies List */}
            <div className="space-y-3">
                {anomalies.map((anomaly) => (
                    <div
                        key={anomaly.id}
                        className={`border rounded-sm p-4 ${anomaly.is_resolved ? 'border-border/50 bg-secondary/20 opacity-60' : 'border-amber-500/30 bg-amber-500/5'}`}
                    >
                        <div className="flex items-start justify-between">
                            <div className="flex items-start gap-3">
                                <div className={`p-2 rounded-sm ${getSeverityColor(anomaly.severity)}`}>
                                    <AlertTriangle size={16} />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono text-sm font-bold">
                                            {getAnomalyTypeLabel(anomaly.anomaly_type)}
                                        </span>
                                        <span className={`px-1.5 py-0.5 text-[9px] font-mono font-bold rounded-sm border ${getSeverityColor(anomaly.severity)}`}>
                                            {anomaly.severity.toUpperCase()}
                                        </span>
                                        {anomaly.is_resolved && (
                                            <span className="px-1.5 py-0.5 bg-green-500/10 text-green-500 border border-green-500/30 text-[9px] font-mono font-bold rounded-sm flex items-center gap-1">
                                                <Check size={10} /> RESOLVED
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3 mt-1 text-[10px] font-mono text-muted-foreground">
                                        <span className="flex items-center gap-1">
                                            <MapPin size={10} />
                                            {anomaly.detected_ip}
                                            {anomaly.detected_country && ` • ${anomaly.detected_country}`}
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <Clock size={10} />
                                            {formatDate(anomaly.created_at)}
                                        </span>
                                    </div>
                                    <div className="mt-2 text-[10px] font-mono">
                                        <span className="text-muted-foreground">Risk Score: </span>
                                        <span className={anomaly.risk_score >= 60 ? 'text-red-500' : anomaly.risk_score >= 40 ? 'text-amber-500' : 'text-yellow-500'}>
                                            {anomaly.risk_score}/100
                                        </span>
                                        <span className="text-muted-foreground ml-3">Action: </span>
                                        <span className="text-primary">{anomaly.action_taken}</span>
                                    </div>
                                    {anomaly.resolution && (
                                        <div className="mt-2 text-[10px] font-mono text-green-500">
                                            Resolution: {anomaly.resolution}
                                        </div>
                                    )}
                                </div>
                            </div>
                            {!anomaly.is_resolved && (
                                <button
                                    onClick={() => setShowResolutionModal(anomaly.id)}
                                    className="btn-retro btn-retro-outline py-1 px-2 text-[10px] flex items-center gap-1"
                                >
                                    <Eye size={12} /> REVIEW
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {anomalies.length === 0 && !loading && (
                <div className="text-center py-12 text-muted-foreground">
                    <Shield size={32} className="mx-auto mb-3 opacity-30" />
                    <p className="font-mono text-xs text-green-500">NO SECURITY ALERTS</p>
                    <p className="font-mono text-[10px] mt-1">Your account is secure</p>
                </div>
            )}

            {/* Resolution Modal */}
            {showResolutionModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-card w-full max-w-md border border-border shadow-2xl p-6 card-retro">
                        <h3 className="text-lg font-bold font-mono uppercase mb-4">Resolve Alert</h3>
                        <p className="text-xs font-mono text-muted-foreground mb-4">
                            Confirm that this login was legitimate or describe the action taken.
                        </p>
                        <div className="space-y-4 mb-6">
                            <textarea
                                value={resolution}
                                onChange={(e) => setResolution(e.target.value)}
                                placeholder="e.g., 'This was me logging in from a new location'"
                                className="w-full bg-secondary border border-border rounded-sm py-2 px-3 text-sm h-24 resize-none focus:border-primary focus:outline-none"
                            />
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setResolution('Verified - This was me')}
                                    className="text-[10px] font-mono px-2 py-1 bg-secondary border border-border rounded-sm hover:bg-secondary/80"
                                >
                                    ✓ This was me
                                </button>
                                <button
                                    onClick={() => setResolution('False positive - Legitimate access')}
                                    className="text-[10px] font-mono px-2 py-1 bg-secondary border border-border rounded-sm hover:bg-secondary/80"
                                >
                                    ✓ False positive
                                </button>
                            </div>
                        </div>
                        <div className="flex gap-4">
                            <button
                                onClick={() => { setShowResolutionModal(null); setResolution(''); }}
                                className="flex-1 btn-retro btn-retro-outline"
                            >
                                CANCEL
                            </button>
                            <button
                                onClick={() => resolveAnomaly(showResolutionModal)}
                                disabled={!resolution.trim() || resolving === showResolutionModal}
                                className="flex-1 btn-retro btn-retro-primary"
                            >
                                {resolving === showResolutionModal ? (
                                    <Loader2 size={14} className="animate-spin mx-auto" />
                                ) : (
                                    'RESOLVE'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
