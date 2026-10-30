'use client';

import {
  Activity,
  ArrowRight,
  Link as LinkIcon,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import type { WalletResult } from '../types';
import { WalletResultBanner } from './WalletResultBanner';
import { shortWallet } from '@/components/UnlockWalletPrompt';

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
  const linked = wallet?.linked_solana_address?.trim() || '';

  return (
    <motion.div
      key="overview"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="space-y-8"
    >
      {isLocalSolanaRpc && (
        <div className="p-4 rounded-lg border border-warning/30 bg-warning/10 text-xs font-mono text-warning/90 leading-relaxed space-y-2">
          <p className="font-semibold text-warning">
            Local test network
          </p>
          <p>
            Platform balance is custodial. Linked wallet balance follows Phantom&apos;s RPC (
            <span className="text-warning">http://127.0.0.1:8899</span>).
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
          <div className="flex justify-between items-center mb-2">
            <p className="text-xs font-mono font-semibold text-primary">
              Platform balance
            </p>
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20">
              <TrendingUp size={14} className="text-primary" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground/70 mb-4 leading-relaxed">
            Custodial SOL for deposits, withdrawals, and platform ledger activity. Marketplace
            purchases don&apos;t use it.
          </p>
          <div className="text-5xl font-semibold font-mono tracking-tight flex items-center gap-3">
            {Number(wallet?.balance_sol ?? 0).toFixed(4)}
            <span className="text-xl opacity-40 font-semibold">SOL</span>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onGoToDeposit}
              className="btn-retro btn-retro-primary !px-4 !py-2 text-xs font-semibold"
            >
              Deposit
            </button>
            <button
              type="button"
              onClick={onGoToWithdraw}
              className="btn-retro btn-retro-outline !px-4 !py-2 text-xs font-semibold"
            >
              Withdraw
            </button>
          </div>
          <div className="mt-6 flex items-center gap-2 text-xs font-mono font-semibold text-success/80 bg-success/5 px-3 py-1.5 rounded-full border border-success/10 w-fit">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse"></span>
            {isLocalSolanaRpc
              ? 'Local ledger'
              : `Ledger · Solana ${isDevnet ? 'Devnet' : 'Mainnet'}`}
          </div>
        </motion.div>

        <motion.div
          whileHover={{ y: -5 }}
          className="glass-card p-8 border-success/20 bg-success/5 group relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:scale-110 group-hover:opacity-10 transition-all duration-500">
            <Wallet size={120} className="text-success" />
          </div>
          <div className="flex justify-between items-center mb-2">
            <p className="text-xs font-mono font-semibold text-success">
              Linked Solana wallet
            </p>
            <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center border border-success/20">
              <Wallet size={14} className="text-success" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground/70 mb-4 leading-relaxed">
            On-chain address for marketplace escrow, Access Pass mint, and withdrawals destination.
            {connected ? ' Browser wallet unlocked.' : ' Unlock in browser to sign.'}
          </p>
          {linked ? (
            <>
              <p className="font-mono text-sm text-foreground break-all">{shortWallet(linked, 6, 6)}</p>
              <div className="mt-4 text-3xl font-semibold font-mono tracking-tight flex items-center gap-3">
                {linkedWalletBalance !== null
                  ? `${Number(linkedWalletBalance).toFixed(4)}`
                  : 'Unavailable'}
                <span className="text-xl opacity-40 font-semibold">SOL</span>
              </div>
              <p className="text-xs font-mono text-muted-foreground/50 mt-2">
                On-chain balance · {isDevnet ? 'devnet' : 'mainnet'}
                {isLocalSolanaRpc ? ` · ${solanaRpcUrl}` : ''}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No address linked yet.</p>
          )}
          <div className="mt-6 flex items-center gap-2 text-xs font-mono font-semibold text-success/80 bg-success/5 px-3 py-1.5 rounded-full border border-success/10 w-fit">
            <Activity size={12} className="text-success" />
            {linked ? (connected ? 'Unlocked' : 'Linked · locked') : 'Not linked'}
          </div>
        </motion.div>
      </div>

      <div className="rounded-lg border border-border bg-secondary px-4 py-3 text-xs text-muted-foreground/80 leading-relaxed">
        <span className="font-semibold text-muted-foreground">Rails · </span>
        Primary path: marketplace buys fund <strong className="text-foreground">on-chain escrow</strong> from your{' '}
        <strong className="text-foreground">linked wallet</strong>. Platform deposit is optional (staking / referrals /
        dust). Withdraw moves platform balance back to the linked address.
      </div>

      {!wallet?.linked_solana_address && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-8 border-primary/30 bg-primary/5 flex flex-col md:flex-row items-center gap-6"
        >
          <div className="w-14 h-14 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <LinkIcon size={24} className="text-primary" />
          </div>
          <div className="flex-1 text-center md:text-left">
            <p className="text-xs font-semibold font-mono text-primary mb-1">
              Link a Solana address
            </p>
            <p className="text-xs font-mono text-muted-foreground/70 leading-relaxed">
              You&apos;re signed in. Link Phantom/Solflare so deposits, withdrawals, and marketplace
              escrow use your on-chain identity.
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            onClick={onGoToLinkedWallets}
            className="btn-retro shrink-0 !px-6 !py-3 glass-card border-primary/40 hover:border-primary text-xs font-semibold flex items-center gap-2"
          >
            <Zap size={12} className="text-primary" />
            Link address
            <ArrowRight size={12} />
          </motion.button>
        </motion.div>
      )}
    </motion.div>
  );
}
