'use client';

import dynamic from 'next/dynamic';
import { Wallet, Shield, Zap } from 'lucide-react';

const WalletAuthPanel = dynamic(
  () => import('@/components/WalletAuthPanel').then((mod) => mod.WalletAuthPanel),
  {
    ssr: false,
    loading: () => (
      <div className="mb-6 flex min-h-[132px] items-center justify-center rounded-sm border border-border bg-background text-center text-xs font-mono uppercase tracking-wider text-muted-foreground">
        Initializing wallet access...
      </div>
    ),
  }
);

export default function LoginPage() {
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

          <WalletAuthPanel
            mode="login"
            actionLabel="VERIFY IDENTITY"
            idleMessage="Connect your Solana wallet to get started"
          />

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
