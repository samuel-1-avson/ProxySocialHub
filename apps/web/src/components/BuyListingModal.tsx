'use client';

import { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Zap,
  Power,
  AlertCircle,
  CheckCircle,
  Wifi,
  Copy,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Listing,
  confirmEscrowPayment,
  createOrderWithProvisioning,
  getOrderProxyCredentials,
  initiateSmartContractPayment,
  marketplaceKeys,
  waitForOrderActive,
  type MarketplaceProxyCredentials,
} from '@/lib/api/marketplace';
import { getSystemConfig } from '@/lib/api/config';
import { useAnchorWallet, useWallet } from '@solana/wallet-adapter-react';
import {
  initializeEscrow,
  initializeEscrowMultisig,
  isEscrowAccountAlreadyInUse,
  getEscrowInfo,
  getEscrowInfoByPDA,
} from '@/lib/solana';
import { formatSolanaWalletError } from '@/lib/solana-transfer';
import { useToast } from '@/stores';
import { getErrorMessage } from '@/lib/utils';
import { ApiError } from '@/lib/api/client';
import Link from 'next/link';
import { ROUTES } from '@/lib/navigation/routes';
import {
  trackMarketplaceEvent,
  type MarketplaceFunnelSurface,
} from '@/lib/analytics/marketplace-funnel';
import { Modal } from '@/components/patterns/Modal';
import { Button } from '@/components/ui/button';
import { MoneyRailHint } from '@/components/MoneyRailHint';
import { UnlockWalletPrompt } from '@/components/UnlockWalletPrompt';

