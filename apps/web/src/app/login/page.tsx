'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { createClient } from '@/lib/supabase/client';
import { Mail, Lock, Globe, ArrowRight, Github, Chrome, AlertCircle, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
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
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OAuth login failed');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#050505] relative overflow-hidden px-4 selection:bg-primary/30">
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
            Ghana&apos;s Premium Infrastructure
          </p>
        </div>

        {/* Login Card */}
        <div className="relative group/card">
          <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent"></div>
          <div className="p-10 rounded-[2.5rem] bg-white/[0.03] backdrop-blur-3xl border border-white/5 shadow-2xl relative overflow-hidden group-hover/card:border-white/10 transition-colors duration-500">
            <div className="relative z-10">
              <h2 className="text-2xl font-black text-white tracking-tight mb-8 uppercase italic">Identity Verification</h2>

              {error && (
                <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 text-red-400 px-5 py-4 rounded-2xl mb-8 animate-in shake duration-500">
                  <AlertCircle size={20} className="shrink-0" />
                  <p className="text-sm font-bold">{error}</p>
                </div>
              )}

              {/* OAuth Buttons */}
              <div className="grid grid-cols-2 gap-4 mb-8">
                <button
                  onClick={() => handleOAuthLogin('google')}
                  className="flex items-center justify-center gap-3 px-6 py-4 rounded-2xl bg-white/[0.05] border border-white/10 text-white font-black uppercase tracking-widest text-[10px] hover:bg-white/[0.1] hover:border-white/20 transition-all active:scale-95 group"
                >
                  <Chrome className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
                  Google
                </button>
                <button
                  onClick={() => handleOAuthLogin('github')}
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
                  <span className="px-4 bg-[#0a0a0a] rounded-full">Secure Override</span>
                </div>
              </div>

              <form onSubmit={handleCredentialsSubmit} className="space-y-6">
                <div className="space-y-3">
                  <label htmlFor="email" className="block text-[10px] font-black uppercase tracking-[0.3em] text-white/40 ml-1">
                    Node Identifier
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

                <div className="space-y-3">
                  <div className="flex items-center justify-between ml-1">
                    <label htmlFor="password" className="block text-[10px] font-black uppercase tracking-[0.3em] text-white/40">
                      Encryption Key
                    </label>
                    <Link href="/forgot-password" className="text-[10px] font-black text-primary hover:underline uppercase tracking-widest">
                      Reset
                    </Link>
                  </div>
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
                      placeholder="••••••••"
                    />
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
                      <span>Establish Connection</span>
                      <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>
              </form>

              <div className="mt-10 text-center">
                <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">
                  Not on the grid?{' '}
                  <Link href="/register" className="text-primary hover:underline italic ml-1">
                    Request Credentials
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-12 text-center space-y-4">
          <p className="text-white/20 text-[10px] font-black uppercase tracking-[0.4em]">
            © 2026 ProxyHub Protocol. Authorized Access Only.
          </p>
          <div className="flex items-center justify-center gap-6 opacity-30 grayscale hover:grayscale-0 transition-all duration-700">
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center font-black text-[10px] text-white">PH</div>
            <div className="w-24 h-px bg-white/10"></div>
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center font-black text-[10px] text-white italic">GW</div>
          </div>
        </div>
      </div>
    </div>
  );
}

