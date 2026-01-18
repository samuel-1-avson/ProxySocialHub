'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, fetchWithAuth } from '@/lib/auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

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
        } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            setError(err.message);
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
        } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            setError(err.message);
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
        } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            setError(err.message);
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
        } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            setError(err.message);
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
            <div className="flex items-center justify-center py-12">
                <div className="text-white">Loading security settings...</div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-white">Security Settings</h1>
                <p className="text-gray-400 mt-1">Manage your account security and authentication methods</p>
            </div>

            {/* Messages */}
            {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg flex justify-between">
                    <span>{error}</span>
                    <button onClick={() => setError('')}>×</button>
                </div>
            )}
            {success && (
                <div className="bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-3 rounded-lg flex justify-between">
                    <span>{success}</span>
                    <button onClick={() => setSuccess('')}>×</button>
                </div>
            )}

            {/* 2FA Section */}
            <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-orange-500/10 rounded-lg">
                            <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-white">Two-Factor Authentication</h2>
                            <p className="text-gray-400 text-sm">Add an extra layer of security to your account</p>
                        </div>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-sm ${is2FAEnabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                        }`}>
                        {is2FAEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                </div>

                <div className="p-6">
                    {!is2FAEnabled && !setupData && (
                        <div className="text-center py-4">
                            <p className="text-gray-400 mb-4">
                                Protect your account with time-based one-time passwords (TOTP).
                                You&apos;ll need an authenticator app like Google Authenticator or Authy.
                            </p>
                            <button
                                onClick={handleSetup2FA}
                                className="px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition"
                            >
                                Enable 2FA
                            </button>
                        </div>
                    )}

                    {/* Setup Flow */}
                    {setupData && (
                        <div className="space-y-6">
                            <div className="text-center">
                                <h3 className="text-lg font-medium text-white mb-2">Scan QR Code</h3>
                                <p className="text-gray-400 text-sm mb-4">
                                    Scan this QR code with your authenticator app
                                </p>
                                <div className="inline-block p-4 bg-white rounded-lg">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={setupData.qr_code} alt="2FA QR Code" className="w-48 h-48" />
                                </div>
                            </div>

                            <div className="text-center">
                                <p className="text-gray-400 text-sm mb-2">Or enter this code manually:</p>
                                <code className="px-4 py-2 bg-gray-900 rounded text-orange-400 font-mono text-sm">
                                    {setupData.secret}
                                </code>
                            </div>

                            <div className="max-w-xs mx-auto">
                                <label className="block text-sm font-medium text-gray-300 mb-2">
                                    Enter verification code from your app
                                </label>
                                <input
                                    type="text"
                                    value={verificationCode}
                                    onChange={e => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    placeholder="000000"
                                    className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white text-center text-2xl tracking-widest font-mono focus:outline-none focus:border-orange-500"
                                    maxLength={6}
                                />
                            </div>

                            <div className="flex gap-3 justify-center">
                                <button
                                    onClick={() => { setSetupData(null); setVerificationCode(''); }}
                                    className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleEnable2FA}
                                    disabled={verificationCode.length !== 6}
                                    className="px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Verify & Enable
                                </button>
                            </div>
                        </div>
                    )}

                    {/* 2FA Enabled State */}
                    {is2FAEnabled && !setupData && (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                                <div className="flex items-center gap-3">
                                    <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                    </svg>
                                    <div>
                                        <div className="text-green-400 font-medium">Two-factor authentication is active</div>
                                        <div className="text-gray-400 text-sm">Your account is protected with 2FA</div>
                                    </div>
                                </div>
                            </div>

                            {/* Backup Codes */}
                            <div className="border-t border-gray-700 pt-6">
                                <h3 className="text-white font-medium mb-2">Backup Codes</h3>
                                <p className="text-gray-400 text-sm mb-4">
                                    You have <span className="text-orange-400 font-medium">{backupCodesCount}</span> backup codes remaining.
                                    Use these if you lose access to your authenticator app.
                                </p>
                                <div className="flex gap-3">
                                    <button
                                        onClick={handleRegenerateBackupCodes}
                                        className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition"
                                    >
                                        Regenerate Codes
                                    </button>
                                </div>
                            </div>

                            {/* Disable 2FA */}
                            <div className="border-t border-gray-700 pt-6">
                                <button
                                    onClick={() => setShowDisableModal(true)}
                                    className="text-red-400 hover:text-red-300 text-sm"
                                >
                                    Disable Two-Factor Authentication
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Backup Codes Modal */}
            {showBackupCodes && backupCodes.length > 0 && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
                    <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md border border-gray-700">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-semibold text-white">Your Backup Codes</h2>
                            <button onClick={() => { setShowBackupCodes(false); setBackupCodes([]); }} className="text-gray-400 hover:text-white">×</button>
                        </div>

                        <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 px-4 py-3 rounded-lg mb-4 text-sm">
                            ⚠️ Save these codes in a secure place. Each code can only be used once.
                        </div>

                        <div className="grid grid-cols-2 gap-2 mb-4">
                            {backupCodes.map((code, i) => (
                                <div key={i} className="px-3 py-2 bg-gray-900 rounded font-mono text-sm text-center text-white">
                                    {code}
                                </div>
                            ))}
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={copyBackupCodes}
                                className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition"
                            >
                                Copy All
                            </button>
                            <button
                                onClick={() => { setShowBackupCodes(false); setBackupCodes([]); }}
                                className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Disable 2FA Modal */}
            {showDisableModal && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
                    <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md border border-gray-700">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-semibold text-white">Disable 2FA</h2>
                            <button onClick={() => setShowDisableModal(false)} className="text-gray-400 hover:text-white">×</button>
                        </div>

                        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg mb-4 text-sm">
                            Warning: This will make your account less secure.
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Password</label>
                                <input
                                    type="password"
                                    value={disablePassword}
                                    onChange={e => setDisablePassword(e.target.value)}
                                    className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-orange-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">2FA Code</label>
                                <input
                                    type="text"
                                    value={disableCode}
                                    onChange={e => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    placeholder="000000"
                                    className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white font-mono focus:outline-none focus:border-orange-500"
                                    maxLength={6}
                                />
                            </div>
                        </div>

                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => setShowDisableModal(false)}
                                className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDisable2FA}
                                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition"
                            >
                                Disable 2FA
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
