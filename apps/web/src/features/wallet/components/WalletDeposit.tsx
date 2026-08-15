'use client';

import {
  ArrowDownLeft,
  Copy,
  Loader2,
} from 'lucide-react';
import { UnlockWalletPrompt } from '@/components/UnlockWalletPrompt';
import { MoneyRailHint } from '@/components/MoneyRailHint';
import { ConfirmDialog } from '@/components/patterns/ConfirmDialog';

type WalletDepositProps = {
  depositAmount: string;
  onDepositAmountChange: (value: string) => void;
  depositTxHash: string;
  onDepositTxHashChange: (value: string) => void;
  showManualDeposit: boolean;
  onToggleManualDeposit: () => void;
  processing: boolean;
  linkedAddress: string | null | undefined;
  connected: boolean;
  /** True when adapter publicKey !== linkedAddress */
  publicKeyMismatch?: boolean;
  isLocalSolanaRpc: boolean;
  isDevnet: boolean;
  treasuryAddress: string | null | undefined;
  destinationKind?: string | null;
  onCopyTreasury: () => void;
  onInitiateDeposit: () => void;
  onVerifyDeposit: () => void;
  showDepositConfirm: boolean;
  depositConfirmAmount: number | null;
  solanaNetwork: string;
  onDepositConfirmOpenChange: (open: boolean) => void;
  onConfirmDeposit: () => Promise<void>;
};

export function WalletDeposit({
  depositAmount,
  onDepositAmountChange,
  depositTxHash,
  onDepositTxHashChange,
  showManualDeposit,
  onToggleManualDeposit,
  processing,
  linkedAddress,
  connected,
  publicKeyMismatch = false,
  isLocalSolanaRpc,
  isDevnet,
  treasuryAddress,
  destinationKind,
  onCopyTreasury,
  onInitiateDeposit,
  onVerifyDeposit,
  showDepositConfirm,
  depositConfirmAmount,
  solanaNetwork,
  onDepositConfirmOpenChange,
  onConfirmDeposit,
}: WalletDepositProps) {
  return (
    <>
      <div className="space-y-4 p-6 rounded-2xl border border-emerald-500/10 bg-emerald-500/5">
        <p className="text-[10px] font-black font-mono uppercase text-emerald-500 tracking-widest flex items-center gap-2">
          <ArrowDownLeft size={14} /> Deposit SOL
        </p>
        <p className="text-[10px] font-mono text-muted-foreground/70 leading-relaxed">
          Transfer SOL from your linked wallet to the platform{' '}
          {destinationKind === 'vault' ? 'deposit vault' : 'treasury'}. We credit your{' '}
          <span className="text-white/70">platform balance</span> after confirmation.
        </p>
        <MoneyRailHint rail="platform" />
        {isLocalSolanaRpc ? (
          <p className="text-[9px] font-mono text-amber-500/80 leading-relaxed">
            Local validator: set Phantom RPC to http://127.0.0.1:8899 before depositing.
          </p>
        ) : isDevnet ? (
          <p className="text-[9px] font-mono text-amber-500/80 leading-relaxed">
            Devnet: use Phantom on devnet, or Ledger with the Solana app set to Devnet and blind
            signing enabled.
          </p>
        ) : null}
        {treasuryAddress ? (
          <div className="flex gap-2 items-stretch">
            <code className="flex-1 text-[9px] font-mono break-all bg-black/40 p-3 rounded-lg border border-white/5">
              {treasuryAddress}
            </code>
            <button
              type="button"
              onClick={onCopyTreasury}
              className="px-3 rounded-lg border border-white/10 hover:border-primary/40 text-muted-foreground hover:text-primary transition-colors"
              title="Copy treasury address"
            >
              <Copy size={14} />
            </button>
          </div>
        ) : (
          <p className="text-[9px] font-mono text-amber-500/80 uppercase">
            Treasury address loading…
          </p>
        )}
        <input
          type="number"
          min="0"
          step="0.000001"
          placeholder="Amount (SOL)"
          value={depositAmount}
          onChange={(e) => onDepositAmountChange(e.target.value)}
          className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm font-mono focus:border-primary/50 outline-none"
        />
        {linkedAddress && !connected && (
          <UnlockWalletPrompt expectedAddress={linkedAddress} compact />
        )}
        {linkedAddress && connected && publicKeyMismatch && (
          <UnlockWalletPrompt expectedAddress={linkedAddress} mismatch compact />
        )}
        <button
          type="button"
          onClick={onInitiateDeposit}
          disabled={processing || !linkedAddress}
          className="w-full btn-retro !py-3 text-[10px] uppercase font-black tracking-widest disabled:opacity-40"
        >
          {processing ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Processing…
            </span>
          ) : (
            'Deposit SOL'
          )}
        </button>
        {!linkedAddress && (
          <p className="text-[9px] font-mono text-amber-500/80 uppercase">
            Link a wallet on the Linked Wallets tab first
          </p>
        )}
        <button
          type="button"
          onClick={onToggleManualDeposit}
          className="text-[9px] font-mono text-muted-foreground/60 hover:text-primary uppercase tracking-widest"
        >
          {showManualDeposit ? 'Hide manual verification' : 'Already sent SOL? Paste signature'}
        </button>
        {showManualDeposit && (
          <div className="space-y-3 pt-2 border-t border-white/5">
            <input
              type="text"
              placeholder="Transaction signature"
              value={depositTxHash}
              onChange={(e) => onDepositTxHashChange(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm font-mono focus:border-primary/50 outline-none"
            />
            <button
              type="button"
              onClick={onVerifyDeposit}
              disabled={processing || !linkedAddress}
              className="w-full py-2 text-[10px] uppercase font-black tracking-widest border border-white/10 rounded-xl hover:border-primary/40 disabled:opacity-40"
            >
              Verify pasted signature
            </button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={showDepositConfirm && depositConfirmAmount !== null}
        onOpenChange={onDepositConfirmOpenChange}
        title="Confirm deposit"
        description={
          depositConfirmAmount !== null
            ? `Send ${depositConfirmAmount} SOL to the treasury?`
            : undefined
        }
        confirmLabel="Confirm & send"
        onConfirm={onConfirmDeposit}
      >
        {depositConfirmAmount !== null && (
          <div className="space-y-3 font-mono text-[10px] uppercase">
            <div className="flex justify-between border-b border-[var(--border)] pb-2">
              <span className="text-muted-foreground">Deposit Amount</span>
              <span className="font-bold text-foreground">{depositConfirmAmount} SOL</span>
            </div>
            <div className="flex justify-between border-b border-[var(--border)] pb-2">
              <span className="text-muted-foreground">Target Network</span>
              <span className="font-bold text-primary">{solanaNetwork}</span>
            </div>
            {treasuryAddress ? (
              <div className="space-y-1">
                <span className="text-muted-foreground block">Treasury Destination</span>
                <div className="p-2.5 rounded-lg bg-[var(--secondary)] border border-[var(--border)] text-[9px] break-all select-all font-mono font-bold text-foreground leading-normal">
                  {treasuryAddress}
                </div>
              </div>
            ) : null}
            <p className="text-[9px] text-muted-foreground leading-relaxed normal-case tracking-normal">
              You will approve one transaction in your linked wallet adapter to transfer SOL to the
              ProxyHub Treasury. Once confirmed, your custodial account is credited.
            </p>
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}
