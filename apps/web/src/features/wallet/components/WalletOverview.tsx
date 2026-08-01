'use client';

import {
  Activity,
  ArrowRight,
  Coins,
  Link as LinkIcon,
  ShieldCheck,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { formatSOL } from '../utils';
import type { WalletResult } from '../types';
import { WalletResultBanner } from './WalletResultBanner';

type WalletLike = {
  balance_sol?: number | string | null;
  linked_solana_address?: string | null;
} | null | undefined;

type WalletOverviewProps = {
  wallet: WalletLike;
  linkedWalletBalance: number | null;
  connected: boolean;
  isLocalSolanaRpc: boolean;
  isDevnet: boolean;
  solanaRpcUrl: string;
  localRpcHint?: ReactNode;
  onGoToLinkedWallets: () => void;
  onGoToDeposit: () => void;
  onGoToWithdraw: () => void;
  result: WalletResult | null;
};

export function WalletOverview({
  wallet,
  linkedWalletBalance,
  connected,
  isLocalSolanaRpc,
  isDevnet,
  solanaRpcUrl,
  localRpcHint,
  onGoToLinkedWallets,
  onGoToDeposit,
  onGoToWithdraw,
  result,
}: WalletOverviewProps) {
  return (
    <motion.div
      key="overview"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="space-y-8"
    >
      {isLocalSolanaRpc && (
        <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-[10px] font-mono text-amber-100/90 leading-relaxed space-y-2">
          <p className="font-black uppercase tracking-widest text-amber-400">
            Local validator — not public devnet
          </p>
          <p>
            Payouts go to your linked wallet on{' '}
            <span className="text-amber-300">http://127.0.0.1:8899</span> only. Phantom must use
            the same custom RPC or you will not see withdrawn SOL (the app balance here is
            custodial; linked wallet balance follows Phantom&apos;s network).
          </p>
          <p className="text-amber-200/70">
            Phantom → Settings → Developer → enable testnet → select{' '}
            <span className="text-amber-300">Solana Localnet</span>
            {' '}
            (same chain as <span className="text-amber-300">{solanaRpcUrl}</span>).
          </p>
          {localRpcHint}
        </div>
      )}

      {result && <WalletResultBanner result={result} variant="overview" />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <motion.div
          whileHover={{ y: -5 }}
          className="glass-card p-8 border-primary/20 bg-primary/5 group relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:scale-110 group-hover:opacity-10 transition-all duration-500">
            <Zap size={120} className="text-primary" />
          </div>
          <div className="flex justify-between items-center mb-6">
            <p className="text-[10px] font-mono font-black text-primary uppercase tracking-[0.2em]">
              Solana Native Access
            </p>
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20">
              <TrendingUp size={14} className="text-primary" />
            </div>
          </div>
          <div className="text-5xl font-black font-mono tracking-tighter flex items-center gap-3">
            {Number(wallet?.balance_sol ?? 0).toFixed(4)}
            <span className="text-xl opacity-40 font-black">SOL</span>
          </div>

          {linkedWalletBalance !== null && (
            <div className="mt-4 p-3 bg-white/5 rounded-xl border border-white/5 flex justify-between items-center">
              <span className="text-[9px] font-mono font-black text-muted-foreground uppercase opacity-40">
                {connected ? 'Connected Wallet' : 'Linked Wallet'} Balance
              </span>
              <span className="text-xs font-black font-mono text-primary">
                {Number(linkedWalletBalance || 0).toFixed(4)} SOL
              </span>
            </div>
          )}

          <div className="mt-8 flex items-center gap-2 text-[9px] font-mono font-black text-emerald-500/80 bg-emerald-500/5 px-3 py-1.5 rounded-full border border-emerald-500/10 w-fit uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            {isLocalSolanaRpc
              ? 'Local validator: synced'
              : `Solana ${isDevnet ? 'Devnet' : 'Mainnet'}: synced`}
          </div>
        </motion.div>

        <motion.div
          whileHover={{ y: -5 }}
          className="glass-card p-8 border-emerald-500/20 bg-emerald-500/5 group relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:scale-110 group-hover:opacity-10 transition-all duration-500">
            <Coins size={120} className="text-emerald-500" />
          </div>
          <div className="flex justify-between items-center mb-6">
            <p className="text-[10px] font-mono font-black text-emerald-500 uppercase tracking-[0.2em]">
              SOL Settlement
            </p>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
              <ShieldCheck size={14} className="text-emerald-500" />
            </div>
          </div>
          <div className="text-3xl md:text-5xl font-black font-mono tracking-tighter flex items-center gap-3">
            {formatSOL(Number(wallet?.balance_sol || 0))} SOL
          </div>
          <div className="mt-8 flex items-center gap-2 text-[9px] font-mono font-black text-emerald-500/80 bg-emerald-500/5 px-3 py-1.5 rounded-full border border-emerald-500/10 w-fit uppercase tracking-widest">
            <Activity size={12} className="text-emerald-500" />
            SOL Only System
          </div>
        </motion.div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onGoToDeposit}
          className="btn-retro btn-retro-primary !px-5 !py-2.5 text-[10px] uppercase font-black tracking-widest"
        >
          Deposit
        </button>
        <button
          type="button"
          onClick={onGoToWithdraw}
          className="btn-retro btn-retro-outline !px-5 !py-2.5 text-[10px] uppercase font-black tracking-widest"
        >
          Withdraw
        </button>
      </div>

      {!wallet?.linked_solana_address && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-8 border-primary/30 bg-primary/5 flex flex-col md:flex-row items-center gap-6"
        >
          <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <LinkIcon size={24} className="text-primary" />
          </div>
          <div className="flex-1 text-center md:text-left">
            <p className="text-xs font-black font-mono uppercase tracking-widest text-primary mb-1">
              Connect Your Solana Wallet
            </p>
            <p className="text-[10px] font-mono text-muted-foreground/70 leading-relaxed">
              Link a Solana wallet (Phantom, Solflare, etc.) to deposit SOL, withdraw earnings, and
              verify your on-chain identity.
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            onClick={onGoToLinkedWallets}
            className="btn-retro shrink-0 !px-6 !py-3 glass-card border-primary/40 hover:border-primary text-[10px] uppercase font-black tracking-widest flex items-center gap-2"
          >
            <Zap size={12} className="text-primary" />
            Link Wallet
            <ArrowRight size={12} />
          </motion.button>
        </motion.div>
      )}
    </motion.div>
  );
}
