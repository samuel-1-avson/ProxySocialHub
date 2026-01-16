'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

type LoginStep = 'credentials' | '2fa' | 'verify-email';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  // 2FA State
  const [step, setStep] = useState<LoginStep>('credentials');
  const [tempToken, setTempToken] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Check for verification required
        if (data.code === 'email_not_verified' || data.verification_required) {
          setStep('verify-email');
          return;
        }
        throw new Error(data.error || 'Login failed');
      }

      // Check if 2FA is required
      if (data.requires_2fa && data.temp_token) {
        setTempToken(data.temp_token);
        setStep('2fa');
        return;
      }

      // Standard login - store tokens and redirect
      await login(email, password);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (twoFactorCode.length !== 6 && twoFactorCode.length !== 8) {
      setError('Please enter a valid code');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/v1/auth/2fa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          temp_token: tempToken,
          code: twoFactorCode,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Invalid 2FA code');
      }

      // Store tokens
      localStorage.setItem('proxyhubb_tokens', JSON.stringify({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
      }));
      localStorage.setItem('proxyhubb_user', JSON.stringify(data.user));

      // Redirect to dashboard
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/v1/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to resend verification');
      }

      setSuccess('Verification email sent! Please check your inbox.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend verification');
    } finally {
      setLoading(false);
    }
  };

  const resetToCredentials = () => {
    setStep('credentials');
    setTempToken('');
    setTwoFactorCode('');
    setError('');
    setSuccess('');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-primary">🌐 ProxyHub</h1>
          <p className="text-muted mt-2">Ghana&apos;s Premium Proxy Marketplace</p>
        </div>

        {/* Login Card */}
        <div className="card w-full">
          {/* Step: Credentials */}
          {step === 'credentials' && (
            <>
              <h2 className="text-2xl font-semibold mb-6">Welcome Back</h2>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg mb-6">
                  {error}
                </div>
              )}

              <form onSubmit={handleCredentialsSubmit} className="space-y-6">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium mb-2">
                    Email Address
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="input"
                    placeholder="you@example.com"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-medium mb-2">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    className="input"
                    placeholder="••••••••"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="btn btn-primary w-full shadow-retro"
                >
                  {loading ? 'Signing in...' : 'Sign In'}
                </button>
              </form>

              <div className="mt-6 text-center">
                <p className="text-muted">
                  Don&apos;t have an account?{' '}
                  <Link href="/register" className="text-primary hover:underline">
                    Sign up
                  </Link>
                </p>
              </div>
            </>
          )}

          {/* Step: 2FA Verification */}
          {step === '2fa' && (
            <>
              <div className="text-center mb-6">
                <div className="inline-flex p-3 bg-orange-500/10 rounded-full mb-4">
                  <svg className="w-8 h-8 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-semibold text-white">Two-Factor Authentication</h2>
                <p className="text-gray-400 mt-2">Enter the code from your authenticator app</p>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg mb-6">
                  {error}
                </div>
              )}

              <form onSubmit={handle2FASubmit} className="space-y-6">
                <div>
                  <input
                    type="text"
                    value={twoFactorCode}
                    onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                    placeholder="000000"
                    className="w-full px-4 py-4 bg-gray-700/50 border border-gray-600 rounded-lg text-white text-center text-2xl tracking-widest font-mono placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    maxLength={8}
                    autoFocus
                  />
                  <p className="text-gray-500 text-sm text-center mt-2">
                    Enter 6-digit code or 8-character backup code
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading || (twoFactorCode.length !== 6 && twoFactorCode.length !== 8)}
                  className="w-full py-3 px-4 bg-gradient-to-r from-orange-500 to-amber-500 text-white font-medium rounded-lg hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {loading ? 'Verifying...' : 'Verify'}
                </button>
              </form>

              <div className="mt-6 text-center">
                <button onClick={resetToCredentials} className="text-gray-400 hover:text-white text-sm">
                  ← Back to login
                </button>
              </div>
            </>
          )}

          {/* Step: Email Verification Required */}
          {step === 'verify-email' && (
            <>
              <div className="text-center mb-6">
                <div className="inline-flex p-3 bg-yellow-500/10 rounded-full mb-4">
                  <svg className="w-8 h-8 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-semibold text-white">Verify Your Email</h2>
                <p className="text-gray-400 mt-2">
                  Please verify your email address to continue.
                  Check your inbox for a verification link.
                </p>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg mb-6">
                  {error}
                </div>
              )}
              {success && (
                <div className="bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-3 rounded-lg mb-6">
                  {success}
                </div>
              )}

              <div className="bg-gray-700/30 rounded-lg p-4 mb-6">
                <p className="text-gray-300 text-sm">
                  We sent a verification email to:
                </p>
                <p className="text-white font-medium mt-1">{email}</p>
              </div>

              <button
                onClick={handleResendVerification}
                disabled={loading}
                className="w-full py-3 px-4 bg-orange-500 text-white font-medium rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {loading ? 'Sending...' : 'Resend Verification Email'}
              </button>

              <div className="mt-6 text-center">
                <button onClick={resetToCredentials} className="text-gray-400 hover:text-white text-sm">
                  ← Back to login
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-muted text-sm mt-8">
          © 2026 ProxyHub. All rights reserved.
        </p>
      </div>
    </div>
  );
}
