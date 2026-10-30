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
        className={`p-5 rounded-lg border text-xs font-mono font-semibold flex items-center gap-4 ${
          result.success
            ? 'bg-success/10 border-success/20 text-success '
            : 'bg-destructive/10 border-destructive/20 text-destructive '
        }`}
      >
        <ShieldCheck size={18} /> {result.message}
      </motion.div>
    );
  }

  return (
    <div
      className={`p-4 rounded-lg border text-xs font-mono font-semibold flex flex-wrap items-center gap-3 ${
        result.type === 'info'
          ? 'bg-warning/10 border-warning/20 text-warning'
          : result.success
            ? 'bg-success/10 border-success/20 text-success'
            : 'bg-destructive/10 border-destructive/20 text-destructive'
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
