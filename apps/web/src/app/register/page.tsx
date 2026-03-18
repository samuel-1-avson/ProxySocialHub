'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useWallet } from '@solana/wallet-adapter-react'; // Added import
import { createClient } from '@/lib/supabase/client';
import { SolanaWalletButton } from '@/components/SolanaWalletButton'; // Added import
import { CheckCircle, Globe, ShoppingCart, Coins, Mail, Lock, ArrowRight, Github, Chrome, AlertCircle, Loader2, Sparkles } from 'lucide-react';
import { getErrorMessage } from '@/lib/utils';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<'buyer' | 'provider'>('buyer');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const { register, walletLogin } = useAuth(); // Added walletLogin
  const { connected, publicKey, signMessage } = useWallet(); // Added useWallet
  const router = useRouter();
  const supabase = createClient();

  // ... (handleOAuthRegister, handleSubmit existing logic remains, just keeping it here implicitly by replacing surrounding code if I were replacing whole file, but I'll use target/replacement carefully)

  const handleOAuthRegister = async (provider: 'google' | 'github') => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: provider,
        options: {
          redirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback`,
        },
      });
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OAuth registration failed');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      await register(email, password, role);
      setSuccess(true);
      setTimeout(() => {
        router.push('/login');
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden px-4 md:bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]">
        <div className="max-w-md w-full relative z-10 text-center">
          <div className="card-retro p-12 bg-card">
            <div className="w-16 h-16 rounded-sm bg-primary text-primary-foreground border border-transparent shadow-[4px_4px_0px_var(--foreground)] flex items-center justify-center mx-auto mb-8">
              <CheckCircle className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold font-mono tracking-tight mb-4 uppercase">Registration Successful</h2>
            <p className="text-muted-foreground font-mono uppercase tracking-widest text-xs">PROVISIONING NODE... REDIRECTING IN 2S</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden px-4 py-20 md:bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]">
      <div className="max-w-md w-full relative z-10">

        {/* Branding */}
        <div className="text-center mb-10 group cursor-default">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-sm bg-primary text-primary-foreground border border-transparent shadow-[3px_3px_0px_var(--foreground)] mb-6 group-hover:translate-x-1 group-hover:translate-y-1 group-hover:shadow-[1px_1px_0px_var(--foreground)] transition-all">
            <Globe className="w-6 h-6 animate-pulse" />
          </div>
          <h1 className="text-3xl font-bold font-mono tracking-tight mb-2">
            PROXY<span className="text-primary italic">HUB</span>
          </h1>
          <p className="text-muted-foreground text-xs font-mono uppercase tracking-[0.2em]">
            JOIN THE HIGH-TRUST PROTOCOL
          </p>
        </div>

        {/* Register Card */}
        <div className="card-retro p-8 md:p-10 bg-card">
          <h2 className="text-xl font-bold font-mono text-center mb-8 uppercase border-b-2 border-border pb-4 w-full">Initialize Account</h2>

          {error && (
            <div className="flex items-center gap-3 bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-sm mb-6 text-sm font-mono">
              <AlertCircle size={16} className="shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {/* Wallet Section */}
          <div className="mb-6 flex justify-center">
            <SolanaWalletButton />
          </div>

          {connected && publicKey && (
            <button
              type="button"
              onClick={async () => {
                setLoading(true);
                try {
                  await walletLogin(publicKey.toBase58(), { signMessage });
                  router.push('/dashboard');
                } catch (err: unknown) {
                  setError(getErrorMessage(err) || 'Wallet registration failed');
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
                  INITIALIZE VIA WALLET ({publicKey.toBase58().slice(0, 4)}...)
                  <ArrowRight size={16} className="ml-2" />
                </>
              )}
            </button>
          )}

          {/* OAuth Buttons */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            <button
              onClick={() => handleOAuthRegister('google')}
              className="btn-retro btn-retro-outline py-3 text-xs"
            >
              <Chrome className="w-4 h-4 mr-2" />
              GOOGLE
            </button>
            <button
              onClick={() => handleOAuthRegister('github')}
              className="btn-retro btn-retro-outline py-3 text-xs"
            >
              <Github className="w-4 h-4 mr-2" />
              GITHUB
            </button>
          </div>

          <div className="relative mb-8 text-center">
            <span className="bg-card px-2 text-xs font-mono text-muted-foreground relative z-10">OR PROTOCOL ACCESS</span>
            <div className="absolute inset-0 flex items-center top-[1px] -z-0">
              <div className="w-full border-t border-border"></div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Role Selection */}
            <div className="space-y-2">
              <label className="block text-xs font-mono font-bold uppercase text-muted-foreground">
                Operational Mode
              </label>
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setRole('buyer')}
                  className={`relative p-4 rounded-sm border-2 transition-all duration-200 text-left hover:-translate-y-1 ${role === 'buyer'
                    ? 'border-primary bg-primary/10 text-primary shadow-[4px_4px_0px_var(--primary)]'
                    : 'border-border bg-background text-muted-foreground hover:border-foreground hover:bg-accent'
                    }`}
                >
                  <ShoppingCart className={`w-5 h-5 mb-2 ${role === 'buyer' ? 'text-primary' : ''}`} />
                  <div className="font-bold text-xs font-mono uppercase tracking-widest">Consumer</div>
                  <div className="text-[10px] opacity-70 mt-1 uppercase font-mono">Acquire Assets</div>
                </button>
                <button
                  type="button"
                  onClick={() => setRole('provider')}
                  className={`relative p-4 rounded-sm border-2 transition-all duration-200 text-left hover:-translate-y-1 ${role === 'provider'
                    ? 'border-primary bg-primary/10 text-primary shadow-[4px_4px_0px_var(--primary)]'
                    : 'border-border bg-background text-muted-foreground hover:border-foreground hover:bg-accent'
                    }`}
                >
                  <Coins className={`w-5 h-5 mb-2 ${role === 'provider' ? 'text-primary' : ''}`} />
                  <div className="font-bold text-xs font-mono uppercase tracking-widest">Infrastructure</div>
                  <div className="text-[10px] opacity-70 mt-1 uppercase font-mono">Yield Bandwidth</div>
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="email" className="block text-xs font-mono font-bold uppercase text-muted-foreground">
                Email Assignment
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required={!connected}
                  className="w-full bg-background border border-input rounded-sm py-2 pl-10 pr-3 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-muted-foreground/50"
                  placeholder="USER@PROTOCOL.IO"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label htmlFor="password" className="block text-xs font-mono font-bold uppercase text-muted-foreground">
                  Encryption
                </label>
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
                    placeholder="KEY"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label htmlFor="confirmPassword" className="block text-xs font-mono font-bold uppercase text-muted-foreground">
                  Verification
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                  <input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required={!connected}
                    minLength={8}
                    className="w-full bg-background border border-input rounded-sm py-2 pl-10 pr-3 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-muted-foreground/50"
                    placeholder="VERIFY"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !!connected}
              className="w-full btn-retro btn-retro-primary py-3 text-sm"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  GENERATE IDENTITY
                  <ArrowRight size={16} className="ml-2" />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 text-center">
            <p className="text-muted-foreground text-xs font-mono">
              ALREADY ESTABLISHED?{' '}
              <Link href="/login" className="text-primary hover:underline font-bold">
                RE-LINK PROTOCOL
              </Link>
            </p>
          </div>
        </div>

        {/* Terms */}
        <p className="text-center text-muted-foreground/50 text-[10px] font-mono uppercase tracking-[0.25em] mt-8 max-w-xs mx-auto leading-relaxed">
          BY INITIALIZING IDENTITY, YOU CONSENT TO THE{' '}
          <Link href="#" className="text-primary hover:underline">NODE CHARTER</Link>
          {' '}AND{' '}
          <Link href="#" className="text-primary hover:underline">SIGNAL ORDINANCE</Link>.
        </p>
      </div>
    </div>
  );
}
