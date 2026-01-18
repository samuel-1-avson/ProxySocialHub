'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { createClient } from '@/lib/supabase/client';
import { CheckCircle, Globe, ShoppingCart, Coins, Mail, Lock, ArrowRight, Github, Chrome, AlertCircle, Loader2, Sparkles } from 'lucide-react';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<'buyer' | 'provider'>('buyer');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  const handleOAuthRegister = async (provider: 'google' | 'github') => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
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
      <div className="min-h-screen flex items-center justify-center bg-[#050505] relative overflow-hidden px-4">
        {/* Dynamic Background Elements */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:32px_32px] z-0"></div>
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/10 rounded-full blur-[120px] pointer-events-none animate-pulse"></div>

        <div className="max-w-md w-full relative z-10 text-center animate-in zoom-in-95 duration-700">
          <div className="bg-white/[0.03] backdrop-blur-3xl border border-primary/20 p-12 rounded-[3rem] shadow-2xl">
            <div className="w-20 h-20 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center mx-auto mb-8 shadow-[0_0_30px_rgba(34,197,94,0.3)] animate-bounce-subtle">
              <CheckCircle className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-3xl font-black text-white tracking-tighter mb-4 uppercase italic">Registration Successful</h2>
            <p className="text-muted-foreground font-bold uppercase tracking-widest text-[10px] opacity-60">Provisioning your node... Redirecting in 2s</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#050505] relative overflow-hidden px-4 py-20 selection:bg-primary/30">
      {/* Dynamic Background Elements */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:32px_32px] z-0"></div>
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/10 rounded-full blur-[120px] pointer-events-none animate-pulse"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="max-w-md w-full relative z-10 animate-in fade-in slide-in-from-bottom-8 duration-1000">
        {/* Branding */}
        <div className="text-center mb-10 group">
          <div className="inline-flex items-center justify-center p-4 rounded-3xl bg-primary/10 border border-primary/20 mb-6 group-hover:scale-110 transition-transform duration-500 shadow-[0_0_30px_rgba(34,197,94,0.2)]">
            <Globe className="w-10 h-10 text-primary animate-pulse" />
          </div>
          <h1 className="text-5xl font-black text-white tracking-tighter mb-2">
            Proxy<span className="text-primary italic">Hub</span>
          </h1>
          <p className="text-muted-foreground text-sm font-bold uppercase tracking-[0.3em] opacity-60">
            Join the High-Trust Protocol
          </p>
        </div>

        {/* Register Card */}
        <div className="relative group/card">
          <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent"></div>
          <div className="p-10 rounded-[2.5rem] bg-white/[0.03] backdrop-blur-3xl border border-white/5 shadow-2xl relative overflow-hidden group-hover/card:border-white/10 transition-colors duration-500">
            <div className="relative z-10">
              <h2 className="text-2xl font-black text-white tracking-tight mb-8 uppercase italic">Initialize Account</h2>

              {error && (
                <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 text-red-400 px-5 py-4 rounded-2xl mb-8 animate-in shake duration-500">
                  <AlertCircle size={20} className="shrink-0" />
                  <p className="text-sm font-bold">{error}</p>
                </div>
              )}

              {/* OAuth Buttons */}
              <div className="grid grid-cols-2 gap-4 mb-8">
                <button
                  onClick={() => handleOAuthRegister('google')}
                  className="flex items-center justify-center gap-3 px-6 py-4 rounded-2xl bg-white/[0.05] border border-white/10 text-white font-black uppercase tracking-widest text-[10px] hover:bg-white/[0.1] hover:border-white/20 transition-all active:scale-95 group"
                >
                  <Chrome className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
                  Google
                </button>
                <button
                  onClick={() => handleOAuthRegister('github')}
                  className="flex items-center justify-center gap-3 px-6 py-4 rounded-2xl bg-white/[0.05] border border-white/10 text-white font-black uppercase tracking-widest text-[10px] hover:bg-white/[0.1] hover:border-white/20 transition-all active:scale-95 group"
                >
                  <Github className="w-4 h-4 text-white group-hover:scale-110 transition-transform" />
                  GitHub
                </button>
              </div>

              <div className="relative mb-8">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/5"></div>
                </div>
                <div className="relative flex justify-center text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
                  <span className="px-4 bg-[#0a0a0a] rounded-full">Protocol Access</span>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-8">
                {/* Role Selection */}
                <div className="space-y-4">
                  <label className="block text-[10px] font-black uppercase tracking-[0.3em] text-white/40 ml-1">
                    Operational Mode
                  </label>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      type="button"
                      onClick={() => setRole('buyer')}
                      className={`relative p-6 rounded-2xl border transition-all duration-300 text-left overflow-hidden group/role ${role === 'buyer'
                        ? 'border-primary bg-primary/10 text-primary shadow-[0_0_20px_rgba(34,197,94,0.1)]'
                        : 'border-white/5 bg-white/[0.02] text-muted-foreground hover:border-white/20 hover:bg-white/[0.05]'
                        }`}
                    >
                      <ShoppingCart className={`w-6 h-6 mb-3 transition-transform ${role === 'buyer' ? 'scale-110 text-primary' : 'group-hover/role:scale-110'}`} />
                      <div className="font-black text-xs uppercase tracking-widest">Consumer</div>
                      <div className="text-[9px] font-bold opacity-50 mt-1 uppercase">Acquire Assets</div>
                      {role === 'buyer' && <Sparkles className="absolute top-2 right-2 w-3 h-3 animate-pulse" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole('provider')}
                      className={`relative p-6 rounded-2xl border transition-all duration-300 text-left overflow-hidden group/role ${role === 'provider'
                        ? 'border-primary bg-primary/10 text-primary shadow-[0_0_20px_rgba(34,197,94,0.1)]'
                        : 'border-white/5 bg-white/[0.02] text-muted-foreground hover:border-white/20 hover:bg-white/[0.05]'
                        }`}
                    >
                      <Coins className={`w-6 h-6 mb-3 transition-transform ${role === 'provider' ? 'scale-110 text-primary' : 'group-hover/role:scale-110'}`} />
                      <div className="font-black text-xs uppercase tracking-widest">Infrastructure</div>
                      <div className="text-[9px] font-bold opacity-50 mt-1 uppercase">Yield Bandwidth</div>
                      {role === 'provider' && <Sparkles className="absolute top-2 right-2 w-3 h-3 animate-pulse" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <label htmlFor="email" className="block text-[10px] font-black uppercase tracking-[0.3em] text-white/40 ml-1">
                    Email Assignment
                  </label>
                  <div className="relative group/input">
                    <Mail className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within/input:text-primary transition-colors" size={18} />
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full bg-black/20 border border-white/5 rounded-2xl py-4 pl-14 pr-6 text-sm font-bold text-white outline-none focus:border-primary/50 transition-all placeholder:text-white/10"
                      placeholder="you@protocol.io"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <label htmlFor="password" className="block text-[10px] font-black uppercase tracking-[0.3em] text-white/40 ml-1">
                      Encryption
                    </label>
                    <div className="relative group/input">
                      <Lock className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within/input:text-primary transition-colors" size={18} />
                      <input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={8}
                        className="w-full bg-black/20 border border-white/5 rounded-2xl py-4 pl-14 pr-6 text-sm font-bold text-white outline-none focus:border-primary/50 transition-all placeholder:text-white/10"
                        placeholder="Key"
                      />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <label htmlFor="confirmPassword" className="block text-[10px] font-black uppercase tracking-[0.3em] text-white/40 ml-1">
                      Verification
                    </label>
                    <div className="relative group/input">
                      <Lock className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within/input:text-primary transition-colors" size={18} />
                      <input
                        id="confirmPassword"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        minLength={8}
                        className="w-full bg-black/20 border border-white/5 rounded-2xl py-4 pl-14 pr-6 text-sm font-bold text-white outline-none focus:border-primary/50 transition-all placeholder:text-white/10"
                        placeholder="Verify"
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full group relative flex items-center justify-center gap-3 px-8 py-5 rounded-3xl bg-primary text-black font-black uppercase tracking-[0.2em] text-xs hover:scale-[1.02] active:scale-95 transition-all shadow-[0_20px_40px_-10px_rgba(34,197,94,0.3)] disabled:opacity-50 disabled:hover:scale-100"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <span>Generate Identity</span>
                      <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>
              </form>

              <div className="mt-10 text-center">
                <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">
                  Already established?{' '}
                  <Link href="/login" className="text-primary hover:underline italic ml-1">
                    Re-link Protocol
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Terms */}
        <p className="text-center text-white/20 text-[9px] font-black uppercase tracking-[0.25em] mt-10 max-w-xs mx-auto leading-relaxed">
          By initializing identity, you consent to the{' '}
          <a href="#" className="text-primary hover:underline">Node Charter</a>
          {' '}and{' '}
          <a href="#" className="text-primary hover:underline">Signal Ordinance</a>.
        </p>
      </div>
    </div>
  );
}
