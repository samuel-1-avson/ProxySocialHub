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
    <div className="space-y-4 p-6 rounded-lg border border-destructive/10 bg-destructive/5">
      <p className="text-xs font-semibold font-mono text-destructive flex items-center gap-2">
        <ArrowUpRight size={14} /> Withdraw SOL
      </p>
      <p className="text-xs font-mono text-muted-foreground/70 leading-relaxed">
        Move <span className="text-foreground">platform balance</span> to your linked primary address
        {linkedAddress
          ? ` (${linkedAddress.slice(0, 4)}…${linkedAddress.slice(-4)})`
          : ''}
        . Amounts over {largeWithdrawThresholdSOL} SOL require a wallet signature.
      </p>
      <MoneyRailHint rail="platform" />
      {withdrawalSecurity?.withdrawal_cooldown_active && (
        <div className="p-3 rounded-lg border border-warning/20 bg-warning/10 text-warning text-xs font-mono font-semibold leading-relaxed flex items-start gap-2">
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
        className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-sm font-mono focus:border-primary/50 outline-none"
      />
      {withdrawRequiresSignature && (
        <p className="text-xs font-mono text-warning/90 flex items-center gap-2">
          <Shield size={12} />
          {canSignMessage
            ? 'Signature required. Approve the message in your wallet when prompted'
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
        className="w-full btn-retro !py-3 text-xs font-semibold border-destructive/30 hover:border-destructive/50 disabled:opacity-40"
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
