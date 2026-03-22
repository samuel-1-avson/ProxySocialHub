"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, fetchWithAuth } from '@/lib/auth';
import { Shield, Lock, AlertTriangle, Key, Smartphone, Check, Loader2, X, RefreshCw, Copy, Monitor, Clock } from 'lucide-react';
import { getErrorMessage } from '@/lib/utils';
import { SessionsPanel, AnomaliesPanel, LoginHistoryPanel } from '@/components/security';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081';

type TabType = '2fa' | 'sessions' | 'alerts' | 'history';

interface SetupResponse {
    secret: string;
    qr_code: string;
    otpauth_url: string;
}

export default function SecuritySettingsPage() {
    const { isLoading, isAuthenticated } = useAuth();
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    // 2FA State
    const [is2FAEnabled, setIs2FAEnabled] = useState(false);
    const [setupData, setSetupData] = useState<SetupResponse | null>(null);
    const [verificationCode, setVerificationCode] = useState('');
    const [backupCodesCount, setBackupCodesCount] = useState(0);
    const [showBackupCodes, setShowBackupCodes] = useState(false);
    const [backupCodes, setBackupCodes] = useState<string[]>([]);
    const [disablePassword, setDisablePassword] = useState('');
    const [disableCode, setDisableCode] = useState('');
    const [showDisableModal, setShowDisableModal] = useState(false);
    const [systemPaused, setSystemPaused] = useState(false);

    // Tab State
    const [activeTab, setActiveTab] = useState<TabType>('2fa');

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            router.push('/login');
            return;
        }
        if (isAuthenticated) {
            loadSecurityStatus();
        }
    }, [isLoading, isAuthenticated, router]);

    const loadSecurityStatus = async () => {
        setLoading(true);
        try {
            // Check if 2FA is enabled by getting backup codes count
            const res = await fetchWithAuth(`${API_BASE_URL}/v1/2fa/backup-codes`);
            if (res.ok) {
                const data = await res.json();
                setIs2FAEnabled(true);
                setBackupCodesCount(data.remaining_codes || 0);
            } else if (res.status === 400) {
                // 2FA not enabled
                setIs2FAEnabled(false);
            }
        } catch {
            // 2FA not enabled or error
            setIs2FAEnabled(false);
        } finally {
            setLoading(false);
        }

        // Fetch Watchtower status
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/v1/system/watchtower/status`);
            if (res.ok) {
                const data = await res.json();
                setSystemPaused(data.emergency_pause);
            }
        } catch {
            setSystemPaused(false);
        }
    };

    const handleSetup2FA = async () => {
        setError('');
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/v1/2fa/setup`, { method: 'POST' });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to setup 2FA');
            }
            const data = await res.json();
            setSetupData(data);
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        }
    };

    const handleEnable2FA = async () => {
        if (verificationCode.length !== 6) {
            setError('Please enter a 6-digit code');
            return;
        }

        setError('');
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/v1/2fa/enable`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: verificationCode }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Invalid verification code');
            }

            const data = await res.json();
            setBackupCodes(data.backup_codes || []);
            setShowBackupCodes(true);
            setIs2FAEnabled(true);
            setSetupData(null);
            setVerificationCode('');
            setSuccess('Two-factor authentication enabled successfully!');
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        }
    };

    const handleDisable2FA = async () => {
        if (!disablePassword || disableCode.length !== 6) {
            setError('Please enter your password and 2FA code');
            return;
        }

        setError('');
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/v1/2fa/disable`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: disablePassword, code: disableCode }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to disable 2FA');
            }

            setIs2FAEnabled(false);
            setShowDisableModal(false);
            setDisablePassword('');
            setDisableCode('');
            setBackupCodesCount(0);
            setSuccess('Two-factor authentication has been disabled');
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        }
    };

    const handleRegenerateBackupCodes = async () => {
        setError('');
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/v1/2fa/backup-codes/regenerate`, {
                method: 'POST',
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to regenerate backup codes');
            }

            const data = await res.json();
            setBackupCodes(data.backup_codes || []);
            setBackupCodesCount(data.backup_codes?.length || 0);
            setShowBackupCodes(true);
            setSuccess('New backup codes generated. Make sure to save them!');
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        }
    };

    const copyBackupCodes = () => {
        const codesText = backupCodes.join('\n');
        navigator.clipboard.writeText(codesText);
        setSuccess('Backup codes copied to clipboard!');
        setTimeout(() => setSuccess(''), 3000);
    };

    if (isLoading || loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground animate-pulse">Analyzing Security Protocols...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header Content */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-white/5">
                <div>
                    <h2 className="text-2xl font-black font-mono uppercase tracking-tighter flex items-center gap-2">
                        Account Fortification
                        <Shield size={20} className="text-primary" />
                    </h2>
                    <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mt-1 opacity-60">
                        Multi-factor Authentication & Access Controls
                    </p>
                </div>
            </div>

            {/* Watchtower Emergency Banner */}
            {systemPaused && (
                <div className="p-6 bg-red-500/10 border-red-500/30 border-l-4 animate-pulse rounded-sm">
                    <div className="flex items-center gap-4 text-red-500">
                        <AlertTriangle className="w-8 h-8" />
                        <div>
                            <div className="text-sm font-black font-mono uppercase tracking-tighter">System Lockdown Active</div>
                            <p className="text-[10px] font-mono leading-tight opacity-70">
                                WATCHTOWER SENTRY HAS DETECTED A VELOCITY BREACH OR INFRASTRUCTURE ANOMALY.
                                ALL SETTLEMENTS ARE PAUSED UNTIL PROTOCOL RESOLUTION.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Messages */}
            {error && (
                <div className="p-4 bg-destructive/10 border border-destructive/20 text-destructive flex justify-between items-center text-[10px] font-mono uppercase font-black">
                    <span>ERROR: {error}</span>
                    <button onClick={() => setError('')}><X size={14} /></button>
                </div>
            )}
            {success && (
                <div className="p-4 bg-green-500/10 border border-green-500/20 text-green-500 flex justify-between items-center text-[10px] font-mono uppercase font-black">
                    <span>SUCCESS: {success}</span>
                    <button onClick={() => setSuccess('')}><X size={14} /></button>
                </div>
            )}

            {/* Inner Tabs */}
            <div className="flex border-b border-white/5 overflow-x-auto">
                {(['2fa', 'sessions', 'alerts', 'history'] as TabType[]).map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-4 py-2 font-mono text-[10px] uppercase font-black tracking-widest border-b-2 transition-all whitespace-nowrap ${
                            activeTab === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        {tab === '2fa' ? 'Two-Factor Auth' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                ))}
            </div>

            {/* Tab Content Area */}
            <div className="mt-4">
                {activeTab === '2fa' && (
                    <div className="bg-white/[0.01] border border-white/5 rounded-sm p-6 space-y-6">
                        <div className="flex items-start justify-between border-b border-white/5 pb-6">
                            <div className="flex items-start gap-4">
                                <div className="p-3 rounded-sm bg-secondary border border-white/5">
                                    <Lock className="w-6 h-6 text-primary" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-black font-mono uppercase">Multi-Factor Authentication</h3>
                                    <p className="text-[10px] font-mono text-muted-foreground mt-1 uppercase opacity-60">TOTP-based identity verification protocol.</p>
                                </div>
                            </div>
                            <span className={`px-2 py-0.5 rounded-sm border text-[8px] font-mono font-black uppercase flex items-center gap-2 ${is2FAEnabled
                                ? 'bg-green-500/10 text-green-500 border-green-500/20'
                                : 'bg-secondary text-muted-foreground border-white/5'
                                }`}>
                                {is2FAEnabled && <span className="w-1 h-1 rounded-full bg-green-500 animate-pulse"></span>}
                                {is2FAEnabled ? 'Protocol Active' : 'Protocol Inactive'}
                            </span>
                        </div>

                        {!is2FAEnabled && !setupData && (
                            <div className="text-center py-6 space-y-4">
                                <p className="text-[10px] font-mono text-muted-foreground max-w-sm mx-auto uppercase opacity-60 font-black">
                                    TOTP APPS (GOOGLE AUTHENTICATOR, AUTHY) ARE REQUIRED TO SECURE THIS ACCOUNT SECTOR.
                                </p>
                                <button
                                    onClick={handleSetup2FA}
                                    className="btn-retro font-black text-[10px] tracking-[0.2em] px-6 py-3 border-primary/20 hover:border-primary transition-all bg-primary/10 text-primary"
                                >
                                    INITIATE 2FA SETUP
                                </button>
                            </div>
                        )}

                        {/* Setup Flow */}
                        {setupData && (
                            <div className="space-y-8 animate-in slide-in-from-top-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center border border-dashed border-white/10 p-6 rounded-sm bg-white/[0.01]">
                                    <div className="text-center space-y-4">
                                        <h4 className="text-[10px] font-black font-mono uppercase opacity-40">1. Scan QR Core</h4>
                                        <div className="inline-block p-2 bg-white rounded-sm border border-white/10">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={setupData.qr_code} alt="2FA QR Code" className="w-40 h-40 mix-blend-multiply" />
                                        </div>
                                    </div>

                                    <div className="space-y-6">
                                        <div className="space-y-2">
                                            <h4 className="text-[10px] font-black font-mono uppercase opacity-40">2. Manual Entry</h4>
                                            <code className="block w-full p-3 bg-black/40 border border-primary/30 text-primary font-mono text-sm text-center tracking-widest rounded-sm">
                                                {setupData.secret}
                                            </code>
                                        </div>

                                        <div className="space-y-2">
                                            <h4 className="text-[10px] font-black font-mono uppercase opacity-40">3. Verify Protocol</h4>
                                            <input
                                                type="text"
                                                value={verificationCode}
                                                onChange={e => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                                placeholder="000 000"
                                                className="w-full bg-black/40 border border-white/10 rounded-sm py-3 px-4 text-center text-lg font-mono tracking-[0.5em] focus:border-primary focus:outline-none transition-all placeholder:opacity-20"
                                                maxLength={6}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="flex gap-4 justify-center">
                                    <button
                                        onClick={() => { setSetupData(null); setVerificationCode(''); }}
                                        className="px-6 py-2 border border-white/10 rounded-sm text-[10px] font-black font-mono uppercase tracking-widest hover:bg-white/5 transition-colors"
                                    >
                                        CANCEL
                                    </button>
                                    <button
                                        onClick={handleEnable2FA}
                                        disabled={verificationCode.length !== 6}
                                        className="bg-primary text-primary-foreground px-6 py-2 rounded-sm text-[10px] font-black font-mono uppercase tracking-[0.2em] shadow-[3px_3px_0px_rgba(var(--primary),0.3)]"
                                    >
                                        VERIFY & ENABLE
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* 2FA Enabled State */}
                        {is2FAEnabled && !setupData && (
                            <div className="space-y-8 animate-in slide-in-from-top-4">
                                <div className="flex items-center gap-4 p-4 border border-green-500/20 bg-green-500/5 rounded-sm">
                                    <Check className="w-5 h-5 text-green-500" />
                                    <div>
                                        <div className="text-[11px] font-black font-mono text-green-500 uppercase">Two-factor authentication is active</div>
                                        <div className="text-[9px] font-mono text-muted-foreground uppercase opacity-40">Traffic encryption level: High</div>
                                    </div>
                                </div>

                                {/* Backup Codes */}
                                <div className="border-t border-dashed border-white/10 pt-6">
                                    <div className="flex items-center justify-between mb-4">
                                        <div>
                                            <h3 className="text-xs font-black font-mono uppercase flex items-center gap-2 tracking-widest">
                                                <Key size={14} className="text-primary" /> Backup Codes
                                            </h3>
                                            <p className="text-[9px] font-mono text-muted-foreground mt-1 uppercase opacity-60">
                                                <span className="text-primary font-black">{backupCodesCount}</span> CODES REMAINING.
                                            </p>
                                        </div>
                                        <button
                                            onClick={handleRegenerateBackupCodes}
                                            className="px-4 py-2 bg-white/5 border border-white/10 rounded-sm text-[9px] font-black font-mono uppercase tracking-widest hover:bg-white/10 transition-colors flex items-center gap-2"
                                        >
                                            <RefreshCw size={12} /> REGENERATE
                                        </button>
                                    </div>
                                </div>

                                {/* Disable 2FA */}
                                <div className="border-t border-dashed border-white/10 pt-6 flex justify-end">
                                    <button
                                        onClick={() => setShowDisableModal(true)}
                                        className="text-[9px] font-black font-mono uppercase text-destructive/60 hover:text-destructive hover:underline flex items-center gap-1 transition-colors"
                                    >
                                        <AlertTriangle size={12} /> Disable Authentication Protocol
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'sessions' && <div className="bg-white/[0.01] border border-white/5 rounded-sm p-6"><SessionsPanel /></div>}
                {activeTab === 'alerts' && <div className="bg-white/[0.01] border border-white/5 rounded-sm p-6"><AnomaliesPanel /></div>}
                {activeTab === 'history' && <div className="bg-white/[0.01] border border-white/5 rounded-sm p-6"><LoginHistoryPanel /></div>}
            </div>

            {/* Modals (Backup Codes & Disable) */}
            {showBackupCodes && backupCodes.length > 0 && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-background w-full max-w-md border border-white/10 shadow-2xl p-6 rounded-sm animate-in zoom-in-95">
                        <div className="flex items-center justify-between mb-6 border-b border-white/5 pb-4">
                            <h2 className="text-lg font-black font-mono uppercase tracking-tighter">Backup Codes</h2>
                            <button onClick={() => { setShowBackupCodes(false); setBackupCodes([]); }} className="text-muted-foreground hover:text-foreground transition-colors"><X size={18} /></button>
                        </div>

                        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-500 px-4 py-3 rounded-sm mb-6 text-[9px] font-mono font-black uppercase flex items-center gap-2">
                            <AlertTriangle size={14} />
                            Critical: Save these codes securely. Use once each.
                        </div>

                        <div className="grid grid-cols-2 gap-3 mb-6">
                            {backupCodes.map((code, i) => (
                                <div key={i} className="px-3 py-2 bg-black/40 border border-primary/20 rounded-sm font-mono text-sm text-center text-primary tracking-widest">
                                    {code}
                                </div>
                            ))}
                        </div>

                        <div className="flex gap-4">
                            <button
                                onClick={copyBackupCodes}
                                className="flex-1 px-4 py-2 border border-white/10 rounded-sm text-[10px] font-black font-mono uppercase tracking-widest hover:bg-white/5 transition-colors flex items-center justify-center gap-2"
                            >
                                <Copy size={14} /> COPY ALL
                            </button>
                            <button
                                onClick={() => { setShowBackupCodes(false); setBackupCodes([]); }}
                                className="flex-1 bg-primary text-primary-foreground px-4 py-2 rounded-sm text-[10px] font-black font-mono uppercase tracking-widest"
                            >
                                ACKNOWLEDGED
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showDisableModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-background w-full max-w-md border border-destructive/50 shadow-2xl p-6 rounded-sm animate-in zoom-in-95">
                        <div className="flex items-center justify-between mb-6 border-b border-destructive/20 pb-4">
                            <h2 className="text-lg font-black font-mono uppercase tracking-tighter text-destructive">Disable Protocol</h2>
                            <button onClick={() => setShowDisableModal(false)} className="text-muted-foreground hover:text-foreground transition-colors"><X size={18} /></button>
                        </div>

                        <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-sm mb-6 text-[9px] font-mono font-black uppercase">
                            Warning: Account security level will be downgraded.
                        </div>

                        <div className="space-y-4 mb-6">
                            <div className="space-y-2">
                                <label className="text-[9px] font-mono font-black uppercase text-muted-foreground opacity-60">Confirm Password</label>
                                <input
                                    type="password"
                                    value={disablePassword}
                                    onChange={e => setDisablePassword(e.target.value)}
                                    className="w-full bg-black/40 border border-white/10 rounded-sm py-2 px-3 text-sm focus:border-destructive outline-none transition-all"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[9px] font-mono font-black uppercase text-muted-foreground opacity-60">2FA Code</label>
                                <input
                                    type="text"
                                    value={disableCode}
                                    onChange={e => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    placeholder="000000"
                                    className="w-full bg-black/40 border border-white/10 rounded-sm py-2 px-3 text-sm font-mono tracking-widest focus:border-destructive outline-none transition-all"
                                    maxLength={6}
                                />
                            </div>
                        </div>

                        <div className="flex gap-4">
                            <button
                                onClick={() => setShowDisableModal(false)}
                                className="flex-1 px-4 py-2 border border-white/10 rounded-sm text-[10px] font-black font-mono uppercase tracking-widest hover:bg-white/5 transition-colors"
                            >
                                CANCEL
                            </button>
                            <button
                                onClick={handleDisable2FA}
                                className="flex-1 bg-destructive text-white px-4 py-2 rounded-sm text-[10px] font-black font-mono uppercase tracking-widest"
                            >
                                DISABLE
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
