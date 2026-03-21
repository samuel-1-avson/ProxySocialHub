'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useWallet } from '@solana/wallet-adapter-react';
import { SolanaWalletButton } from '@/components/SolanaWalletButton';
import { Globe, ArrowRight, AlertCircle, Loader2, Wallet, ShoppingCart, Coins } from 'lucide-react';
import { getErrorMessage } from '@/lib/utils';
import Link from 'next/link';

export default function RegisterPage() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { walletLogin } = useAuth();
  const { connected, publicKey, signMessage } = useWallet();
  const router = useRouter();

  const handleWalletRegister = async () => {
    if (!publicKey || !signMessage) return;

    setLoading(true);
    setError('');
    try {
      await walletLogin(publicKey.toBase58(), { signMessage });
      router.push('/dashboard');
      router.refresh();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Wallet registration failed');
    } finally {
      setLoading(false);
    }
  };

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
            JOIN THE DECENTRALIZED PROTOCOL
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

          {/* How it works */}
          <div className="mb-6 space-y-3">
            <div className="flex items-center gap-3 p-3 border border-border rounded-sm bg-background">
              <div className="w-6 h-6 rounded-sm bg-primary/10 flex items-center justify-center text-primary font-bold text-xs font-mono shrink-0">1</div>
              <span className="text-xs font-mono text-muted-foreground uppercase">Connect your Solana wallet</span>
            </div>
            <div className="flex items-center gap-3 p-3 border border-border rounded-sm bg-background">
              <div className="w-6 h-6 rounded-sm bg-primary/10 flex items-center justify-center text-primary font-bold text-xs font-mono shrink-0">2</div>
              <span className="text-xs font-mono text-muted-foreground uppercase">Sign the verification message</span>
            </div>
            <div className="flex items-center gap-3 p-3 border border-border rounded-sm bg-background">
              <div className="w-6 h-6 rounded-sm bg-primary/10 flex items-center justify-center text-primary font-bold text-xs font-mono shrink-0">3</div>
              <span className="text-xs font-mono text-muted-foreground uppercase">Your account is created instantly</span>
            </div>
          </div>

          {/* Wallet Connect Button */}
          <div className="mb-6 flex justify-center">
            <SolanaWalletButton />
          </div>

          {connected && publicKey && (
            <button
              type="button"
              onClick={handleWalletRegister}
              disabled={loading}
              className="w-full btn-retro btn-retro-primary py-3 text-sm mb-6"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  INITIALIZE VIA WALLET ({publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)})
                  <ArrowRight size={16} className="ml-2" />
                </>
              )}
            </button>
          )}

          {/* Role Info */}
          <div className="mt-6 pt-6 border-t border-border">
            <p className="text-xs font-mono font-bold uppercase text-muted-foreground mb-3 text-center">Choose your path after registration</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-sm border border-border bg-background text-center">
                <ShoppingCart className="w-5 h-5 mx-auto mb-2 text-primary" />
                <div className="font-bold text-xs font-mono uppercase tracking-widest">Consumer</div>
                <div className="text-[10px] opacity-70 mt-1 uppercase font-mono">Acquire Proxies</div>
              </div>
              <div className="p-4 rounded-sm border border-border bg-background text-center">
                <Coins className="w-5 h-5 mx-auto mb-2 text-primary" />
                <div className="font-bold text-xs font-mono uppercase tracking-widest">Provider</div>
                <div className="text-[10px] opacity-70 mt-1 uppercase font-mono">Earn From Bandwidth</div>
              </div>
            </div>
          </div>

          <div className="mt-8 text-center">
            <p className="text-muted-foreground text-xs font-mono">
              ALREADY HAVE AN ACCOUNT?{' '}
              <Link href="/login" className="text-primary hover:underline font-bold">
                CONNECT & LOGIN
              </Link>
            </p>
          </div>
        </div>

        {/* Terms */}
        <p className="text-center text-muted-foreground/50 text-[10px] font-mono uppercase tracking-[0.25em] mt-8 max-w-xs mx-auto leading-relaxed">
          BY CONNECTING YOUR WALLET, YOU CONSENT TO THE{' '}
          <Link href="#" className="text-primary hover:underline">NODE CHARTER</Link>
          {' '}AND{' '}
          <Link href="#" className="text-primary hover:underline">SIGNAL ORDINANCE</Link>.
        </p>
      </div>
    </div>
  );
}