async function waitForFundedEscrow(
  buyer: string,
  seller: string,
  opts?: { timeoutMs?: number; intervalMs?: number; escrowPda?: string }
): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? 45_000;
  const intervalMs = opts?.intervalMs ?? 1500;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = opts?.escrowPda
      ? await getEscrowInfoByPDA(opts.escrowPda)
      : await getEscrowInfo(buyer, seller);
    if (
      info &&
      info.amount > 0 &&
      (info.status === 'Pending' || info.status === 'Active') &&
      (info.expiresAt === 0 || info.expiresAt * 1000 > Date.now())
    ) {
      return true;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

interface BuyListingModalProps {
  listing: Listing;
  onClose: () => void;
  onSuccess: (orderId: string, credentials?: MarketplaceProxyCredentials) => void;
  surface?: MarketplaceFunnelSurface | string;
}

export function BuyListingModal({
  listing,
  onClose,
  onSuccess,
  surface = 'unknown',
}: BuyListingModalProps) {
  const { publicKey } = useWallet();
  const wallet = useAnchorWallet();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [credentials, setCredentials] = useState<MarketplaceProxyCredentials | null>(null);
  const [completedOrderId, setCompletedOrderId] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [bandwidth, setBandwidth] = useState(listing.min_purchase_gb || 1);

  const { data: systemConfig } = useQuery({
    queryKey: ['system-config-public'],
    queryFn: getSystemConfig,
    staleTime: 60_000,
  });
  const solPriceUsd = Number(systemConfig?.sol_price_usd || 0);

  useEffect(() => {
    trackMarketplaceEvent('buy_modal_open', {
      listing_id: listing.id,
      surface,
    });
  }, [listing.id, surface]);

  const effectivePricePerGB = (() => {
    let best = listing.price_per_gb;
    for (const d of listing.bulk_discounts ?? []) {
      if (bandwidth >= d.min_gb && d.price_per_gb < best) {
        best = d.price_per_gb;
      }
    }
    return best;
  })();
  const estimatedCostUSD = effectivePricePerGB * bandwidth;
  const estimatedCostSOL = solPriceUsd > 0 ? estimatedCostUSD / solPriceUsd : null;
  const bulkRateActive = effectivePricePerGB < listing.price_per_gb - 1e-12;

  const copyToClipboard = (text: string, key: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const e2eMockBuy =
    process.env.NEXT_PUBLIC_PLAYWRIGHT_E2E_MOCK_BUY === '1' ||
    (typeof window !== 'undefined' &&
      !!(window as Window & { __PROXYHUB_E2E_MOCK_BUY__?: boolean }).__PROXYHUB_E2E_MOCK_BUY__);

  const handleConnect = async () => {
    if (!e2eMockBuy && (!wallet || !publicKey)) {
      toast.warning('Wallet required', 'Please connect your Solana wallet first.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const orderResult = await createOrderWithProvisioning({
        listing_id: listing.id,
        bandwidth_gb: bandwidth,
        session_type: listing.proxy_type === 'sticky' ? 'sticky' : 'rotating',
      });
      const order = orderResult.order;

      const params = await initiateSmartContractPayment(order.id);
      const buyerPk = params.buyer_pubkey || publicKey?.toBase58() || '';
      const sellerPk = params.seller_pubkey;

      let escrowTx: string | undefined;
      const useMultisig = params.escrow_seed_kind === 'multisig';
      const escrowPdaHint = params.escrow_pda;
      const ensureEscrowOnChain = async () => {
        if (e2eMockBuy) return;
        if (!buyerPk || !sellerPk) {
          throw new Error('Missing buyer/seller wallet for escrow.');
        }
        const already = escrowPdaHint
          ? await getEscrowInfoByPDA(escrowPdaHint)
          : await getEscrowInfo(buyerPk, sellerPk);
        if (
          already &&
          already.amount > 0 &&
          (already.status === 'Pending' || already.status === 'Active')
        ) {
          return;
        }
        try {
          if (useMultisig) {
            if (!params.escrow_expires_at) {
              throw new Error('Missing escrow_expires_at for multisig escrow init.');
            }
            const { tx } = await initializeEscrowMultisig(
              wallet,
              sellerPk,
              params.amount_lamports,
              params.bandwidth_gb,
              params.escrow_expires_at
            );
            escrowTx = tx;
          } else {
            const { tx } = await initializeEscrow(
              wallet,
              sellerPk,
              params.amount_lamports,
              params.bandwidth_gb
            );
            escrowTx = tx;
          }
        } catch (initErr: unknown) {
          if (!isEscrowAccountAlreadyInUse(initErr)) {
            throw initErr;
          }
        }
        const funded = await waitForFundedEscrow(buyerPk, sellerPk, {
          escrowPda: escrowPdaHint,
        });
        if (!funded) {
          throw new Error(
            'Escrow transaction did not land on-chain. Approve the wallet popup, ensure you have enough SOL, then try again.'
          );
        }
      };

      if (params.escrow_already_funded) {
        // Re-verify before confirming — stale flags / RPC lag happen on public devnet.
        if (!e2eMockBuy) {
          const ok = await waitForFundedEscrow(buyerPk, sellerPk, {
            timeoutMs: 12_000,
            intervalMs: 1000,
            escrowPda: escrowPdaHint,
          });
          if (!ok) {
            await ensureEscrowOnChain();
          }
        }
      } else {
        await ensureEscrowOnChain();
      }

      try {
        await confirmEscrowPayment(order.id, escrowTx);
      } catch (confirmErr: unknown) {
        const code =
          confirmErr instanceof ApiError
            ? confirmErr.code
            : undefined;
        const msg = getErrorMessage(confirmErr);
        if (code === 'escrow_missing' || /escrow not found/i.test(msg)) {
          await ensureEscrowOnChain();
          await confirmEscrowPayment(order.id, escrowTx);
        } else {
          throw confirmErr;
        }
      }

      await waitForOrderActive(order.id, {
        timeoutMs: e2eMockBuy ? 15_000 : 60_000,
        pollIntervalMs: e2eMockBuy ? 250 : 2000,
      });
      const credsResponse = await getOrderProxyCredentials(order.id);
      const nextCredentials = credsResponse.proxy_credentials;
      if (!nextCredentials) {
        throw new Error(
          'Order created, but proxy credentials were not returned after escrow confirmation.'
        );
      }

      setCompletedOrderId(order.id);
      setCredentials(nextCredentials);
      void queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
      onSuccess(order.id, nextCredentials);
    } catch (err: unknown) {
      console.error(err);
      const walletMsg = formatSolanaWalletError(err);
      const apiMsg = getErrorMessage(err);
      setError(
        walletMsg ||
          apiMsg ||
          'Failed to connect. Check your on-chain SOL wallet balance (devnet).'
      );
    } finally {
      setLoading(false);
    }
  };

  if (credentials) {
    return (
      <Modal
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title="Connected"
        description="Pay-as-you-go billing is active"
        testId="buy-listing-modal-success"
        footer={
          <div className="flex w-full flex-col gap-2">
            {completedOrderId ? (
              <Link
                href={ROUTES.marketplaceOrder(completedOrderId)}
                className="inline-flex w-full items-center justify-center rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-medium hover:bg-secondary"
              >
                View order & credentials
              </Link>
            ) : null}
            <Button type="button" onClick={onClose} className="w-full">
              Done
            </Button>
          </div>
        }
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--success)_15%,transparent)] text-[var(--success)]">
            <CheckCircle size={20} aria-hidden />
          </div>
          <p className="text-sm text-muted-foreground">
            Copy credentials below. Reveal password only when ready.
          </p>
        </div>

        <div className="space-y-3 rounded-[var(--radius-md)] border border-border bg-secondary p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Proxy credentials
          </p>
          {[
            { label: 'Endpoint', value: credentials.endpoint, key: 'endpoint' },
            { label: 'Username', value: credentials.username, key: 'username' },
          ].map(({ label, value, key }) => (
            <div key={key} className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="break-all font-mono text-sm text-foreground">{value}</p>
              </div>
              <button
                type="button"
                onClick={() => copyToClipboard(value, key)}
                className="shrink-0 rounded-[var(--radius-sm)] p-2 text-muted-foreground hover:bg-background hover:text-foreground"
                aria-label={`Copy ${label}`}
              >
                {copied === key ? (
                  <CheckCircle size={14} className="text-[var(--success)]" aria-hidden />
                ) : (
                  <Copy size={14} aria-hidden />
                )}
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Password</p>
              <p className="break-all font-mono text-sm text-foreground">
                {showPass ? credentials.password : '••••••••••••'}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="rounded-[var(--radius-sm)] p-2 text-muted-foreground hover:bg-background hover:text-foreground"
                aria-label={showPass ? 'Hide password' : 'Reveal password'}
                aria-pressed={showPass}
              >
                {showPass ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
              </button>
              <button
                type="button"
                onClick={() => copyToClipboard(credentials.password, 'password')}
                className="rounded-[var(--radius-sm)] p-2 text-muted-foreground hover:bg-background hover:text-foreground"
                aria-label="Copy password"
              >
                {copied === 'password' ? (
                  <CheckCircle size={14} className="text-[var(--success)]" aria-hidden />
                ) : (
                  <Copy size={14} aria-hidden />
                )}
              </button>
            </div>
          </div>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Configure your client as an HTTP proxy. Billing is hourly; the session ends when the
          bandwidth quota is reached.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !loading) onClose();
      }}
      title="Connect to node"
      description={listing.title}
      testId="buy-listing-modal"
      footer={
        <div className="flex w-full flex-col gap-2">
          <Button
            type="button"
            data-testid="buy-listing-start-connection"
            onClick={() => void handleConnect()}
            disabled={loading}
            isLoading={loading}
            className="w-full"
          >
            <Power size={18} className="mr-2" aria-hidden />
            Start connection
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            You pay from your linked Solana wallet into on-chain escrow. Platform balance is not used.
            Session ends when bandwidth quota is exhausted.
          </p>
          <MoneyRailHint rail="escrow" />
        </div>
      }
    >
      <div className="space-y-5">
        {!publicKey && (
          <UnlockWalletPrompt compact />
        )}
        <div className="flex gap-4 rounded-[var(--radius-md)] border border-border bg-secondary p-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-primary font-mono text-sm font-semibold text-primary-foreground">
            {listing.proxy_type?.[0]?.toUpperCase() ?? 'P'}
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">{listing.title}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <ShieldCheck size={12} className="text-[var(--info)]" aria-hidden />
                Verified
              </span>
              <span className="inline-flex items-center gap-1 font-mono">
                <Zap size={12} className="text-[var(--warning)]" aria-hidden />
                {listing.avg_latency_ms}ms
              </span>
              <span className="inline-flex items-center gap-1">
                <Wifi size={12} className="text-[var(--success)]" aria-hidden />
                Ready
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--info)_30%,var(--border))] bg-[color-mix(in_srgb,var(--info)_8%,transparent)] p-4">
          <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold text-[var(--info)]">
            <AlertCircle size={14} aria-hidden />
            Pay-as-you-go billing
          </h4>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Charged from your SOL wallet based on bandwidth consumed. Session auto-terminates when
            quota is exhausted.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="buy-bandwidth" className="text-xs font-medium text-muted-foreground">
              Bandwidth quota
            </label>
            <span className="font-mono text-sm font-semibold text-foreground">{bandwidth} GB</span>
          </div>
          <input
            id="buy-bandwidth"
            type="range"
            min={listing.min_purchase_gb || 1}
            max={Math.min(listing.available_bandwidth_gb || 1000, 100)}
            step={1}
            value={bandwidth}
            onChange={(e) => setBandwidth(parseInt(e.target.value, 10))}
            className="w-full accent-[var(--primary)]"
          />
          <div className="flex justify-between font-mono text-xs text-muted-foreground">
            <span>Min: {listing.min_purchase_gb || 1} GB</span>
            <span>Avail: {listing.available_bandwidth_gb || 'Unlimited'}</span>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-border bg-secondary p-4">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Estimated total</p>
            <p className="font-mono text-2xl font-semibold text-[var(--success)]">
              ${estimatedCostUSD.toFixed(2)}
            </p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {estimatedCostSOL != null
                ? `≈ ${estimatedCostSOL.toFixed(6)} SOL escrow`
                : 'SOL estimate pending price feed'}
            </p>
          </div>
          <div className="text-right">
            <p className="mb-1 text-xs text-muted-foreground">Rate</p>
            <p className="font-mono text-sm text-foreground">
              ${effectivePricePerGB.toFixed(4)} / GB
            </p>
            {bulkRateActive ? (
              <p className="mt-1 font-mono text-xs text-[var(--success)]">
                Bulk rate (list ${listing.price_per_gb.toFixed(4)})
              </p>
            ) : solPriceUsd > 0 ? (
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                SOL @ ${solPriceUsd.toFixed(2)}
              </p>
            ) : null}
          </div>
        </div>

        {error ? (
          <div
            className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--destructive)_30%,var(--border))] bg-[color-mix(in_srgb,var(--destructive)_8%,transparent)] p-3 text-sm text-[var(--destructive)]"
            role="alert"
          >
            <AlertCircle size={16} aria-hidden />
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
