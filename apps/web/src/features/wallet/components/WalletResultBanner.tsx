'use client';

import { AlertCircle, CheckCircle, ExternalLink, Loader2, ShieldCheck } from 'lucide-react';
import { motion } from 'framer-motion';
import type { WalletResult } from '../types';

type WalletResultBannerProps = {
  result: WalletResult;
  variant?: 'overview' | 'linked';
};

export function WalletResultBanner({ result, variant = 'overview' }: WalletResultBannerProps) {
  if (variant === 'linked') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`p-5 rounded-2xl border text-[10px] font-mono uppercase font-black flex items-center gap-4 ${
          result.success
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.1)]'
            : 'bg-rose-500/10 border-rose-500/20 text-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.1)]'
        }`}
      >
        <ShieldCheck size={18} /> {result.message}
      </motion.div>
    );
  }

  return (
    <div
      className={`p-4 rounded-xl border text-[10px] font-mono uppercase font-black flex flex-wrap items-center gap-3 ${
        result.type === 'info'
          ? 'bg-amber-500/10 border-amber-500/20 text-amber-500'
          : result.success
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'
            : 'bg-rose-500/10 border-rose-500/20 text-rose-500'
      }`}
    >
      {result.type === 'info' ? (
        <Loader2 size={16} className="animate-spin" />
      ) : result.success ? (
        <CheckCircle size={16} />
      ) : (
        <AlertCircle size={16} />
      )}
      <span>{result.message}</span>
      {result.solscanUrl && (
        <a
          href={result.solscanUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline normal-case tracking-normal"
        >
          View on Solscan <ExternalLink size={12} />
        </a>
      )}
    </div>
  );
}
