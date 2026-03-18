'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useWallet } from '@solana/wallet-adapter-react';
import { createClient } from '@/lib/supabase/client';
import { SolanaWalletButton } from '@/components/SolanaWalletButton';
import { Mail, Lock, Globe, ArrowRight, Github, Chrome, AlertCircle, Loader2 } from 'lucide-react';
import { getErrorMessage } from '@/lib/utils';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, walletLogin } = useAuth();
  const { connected, publicKey, signMessage } = useWallet();
  const router = useRouter();
  const supabase = createClient();

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthLogin = async (provider: 'google' | 'github') => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: provider,
        options: {
          redirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback`,
        },
      });
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OAuth login failed');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden px-4 md:bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]">
      <div className="max-w-md w-full relative z-10">

        {/* Branding */}
        <div className="text-center mb-10 group cursor-default">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-sm bg-primary text-primary-foreground border border-transparent shadow-[3px_3px_0px_var(--foreground)] mb-6 group-hover:translate-x-1 group-hover:translate-y-1 group-hover:shadow-[1px_1px_0px_var(--foreground)] transition-all">
            <span className="font-bold text-xl font-mono">PS</span>
          </div>
          <h1 className="text-3xl font-bold font-mono tracking-tight mb-2">
            PROXY<span className="text-primary italic">HUB</span>
          </h1>
          <p className="text-muted-foreground text-xs font-mono uppercase tracking-[0.2em]">
            SYSTEM_ACCESS_TERMINAL
          </p>
        </div>

        {/* Login Card */}
        <div className="card-retro p-8 md:p-10 bg-card">
          <h2 className="text-xl font-bold font-mono text-center mb-8 uppercase border-b-2 border-border pb-4 w-full">Identity Verification</h2>

          {error && (
            <div className="flex items-center gap-3 bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-sm mb-6 text-sm font-mono">
              <AlertCircle size={16} className="shrink-0" />
              <p>{error}</p>
            </div>
          )}

          <div className="mb-6 flex justify-center">
            <SolanaWalletButton />
          </div>

          {/* OAuth Buttons */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            <button
              onClick={() => handleOAuthLogin('google')}
              className="btn-retro btn-retro-outline py-3 text-xs"
            >
              <Chrome className="w-4 h-4 mr-2" />
              GOOGLE
            </button>
            <button
              onClick={() => handleOAuthLogin('github')}
              className="btn-retro btn-retro-outline py-3 text-xs"
            >
              <Github className="w-4 h-4 mr-2" />
              GITHUB
            </button>
          </div>

          <div className="relative mb-8 text-center">
            <span className="bg-card px-2 text-xs font-mono text-muted-foreground relative z-10">OR SECURE OVERRIDE</span>
            <div className="absolute inset-0 flex items-center top-[1px] -z-0">
              <div className="w-full border-t border-border"></div>
            </div>
          </div>

          {connected && publicKey && (
            <button
              type="button"
              onClick={async () => {
                setLoading(true);
                try {
                  // Pass the wallet adapter as 'signer' which has signMessage
                  await walletLogin(publicKey.toBase58(), { signMessage });
                  router.push('/dashboard');
                  router.refresh();
                } catch (err: unknown) {
                  setError(getErrorMessage(err) || 'Wallet login failed');
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading}
              className="w-full btn-retro btn-retro-primary py-3 text-sm mb-6"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  VERIFY IDENTITY ({publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)})
                  <ArrowRight size={16} className="ml-2" />
                </>
              )}
            </button>
          )}

          <form onSubmit={handleCredentialsSubmit} className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="email" className="block text-xs font-mono font-bold uppercase text-muted-foreground">
                Node Identifier
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required={!connected} // Only required if not wallet login
                  className="w-full bg-background border border-input rounded-sm py-2 pl-10 pr-3 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-muted-foreground/50"
                  placeholder="USER@PROTOCOL.IO"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="block text-xs font-mono font-bold uppercase text-muted-foreground">
                  Encryption Key
                </label>
                <Link href="/forgot-password" className="text-[10px] font-mono font-bold text-primary hover:underline uppercase">
                  Reset
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required={!connected}
                  minLength={8}
                  className="w-full bg-background border border-input rounded-sm py-2 pl-10 pr-3 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-muted-foreground/50"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !!connected} // Disable if wallet connected (encourage wallet login)
              className="w-full btn-retro btn-retro-outline py-3 text-sm opacity-80 hover:opacity-100"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  LOGIN WITH CREDENTIALS
                  <ArrowRight size={16} className="ml-2" />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 text-center">
            <p className="text-muted-foreground text-xs font-mono">
              OFF GRID?{' '}
              <Link href="/register" className="text-primary hover:underline font-bold">
                REQUEST ACCESS
              </Link>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center space-y-2">
          <p className="text-muted-foreground/50 text-[10px] font-mono uppercase tracking-widest">
            © 2026 PROXYHUB PROTOCOL. AUTHORIZED ACCESS ONLY.
          </p>
          <div className="flex items-center justify-center gap-4 opacity-30">
            <div className="w-6 h-6 rounded-sm bg-foreground/10 flex items-center justify-center font-bold text-[8px] font-mono text-foreground">PH</div>
            <div className="w-12 h-px bg-foreground/10"></div>
            <div className="w-6 h-6 rounded-sm bg-foreground/10 flex items-center justify-center font-bold text-[8px] font-mono text-foreground">GW</div>
          </div>
        </div>
      </div>
    </div >
  );
}

