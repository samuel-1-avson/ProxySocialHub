'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useWallet } from '@solana/wallet-adapter-react';
import { SolanaWalletButton } from '@/components/SolanaWalletButton';
import { ArrowRight, AlertCircle, Loader2, Wallet, Shield, Zap } from 'lucide-react';
import { getErrorMessage } from '@/lib/utils';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { walletLogin } = useAuth();
  const { connected, publicKey, signMessage } = useWallet();
  const router = useRouter();

  const handleWalletLogin = async () => {
    if (!publicKey || !signMessage) return;

    setLoading(true);
    setError('');
    try {
      await walletLogin(publicKey.toBase58(), { signMessage });
      router.push('/dashboard');
      router.refresh();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Wallet login failed');
    } finally {
      setLoading(false);
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
            DECENTRALIZED_ACCESS_PROTOCOL
          </p>
        </div>

        {/* Login Card */}
        <div className="card-retro p-8 md:p-10 bg-card">
          <h2 className="text-xl font-bold font-mono text-center mb-8 uppercase border-b-2 border-border pb-4 w-full">Connect Wallet</h2>

          {error && (
            <div className="flex items-center gap-3 bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-sm mb-6 text-sm font-mono">
              <AlertCircle size={16} className="shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {/* Wallet Connect Button */}
          <div className="mb-6 flex justify-center">
            <SolanaWalletButton />
          </div>

          {/* Verify Identity (appears after wallet is connected) */}
          {connected && publicKey && (
            <button
              type="button"
              onClick={handleWalletLogin}
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

          {!connected && (
            <p className="text-center text-muted-foreground text-xs font-mono uppercase tracking-wider mt-4">
              Connect your Solana wallet to get started
            </p>
          )}

          {/* Features */}
          <div className="mt-8 pt-6 border-t border-border space-y-3">
            <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground">
              <Wallet size={14} className="text-primary shrink-0" />
              <span>PHANTOM &bull; SOLFLARE &bull; BACKPACK &bull; ANY SOL WALLET</span>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground">
              <Shield size={14} className="text-primary shrink-0" />
              <span>NO PASSWORDS &bull; NO EMAILS &bull; SELF-CUSTODIAL</span>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground">
              <Zap size={14} className="text-primary shrink-0" />
              <span>INSTANT ACCESS &bull; AUTO-REGISTRATION ON FIRST LOGIN</span>
            </div>
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
