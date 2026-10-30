'use client';

import { Copy } from 'lucide-react';

type WalletOnChainHintProps = {
  linkedAddress: string;
  isLocalSolanaRpc: boolean;
  isDevnet: boolean;
  cliBalanceCommand: string;
  onCopyAddress: () => void;
  onCopyCliCommand: () => void;
};

export function WalletOnChainHint({
  linkedAddress,
  isLocalSolanaRpc,
  isDevnet,
  cliBalanceCommand,
  onCopyAddress,
  onCopyCliCommand,
}: WalletOnChainHintProps) {
  return (
    <div className="p-3 rounded-lg border border-border bg-secondary space-y-2 text-xs font-mono text-muted-foreground/90 leading-relaxed">
      <p className="font-semibold text-muted-foreground">
        Verify linked wallet on-chain
      </p>
      {isLocalSolanaRpc ? (
        <p>
          Withdrawals land on the local validator. In Phantom use{' '}
          <span className="text-warning">Solana Localnet</span> (not Devnet). If the extension
          balance looks wrong, check with the CLI using the same RPC as the app.
        </p>
      ) : (
        <p>
          Copy your linked address or run the CLI to confirm the balance Phantom should show on{' '}
          {isDevnet ? 'devnet' : 'mainnet'}.
        </p>
      )}
      <div className="flex gap-2 items-stretch">
        <code className="flex-1 break-all bg-secondary p-2 rounded-lg border border-border text-primary/80">
          {linkedAddress}
        </code>
        <button
          type="button"
          onClick={onCopyAddress}
          className="px-3 rounded-lg border border-border hover:border-primary/40 text-muted-foreground hover:text-primary transition-colors shrink-0"
          title="Copy linked address"
        >
          <Copy size={14} />
        </button>
      </div>
      <div className="flex gap-2 items-stretch">
        <code className="flex-1 break-all bg-secondary p-2 rounded-lg border border-border text-warning/80">
          {cliBalanceCommand}
        </code>
        <button
          type="button"
          onClick={onCopyCliCommand}
          className="px-3 rounded-lg border border-border hover:border-primary/40 text-muted-foreground hover:text-primary transition-colors shrink-0"
          title="Copy CLI balance command"
        >
          <Copy size={14} />
        </button>
      </div>
    </div>
  );
}
