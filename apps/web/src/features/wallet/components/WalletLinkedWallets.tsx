'use client';

import {
  ChevronRight,
  Copy,
  Link as LinkIcon,
  Loader2,
  Shield,
  X,
  Zap,
} from 'lucide-react';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import { SolanaWalletButton } from '@/components/SolanaWalletButton';
import type { WalletResult } from '../types';
import { WalletResultBanner } from './WalletResultBanner';

type WalletLike = {
  linked_solana_address?: string | null;
} | null | undefined;

type WithdrawalSecurityLike = {
  withdrawal_cooldown_active?: boolean;
  withdrawal_cooldown_until?: string | null;
  primary_withdrawal_address?: string | null;
} | null | undefined;

type WalletLinkedWalletsProps = {
  wallet: WalletLike;
  connected: boolean;
  processing: boolean;
  onChainHint: ReactNode;
  onCopyLinkedAddress: () => void;
  onUnlink: () => void;
  onDisconnect: () => void;
  onLink: () => void;
  withdrawalSecurity: WithdrawalSecurityLike;
  result: WalletResult | null;
};

export function WalletLinkedWallets({
  wallet,
  connected,
  processing,
  onChainHint,
  onCopyLinkedAddress,
  onUnlink,
  onDisconnect,
  onLink,
  withdrawalSecurity,
  result,
}: WalletLinkedWalletsProps) {
  return (
    <motion.div
      key="linked"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="space-y-8"
    >
      <GlassCard className="!p-8 bg-secondary border-border shadow-sm">
        <h3 className="text-xs font-semibold font-mono mb-8 flex items-center gap-3">
          <LinkIcon size={18} className="text-primary animate-pulse" /> Cryptographic Identity
          Mapping
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="p-8 glass-card border-border bg-secondary rounded-lg group relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
              <Zap size={64} className="text-primary" />
            </div>
            <div className="flex justify-between items-start mb-8">
              <div className="p-4 bg-primary/10 rounded-lg border border-primary/20 group-hover:scale-110 transition-transform shadow-sm">
                <Zap className="text-primary" />
              </div>
              <span className="text-xs font-semibold font-mono opacity-20">
                Solana Network
              </span>
            </div>
            {wallet?.linked_solana_address ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-success"></div>
                  <p className="text-xs font-semibold font-mono text-success">
                    Identity Verified
                  </p>
                </div>
                <div className="flex gap-2 items-stretch">
                  <code className="flex-1 text-xs font-mono font-semibold break-all bg-secondary p-4 border border-border rounded-lg shadow-inner text-primary/80">
                    {wallet.linked_solana_address}
                  </code>
                  <button
                    type="button"
                    onClick={onCopyLinkedAddress}
                    className="px-3 rounded-lg border border-border hover:border-primary/40 text-muted-foreground hover:text-primary transition-colors shrink-0"
                    title="Copy linked address"
                  >
                    <Copy size={14} />
                  </button>
                </div>
                {onChainHint}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onUnlink}
                  disabled={processing}
                  className="w-full p-2 bg-destructive/5 border border-destructive/20 hover:bg-destructive/10 text-destructive text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-2"
                >
                  {processing ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <X size={12} />
                  )}
                  Unlink Verified Identity
                </motion.button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex flex-col gap-4">
                  <SolanaWalletButton />
                  {connected && (
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={onDisconnect}
                      className="w-full p-2 bg-secondary border border-border hover:border-destructive/50 text-destructive text-xs font-semibold rounded-lg transition-all"
                    >
                      Terminate Session
                    </motion.button>
                  )}
                </div>
                {connected && (
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={onLink}
                    disabled={processing}
                    className="w-full btn-retro !p-4 glass-card border-primary/40 hover:border-primary text-xs font-semibold shadow-sm flex items-center justify-center gap-2"
                  >
                    {processing ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                    {processing ? 'Signing Payload...' : 'Verify Cryptographic Ownership'}
                  </motion.button>
                )}
              </div>
            )}
          </div>
        </div>
      </GlassCard>

      <GlassCard className="!p-8 bg-secondary border-border">
        <h3 className="text-xs font-semibold font-mono mb-4 flex items-center gap-3">
          <Shield size={18} className="text-primary" /> Withdrawal destination
        </h3>
        <p className="text-xs font-mono text-muted-foreground/70 mb-4 leading-relaxed">
          Withdrawals are pinned to your linked primary wallet. Changing it requires a fresh
          wallet signature and starts a 24h cooldown before withdrawals resume.
        </p>
        {withdrawalSecurity?.withdrawal_cooldown_active && (
          <p className="text-xs font-mono text-warning mb-4">
            Cooldown active until{' '}
            {withdrawalSecurity.withdrawal_cooldown_until
              ? new Date(withdrawalSecurity.withdrawal_cooldown_until).toLocaleString()
              : '24h after address change'}
          </p>
        )}
        {withdrawalSecurity?.primary_withdrawal_address && (
          <p className="text-xs font-mono text-primary/80 mb-3 break-all">
            Primary: {withdrawalSecurity.primary_withdrawal_address}
          </p>
        )}
      </GlassCard>

      {result && <WalletResultBanner result={result} variant="linked" />}
    </motion.div>
  );
}
