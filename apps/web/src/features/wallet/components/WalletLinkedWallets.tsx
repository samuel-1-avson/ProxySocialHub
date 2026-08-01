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
  whitelistDraft: string;
  onWhitelistDraftChange: (value: string) => void;
  whitelistSaving: boolean;
  onSaveWhitelist: () => void;
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
  whitelistDraft,
  onWhitelistDraftChange,
  whitelistSaving,
  onSaveWhitelist,
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
      <GlassCard className="!p-8 bg-white/2 border-white/5 shadow-2xl">
        <h3 className="text-xs font-black font-mono uppercase mb-8 flex items-center gap-3 tracking-[0.2em]">
          <LinkIcon size={18} className="text-primary animate-pulse" /> Cryptographic Identity
          Mapping
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="p-8 glass-card border-white/5 bg-white/5 rounded-2xl group relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
              <Zap size={64} className="text-purple-500" />
            </div>
            <div className="flex justify-between items-start mb-8">
              <div className="p-4 bg-purple-500/10 rounded-xl border border-purple-500/20 group-hover:scale-110 transition-transform shadow-lg">
                <Zap className="text-purple-500" />
              </div>
              <span className="text-[10px] font-black font-mono opacity-20 uppercase tracking-widest">
                Solana Network
              </span>
            </div>
            {wallet?.linked_solana_address ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,1)]"></div>
                  <p className="text-[10px] font-black font-mono text-emerald-500 uppercase tracking-widest">
                    Identity Verified
                  </p>
                </div>
                <div className="flex gap-2 items-stretch">
                  <code className="flex-1 text-[11px] font-mono font-black break-all bg-black/40 p-4 border border-white/5 rounded-xl shadow-inner text-primary/80">
                    {wallet.linked_solana_address}
                  </code>
                  <button
                    type="button"
                    onClick={onCopyLinkedAddress}
                    className="px-3 rounded-xl border border-white/10 hover:border-primary/40 text-muted-foreground hover:text-primary transition-colors shrink-0"
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
                  className="w-full p-2 bg-rose-500/5 border border-rose-500/20 hover:bg-rose-500/10 text-rose-500 text-[9px] uppercase font-black tracking-widest rounded-xl transition-all flex items-center justify-center gap-2"
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
                      className="w-full p-2 bg-white/5 border border-white/10 hover:border-rose-500/50 text-rose-500 text-[9px] uppercase font-black tracking-widest rounded-xl transition-all"
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
                    className="w-full btn-retro !p-4 glass-card border-primary/40 hover:border-primary text-[10px] uppercase font-black tracking-widest shadow-xl flex items-center justify-center gap-2"
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

      <GlassCard className="!p-8 bg-white/2 border-white/5">
        <h3 className="text-xs font-black font-mono uppercase mb-4 flex items-center gap-3 tracking-[0.2em]">
          <Shield size={18} className="text-primary" /> Withdrawal whitelist
        </h3>
        <p className="text-[10px] font-mono text-muted-foreground/70 mb-4 leading-relaxed">
          When non-empty, withdrawals may only go to addresses listed below (must include your
          primary withdrawal address). Leave empty to allow only your linked primary address.
        </p>
        {withdrawalSecurity?.withdrawal_cooldown_active && (
          <p className="text-[9px] font-mono text-amber-500 mb-4 uppercase">
            Cooldown active until{' '}
            {withdrawalSecurity.withdrawal_cooldown_until
              ? new Date(withdrawalSecurity.withdrawal_cooldown_until).toLocaleString()
              : '24h after address change'}
          </p>
        )}
        {withdrawalSecurity?.primary_withdrawal_address && (
          <p className="text-[9px] font-mono text-primary/80 mb-3 break-all">
            Primary: {withdrawalSecurity.primary_withdrawal_address}
          </p>
        )}
        <textarea
          value={whitelistDraft}
          onChange={(e) => onWhitelistDraftChange(e.target.value)}
          placeholder="One Solana address per line"
          rows={5}
          className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-[11px] font-mono focus:border-primary/50 outline-none resize-y"
        />
        <button
          type="button"
          onClick={onSaveWhitelist}
          disabled={whitelistSaving}
          className="mt-4 w-full btn-retro !py-3 text-[10px] uppercase font-black tracking-widest"
        >
          {whitelistSaving ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Saving…
            </span>
          ) : (
            'Save whitelist'
          )}
        </button>
      </GlassCard>

      {result && <WalletResultBanner result={result} variant="linked" />}
    </motion.div>
  );
}
