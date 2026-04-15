"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, fetchWithAuth } from '@/lib/auth';
import { Shield, Lock, AlertTriangle, Key, Smartphone, Check, Loader2, X, RefreshCw, Copy, Monitor, Clock } from 'lucide-react';
import { getErrorMessage } from '@/lib/utils';
import { SessionsPanel, AnomaliesPanel, LoginHistoryPanel } from '@/components/security';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

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
            <div className="flex flex-col items-center justify-center py-40 gap-4">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Analizing Security Protocols...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex flex-col gap-2 border-b border-border pb-6">
                <div className="flex items-center gap-2 text-primary font-mono text-xs font-bold uppercase tracking-widest">
                    <Shield size={14} />
                    Account Fortification
                </div>
                <h1 className="text-3xl font-bold font-mono uppercase tracking-tight">Security Settings</h1>
                <p className="text-muted-foreground font-mono text-xs max-w-lg">
                    MANAGE AUTHENTICATION PROTOCOLS AND ACCESS CONTROLS.
                </p>
            </div>

            {/* Watchtower Emergency Banner */}
            {systemPaused && (
                <div className="card-retro p-6 bg-red-500/10 border-red-500/40 border-l-4 animate-pulse">
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
                <div className="card-retro p-4 bg-destructive/10 border-destructive/20 text-destructive flex justify-between items-center text-xs font-mono">
                    <span>ERROR: {error}</span>
                    <button onClick={() => setError('')}><X size={14} /></button>
                </div>
            )}
            {success && (
                <div className="card-retro p-4 bg-green-500/10 border-green-500/20 text-green-500 flex justify-between items-center text-xs font-mono uppercase">
                    <span>SUCCESS: {success}</span>
                    <button onClick={() => setSuccess('')}><X size={14} /></button>
                </div>
            )}

            {/* Tabs Navigation */}
            <div className="flex border-b border-border overflow-x-auto">
                <button
                    onClick={() => setActiveTab('2fa')}
                    className={`flex items-center gap-2 px-4 py-3 font-mono text-xs font-bold uppercase border-b-2 transition-colors whitespace-nowrap ${activeTab === '2fa'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                >
                    <Lock size={14} /> Two-Factor Auth
                </button>
                <button
                    onClick={() => setActiveTab('sessions')}
                    className={`flex items-center gap-2 px-4 py-3 font-mono text-xs font-bold uppercase border-b-2 transition-colors whitespace-nowrap ${activeTab === 'sessions'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                >
                    <Monitor size={14} /> Sessions
                </button>
                <button
                    onClick={() => setActiveTab('alerts')}
                    className={`flex items-center gap-2 px-4 py-3 font-mono text-xs font-bold uppercase border-b-2 transition-colors whitespace-nowrap ${activeTab === 'alerts'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                >
                    <AlertTriangle size={14} /> Security Alerts
                </button>
                <button
                    onClick={() => setActiveTab('history')}
                    className={`flex items-center gap-2 px-4 py-3 font-mono text-xs font-bold uppercase border-b-2 transition-colors whitespace-nowrap ${activeTab === 'history'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                >
                    <Clock size={14} /> Login History
                </button>
            </div>

            {/* Sessions Panel */}
            {activeTab === 'sessions' && (
                <div className="card-retro p-6 bg-card">
                    <SessionsPanel />
                </div>
            )}

            {/* Alerts Panel */}
            {activeTab === 'alerts' && (
                <div className="card-retro p-6 bg-card">
                    <AnomaliesPanel />
                </div>
            )}

            {/* History Panel */}
            {activeTab === 'history' && (
                <div className="card-retro p-6 bg-card">
                    <LoginHistoryPanel />
                </div>
            )}

            {/* 2FA Section */}
            {activeTab === '2fa' && (
                <div className="card-retro p-6 bg-card space-y-6">
                    <div className="flex items-start justify-between border-b border-border pb-6">
                        <div className="flex items-start gap-4">
                            <div className="p-3 rounded-sm bg-secondary border border-border">
                                <Lock className="w-6 h-6 text-primary" />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold font-mono uppercase">Two-Factor Authentication</h2>
                                <p className="text-xs font-mono text-muted-foreground mt-1">ADD AN EXTRA LAYER OF SECURITY TO YOUR ACCOUNT.</p>
                            </div>
                        </div>
                        <span className={`px-2 py-0.5 rounded-sm border text-[10px] font-mono font-bold uppercase flex items-center gap-2 ${is2FAEnabled
                            ? 'bg-green-500/10 text-green-500 border-green-500/20'
                            : 'bg-secondary text-muted-foreground border-border'
                            }`}>
                            {is2FAEnabled && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>}
                            {is2FAEnabled ? 'Protocol Active' : 'Protocol Inactive'}
                        </span>
                    </div>

                    {!is2FAEnabled && !setupData && (
                        <div className="text-center py-6 space-y-4">
                            <p className="text-xs font-mono text-muted-foreground max-w-sm mx-auto">
                                PROTECT YOUR ACCOUNT WITH TIME-BASED ONE-TIME PASSWORDS (TOTP).
                                RECOMMENDED APPS: GOOGLE AUTHENTICATOR OR AUTHY.
                            </p>
                            <button
                                onClick={handleSetup2FA}
                                className="btn-retro btn-retro-primary"
                            >
                                INITIATE 2FA SETUP
                            </button>
                        </div>
                    )}

                    {/* Setup Flow */}
                    {setupData && (
                        <div className="space-y-8 animate-in slide-in-from-top-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center border border-dashed border-border p-6 rounded-sm bg-secondary/10">
                                <div className="text-center space-y-4">
                                    <h3 className="text-sm font-bold font-mono uppercase">1. Scan QR Code</h3>
                                    <div className="inline-block p-2 bg-white rounded-sm border border-border">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={setupData.qr_code} alt="2FA QR Code" className="w-40 h-40 mix-blend-multiply" />
                                    </div>
                                </div>

                                <div className="space-y-6">
                                    <div className="space-y-2">
                                        <h3 className="text-sm font-bold font-mono uppercase">2. Manual Entry</h3>
                                        <p className="text-[10px] font-mono text-muted-foreground">OR ENTER THIS CODE MANUALLY:</p>
                                        <code className="block w-full p-3 bg-black border border-primary/30 text-primary font-mono text-sm text-center tracking-widest rounded-sm selection:bg-primary selection:text-black">
                                            {setupData.secret}
                                        </code>
                                    </div>

                                    <div className="space-y-2">
                                        <h3 className="text-sm font-bold font-mono uppercase">3. Verify</h3>
                                        <input
                                            type="text"
                                            value={verificationCode}
                                            onChange={e => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                            placeholder="ENTER 6-DIGIT CODE"
                                            className="w-full bg-secondary border border-border rounded-sm py-3 px-4 text-center text-lg font-mono tracking-[0.5em] focus:border-primary focus:outline-none transition-all placeholder:text-muted-foreground/30 placeholder:tracking-normal placeholder:text-xs"
                                            maxLength={6}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="flex gap-4 justify-center">
                                <button
                                    onClick={() => { setSetupData(null); setVerificationCode(''); }}
                                    className="btn-retro btn-retro-outline"
                                >
                                    CANCEL
                                </button>
                                <button
                                    onClick={handleEnable2FA}
                                    disabled={verificationCode.length !== 6}
                                    className="btn-retro btn-retro-primary"
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
                                    <div className="text-sm font-bold font-mono text-green-500 uppercase">Two-factor authentication is active</div>
                                    <div className="text-[10px] font-mono text-muted-foreground uppercase opacity-70">Traffic encryption level: High</div>
                                </div>
                            </div>

                            {/* Backup Codes */}
                            <div className="border-t border-dashed border-border pt-6">
                                <div className="flex items-center justify-between mb-4">
                                    <div>
                                        <h3 className="text-sm font-bold font-mono uppercase flex items-center gap-2">
                                            <Key size={14} /> Backup Codes
                                        </h3>
                                        <p className="text-[10px] font-mono text-muted-foreground mt-1">
                                            <span className="text-primary font-bold">{backupCodesCount}</span> CODES REMAINING. USE IN CASE OF DEVICE LOSS.
                                        </p>
                                    </div>
                                    <button
                                        onClick={handleRegenerateBackupCodes}
                                        className="btn-retro btn-retro-outline py-2 px-3 text-[10px] flex items-center gap-2"
                                    >
                                        <RefreshCw size={12} /> REGENERATE
                                    </button>
                                </div>
                            </div>

                            {/* Disable 2FA */}
                            <div className="border-t border-dashed border-border pt-6 flex justify-end">
                                <button
                                    onClick={() => setShowDisableModal(true)}
                                    className="text-[10px] font-bold font-mono uppercase text-destructive hover:underline flex items-center gap-1"
                                >
                                    <AlertTriangle size={12} /> Disable Authentication Protocol
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Backup Codes Modal */}
            {showBackupCodes && backupCodes.length > 0 && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-card w-full max-w-md border border-border shadow-2xl p-6 card-retro">
                        <div className="flex items-center justify-between mb-6 border-b border-border pb-4">
                            <h2 className="text-lg font-bold font-mono uppercase">Backup Codes</h2>
                            <button onClick={() => { setShowBackupCodes(false); setBackupCodes([]); }} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
                        </div>

                        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-500 px-4 py-3 rounded-sm mb-6 text-[10px] font-mono font-bold uppercase flex items-center gap-2">
                            <AlertTriangle size={14} />
                            Save these codes securely. Use once each.
                        </div>

                        <div className="grid grid-cols-2 gap-3 mb-6">
                            {backupCodes.map((code, i) => (
                                <div key={i} className="px-3 py-2 bg-black border border-primary/20 rounded-sm font-mono text-sm text-center text-primary tracking-widest selection:bg-primary selection:text-black">
                                    {code}
                                </div>
                            ))}
                        </div>

                        <div className="flex gap-4">
                            <button
                                onClick={copyBackupCodes}
                                className="flex-1 btn-retro btn-retro-outline flex justify-center items-center gap-2"
                            >
                                <Copy size={14} /> COPY ALL
                            </button>
                            <button
                                onClick={() => { setShowBackupCodes(false); setBackupCodes([]); }}
                                className="flex-1 btn-retro btn-retro-primary justify-center"
                            >
                                ACKNOWLEDGED
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Disable 2FA Modal */}
            {showDisableModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-card w-full max-w-md border border-destructive/50 shadow-2xl p-6 card-retro animate-in zoom-in-95">
                        <div className="flex items-center justify-between mb-6 border-b border-destructive/20 pb-4">
                            <h2 className="text-lg font-bold font-mono uppercase text-destructive">Disable Protocol</h2>
                            <button onClick={() => setShowDisableModal(false)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
                        </div>

                        <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-sm mb-6 text-[10px] font-mono font-bold uppercase">
                            Warning: Account security will be compromised.
                        </div>

                        <div className="space-y-4 mb-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-mono font-bold uppercase text-muted-foreground">Confirm Password</label>
                                <input
                                    type="password"
                                    value={disablePassword}
                                    onChange={e => setDisablePassword(e.target.value)}
                                    className="w-full bg-secondary border border-border rounded-sm py-2 px-3 text-sm focus:border-destructive focus:outline-none"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-mono font-bold uppercase text-muted-foreground">2FA Code</label>
                                <input
                                    type="text"
                                    value={disableCode}
                                    onChange={e => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    placeholder="000000"
                                    className="w-full bg-secondary border border-border rounded-sm py-2 px-3 text-sm font-mono tracking-widest focus:border-destructive focus:outline-none"
                                    maxLength={6}
                                />
                            </div>
                        </div>

                        <div className="flex gap-4">
                            <button
                                onClick={() => setShowDisableModal(false)}
                                className="flex-1 btn-retro btn-retro-outline"
                            >
                                CANCEL
                            </button>
                            <button
                                onClick={handleDisable2FA}
                                className="flex-1 btn-retro bg-destructive text-destructive-foreground hover:bg-destructive/90 border-destructive/50"
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
