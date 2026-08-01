'use client';

import { Activity, Shield, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

type WalletSidebarProps = {
  balanceSol: number;
  linkedAddress: string | null | undefined;
};

export function WalletSidebar({ balanceSol, linkedAddress }: WalletSidebarProps) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 20 },
        show: { opacity: 1, y: 0 },
      }}
      className="lg:col-span-4 space-y-8"
    >
      <div className="glass-card p-8 border-white/10 bg-white/2 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 -mr-16 -mt-16 rounded-full blur-3xl"></div>
        <h3 className="text-xs font-black font-mono uppercase mb-8 flex items-center gap-3 tracking-widest relative z-10">
          <Activity size={16} className="text-primary/70" /> System Solvency
        </h3>
        <div className="space-y-8 relative z-10">
          <div className="space-y-2">
            <div className="flex justify-between text-[10px] font-black font-mono uppercase tracking-[0.2em] opacity-40">
              <span>Treasury Liquidity</span>
              <span className="text-primary">{balanceSol ? 'Optimal' : 'Checking...'}</span>
            </div>
            <div className="h-2 bg-white/5 rounded-full overflow-hidden border border-white/5">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: balanceSol ? '100%' : '30%' }}
                transition={{ duration: 1.5 }}
                className="h-full bg-gradient-to-r from-primary to-emerald-400"
              />
            </div>
          </div>

          <div className="p-6 glass-card bg-white/5 border-white/10 rounded-2xl group transition-all hover:bg-white/10">
            <p className="text-[10px] font-black font-mono text-muted-foreground uppercase mb-2 tracking-widest opacity-50">
              Estimated ROI (L2 Streaming)
            </p>
            <div className="text-2xl font-black font-mono text-emerald-500 flex items-baseline gap-1">
              + 0.000000 SOL
            </div>
            <div className="mt-4 h-0.5 bg-emerald-500/20 w-full overflow-hidden rounded-full">
              <div className="h-full w-full bg-emerald-500/10" />
            </div>
          </div>

          <div className="p-6 glass-card bg-white/5 border-white/10 rounded-2xl">
            <p className="text-[10px] font-black font-mono text-muted-foreground uppercase mb-2 tracking-widest opacity-50">
              Active SOL Collateral
            </p>
            <p className="text-2xl font-black font-mono text-foreground tracking-tighter">
              {Number(balanceSol ?? 0).toFixed(4)} SOL
            </p>
          </div>
        </div>
      </div>

      <div className="glass-card p-8 border-primary/20 bg-primary/2 overflow-hidden relative">
        <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-primary/10 rounded-full blur-3xl"></div>
        <h3 className="text-xs font-black font-mono uppercase mb-6 flex items-center gap-3 tracking-widest relative z-10">
          <Zap size={16} className="text-primary" /> Network Pulse
        </h3>
        <div className="space-y-6 relative z-10">
          <div className="flex justify-between items-center text-[10px] font-black font-mono uppercase tracking-widest">
            <span className="text-muted-foreground/60 italic font-medium">Session Segment</span>
            <span className="bg-secondary/50 px-2 py-1 rounded text-primary border border-primary/10">
              {linkedAddress
                ? `${linkedAddress.slice(0, 4)}...${linkedAddress.slice(-4)}`
                : 'IDLE_INIT'}
            </span>
          </div>
          <div className="flex justify-between items-end border-b border-white/5 pb-4">
            <span className="text-[10px] font-black font-mono text-muted-foreground uppercase tracking-widest opacity-40">
              SOL Balance
            </span>
            <span className="text-2xl font-black font-mono tracking-tighter">
              {Number(balanceSol ?? 0).toFixed(4)} SOL
            </span>
          </div>
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  linkedAddress ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground opacity-30'
                }`}
              ></div>
              <span className="text-[10px] font-black font-mono text-muted-foreground uppercase tracking-widest opacity-40">
                Throughput
              </span>
            </div>
            <span className="text-xs font-black font-mono text-emerald-500">
              {linkedAddress ? 'ACTIVE' : 'OFFLINE'}
            </span>
          </div>
        </div>
      </div>

      <motion.div
        whileHover={{ scale: 1.02 }}
        className="glass-card p-6 border-emerald-500/20 bg-emerald-500/5 cursor-default"
      >
        <div className="flex items-center gap-3 mb-4">
          <Shield className="text-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]" size={18} />
          <span className="text-[10px] font-black font-mono uppercase text-emerald-500 tracking-[0.2em]">
            Sentinel Protocol
          </span>
        </div>
        <p className="text-[10px] font-mono text-emerald-500/70 leading-relaxed uppercase font-bold">
          Monitoring treasury audit trails. Multi-signature consensus active. System synchronized.
        </p>
      </motion.div>
    </motion.div>
  );
}
