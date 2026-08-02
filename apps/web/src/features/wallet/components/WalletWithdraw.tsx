'use client';

import { AlertCircle, ArrowUpRight, Loader2, Shield } from 'lucide-react';
import { UnlockWalletPrompt } from '@/components/UnlockWalletPrompt';
import { MoneyRailHint } from '@/components/MoneyRailHint';

type WithdrawalSecurityLike = {
  withdrawal_cooldown_active?: boolean;
  withdrawal_cooldown_until?: string | null;
} | null | undefined;

type WalletWithdrawProps = {
  withdrawAmount: string;
  onWithdrawAmountChange: (value: string) => void;
  processing: boolean;
  linkedAddress: string | null | undefined;
  largeWithdrawThresholdSOL: number;
  withdrawRequiresSignature: boolean;
  canSignMessage: boolean;
  withdrawalSecurity: WithdrawalSecurityLike;
  onWithdraw: () => void;
};

export function WalletWithdraw({
  withdrawAmount,
  onWithdrawAmountChange,
  processing,
  linkedAddress,
  largeWithdrawThresholdSOL,
  withdrawRequiresSignature,
  canSignMessage,
  withdrawalSecurity,
  onWithdraw,
}: WalletWithdrawProps) {
  return (
    <div className="space-y-4 p-6 rounded-2xl border border-rose-500/10 bg-rose-500/5">
      <p className="text-[10px] font-black font-mono uppercase text-rose-400 tracking-widest flex items-center gap-2">
        <ArrowUpRight size={14} /> Withdraw SOL
      </p>
      <p className="text-[10px] font-mono text-muted-foreground/70 leading-relaxed">
        Move <span className="text-white/70">platform balance</span> to your linked primary address
        {linkedAddress
          ? ` (${linkedAddress.slice(0, 4)}…${linkedAddress.slice(-4)})`
          : ''}
        . Amounts over {largeWithdrawThresholdSOL} SOL require a wallet signature.
      </p>
      <MoneyRailHint rail="platform" />
      {withdrawalSecurity?.withdrawal_cooldown_active && (
        <div className="p-3 rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-400 text-[9px] font-mono uppercase font-black leading-relaxed flex items-start gap-2">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>
            Withdrawal cooldown active until{' '}
            {withdrawalSecurity.withdrawal_cooldown_until
              ? new Date(withdrawalSecurity.withdrawal_cooldown_until).toLocaleString()
              : '24h after address change'}
            . You changed your withdrawal address recently.
          </span>
        </div>
      )}
      <input
        type="number"
        min="0"
        step="0.000001"
        placeholder="Amount (SOL)"
        value={withdrawAmount}
        onChange={(e) => onWithdrawAmountChange(e.target.value)}
        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm font-mono focus:border-primary/50 outline-none"
      />
      {withdrawRequiresSignature && (
        <p className="text-[9px] font-mono text-amber-500/90 uppercase flex items-center gap-2">
          <Shield size={12} />
          {canSignMessage
            ? 'Signature required — approve the message in your wallet when prompted'
            : `Unlock your linked wallet below, then withdraw (required for amounts over ${largeWithdrawThresholdSOL} SOL)`}
        </p>
      )}
      {linkedAddress && withdrawRequiresSignature && !canSignMessage && (
        <UnlockWalletPrompt expectedAddress={linkedAddress} compact />
      )}
      <button
        type="button"
        onClick={onWithdraw}
        disabled={
          processing || !linkedAddress || (withdrawRequiresSignature && !canSignMessage)
        }
        className="w-full btn-retro !py-3 text-[10px] uppercase font-black tracking-widest border-rose-500/30 hover:border-rose-500/50 disabled:opacity-40"
      >
        {processing ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Processing…
          </span>
        ) : (
          'Withdraw to linked wallet'
        )}
      </button>
    </div>
  );
}
