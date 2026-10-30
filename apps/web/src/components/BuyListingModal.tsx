'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ShieldCheck,
  Zap,
  Power,
  AlertCircle,
  CheckCircle,
  CreditCard,
  Loader2,
  XCircle,
  Clock,
  Info,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Listing,
  cancelOrder,
  confirmEscrowPayment,
  createOrderWithProvisioning,
  getOrder,
  getOrderProxyCredentials,
  getPaystackPreview,
  initiateSmartContractPayment,
  marketplaceKeys,
  payOrderFromBalance,
  quotePaystackPayment,
  verifyPaystackPayment,
  waitForOrderActive,
  type MarketplaceProxyCredentials,
  type Order,
  type PaystackPreview,
} from '@/lib/api/marketplace';
import { useAuth } from '@/lib/auth';
import { openPaystackCheckout } from '@/lib/paystack';
import { getSystemConfig } from '@/lib/api/config';
import { useAnchorWallet, useWallet } from '@solana/wallet-adapter-react';
import {
  initializeEscrow,
  initializeEscrowMultisig,
  isEscrowAccountAlreadyInUse,
  getEscrowInfo,
  getEscrowInfoByPDA,
  assertExpectedSolanaCluster,
  assertBuyerHasSolOnCluster,
  shopSolanaClusterLabel,
  WrongSolanaClusterError,
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
import { ExtensionConnectCard } from '@/components/marketplace/ExtensionConnectCard';
import { MarketplaceOrderCredentials } from '@/components/marketplace/MarketplaceOrderCredentials';

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

/** How a Google-account purchase ended when it did not reach "active". */
type PurchaseOutcome = 'refunded' | 'failed' | 'slow';

class PurchaseOutcomeError extends Error {
  constructor(
    public outcome: PurchaseOutcome,
    message: string
  ) {
    super(message);
  }
}

/** Polls the server until the Paystack charge has opened the escrow and activated the order. */
async function waitForPaystackActive(
  orderId: string,
  reference: string,
  onStatus: (status: string) => void,
  timeoutMs = 120_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await verifyPaystackPayment(orderId, reference);
    onStatus(res.status);
    if (res.status === 'active') return;
    if (res.status === 'refunded') {
      throw new PurchaseOutcomeError(
        'refunded',
        res.message || 'We could not set up this order, so your payment was refunded.'
      );
    }
    if (res.status === 'failed') {
      throw new PurchaseOutcomeError(
        'failed',
        res.message ||
          'We could not set up this order. Your payment is kept as credit in your ProxyHubb wallet.'
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new PurchaseOutcomeError(
    'slow',
    'Your payment is safe. Setup is taking longer than usual and we will finish it automatically. Your plan will appear in Orders.'
  );
}

/** What the buyer sees after paying, in their words (server statuses mapped onto three steps). */
const MANAGED_STEPS = ['Confirming your payment', 'Securing your payment', 'Setting up your proxy'];

function managedStepIndex(stage: string) {
  switch (stage) {
    case 'quoted':
      return 0;
    case 'paid':
    case 'funded':
      return 1;
    default:
      return 2;
  }
}

function ManagedPaymentProgress({ stage, startedAt }: { stage: string; startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const current = managedStepIndex(stage);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <div className="space-y-5" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-2 pt-2 text-center">
        <Loader2 size={32} className="animate-spin text-primary" aria-hidden />
        <p className="text-base font-semibold text-foreground">Setting up your proxy</p>
        <p className="text-xs text-muted-foreground">
          Usually about 10 seconds · <span className="font-mono">{seconds}s</span>
        </p>
      </div>
      <ol className="space-y-3 rounded-[var(--radius-md)] border border-border bg-secondary p-4">
        {MANAGED_STEPS.map((label, i) => (
          <li
            key={label}
            className={`flex items-center gap-3 text-sm ${i > current ? 'text-muted-foreground/60' : 'text-foreground'}`}
          >
            {i < current ? (
              <CheckCircle size={18} className="shrink-0 text-[var(--success)]" aria-hidden />
            ) : i === current ? (
              <Loader2 size={18} className="shrink-0 animate-spin text-primary" aria-hidden />
            ) : (
              <span
                className="h-[18px] w-[18px] shrink-0 rounded-full border border-border"
                aria-hidden
              />
            )}
            <span>{i === 0 && current > 0 ? 'Payment received' : label}</span>
          </li>
        ))}
      </ol>
      <p className="text-center text-xs text-muted-foreground">
        You can close this window. We finish in the background and your plan appears in Orders.
      </p>
    </div>
  );
}

function formatGHS(amount: number) {
  return `GH₵${amount.toFixed(2)}`;
}

function formatDay(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

interface ManagedBuyViewProps {
  listing: Listing;
  open: boolean;
  onClose: () => void;
  busy: boolean;
  payStage: string | null;
  payStartedAt: number;
  failure: { outcome: PurchaseOutcome; message: string } | null;
  notice: string;
  error: string;
  bandwidth: number;
  setBandwidth: (gb: number) => void;
  preview: PaystackPreview | undefined;
  priceReady: boolean;
  previewError: string;
  estimatedCostUSD: number;
  onPay: () => void;
  onRetry: () => void;
}

/** The buy dialog for Google-account buyers: choose → pay with Paystack → setting up → done. */
function ManagedBuyView({
  listing,
  open,
  onClose,
  busy,
  payStage,
  payStartedAt,
  failure,
  notice,
  error,
  bandwidth,
  setBandwidth,
  preview,
  priceReady,
  previewError,
  estimatedCostUSD,
  onPay,
  onRetry,
}: ManagedBuyViewProps) {
  const minGb = listing.min_purchase_gb || 1;
  const maxGb = Math.min(listing.available_bandwidth_gb || 1000, 100);
  const quote = preview && !preview.active_plan ? preview : null;

  let title = 'Buy bandwidth';
  let body: ReactNode;
  let footer: ReactNode;

  if (payStage) {
    title = 'Almost there';
    body = <ManagedPaymentProgress stage={payStage} startedAt={payStartedAt} />;
    footer = (
      <Button type="button" variant="outline" onClick={onClose} className="w-full">
        Close
      </Button>
    );
  } else if (failure) {
    const slow = failure.outcome === 'slow';
    title = slow ? 'Still finishing your order' : "We couldn't set up your order";
    body = (
      <div className="flex flex-col items-center gap-3 py-2 text-center" role="alert">
        {slow ? (
          <Clock size={36} className="text-[var(--warning)]" aria-hidden />
        ) : (
          <XCircle size={36} className="text-[var(--destructive)]" aria-hidden />
        )}
        <p className="text-sm text-foreground">{failure.message}</p>
      </div>
    );
    footer = (
      <div className="flex w-full flex-col gap-2">
        {slow ? (
          <Link
            href={ROUTES.marketplaceOrders}
            className="inline-flex w-full items-center justify-center rounded-[var(--radius-md)] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Go to my orders
          </Link>
        ) : (
          <Button type="button" onClick={onRetry} className="w-full">
            Try again
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onClose} className="w-full">
          Close
        </Button>
      </div>
    );
  } else if (preview?.active_plan) {
    title = 'You already have a plan here';
    const day = formatDay(preview.active_plan_since);
    body = (
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <CheckCircle size={36} className="text-[var(--success)]" aria-hidden />
        {preview.active_plan_order_id ? (
          <>
            <p className="text-sm font-semibold text-foreground">
              Your {preview.active_plan_gb ? `${preview.active_plan_gb} GB ` : ''}plan with this
              provider is active{day ? ` (bought ${day})` : ''}.
            </p>
            <p className="text-sm text-muted-foreground">
              Use it now with your proxy details. Each provider allows one plan at a time, so you
              can buy again here when this plan ends.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            A payment from an earlier order with this provider is still locked. You can buy here
            again once it is released. You can buy from any other provider now.
          </p>
        )}
      </div>
    );
    footer = (
      <div className="flex w-full flex-col gap-2">
        {preview.active_plan_order_id ? (
          <Link
            href={ROUTES.marketplaceOrder(preview.active_plan_order_id)}
            className="inline-flex w-full items-center justify-center rounded-[var(--radius-md)] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Show my proxy details
          </Link>
        ) : null}
        <Button type="button" variant="outline" onClick={onClose} className="w-full">
          Close
        </Button>
      </div>
    );
  } else {
    const payLabel = quote?.pay_from_balance
      ? 'Pay from my ProxyHubb balance'
      : priceReady && quote
        ? `Pay ${formatGHS(quote.amount_ghs)}`
        : 'Pay with card or mobile money';
    body = (
      <div className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="buy-bandwidth" className="text-sm font-medium text-foreground">
              How much bandwidth?
            </label>
            <span className="font-mono text-sm font-semibold text-foreground">{bandwidth} GB</span>
          </div>
          <input
            id="buy-bandwidth"
            type="range"
            min={minGb}
            max={maxGb}
            step={1}
            value={bandwidth}
            disabled={busy}
            onChange={(e) => setBandwidth(parseInt(e.target.value, 10))}
            className="w-full accent-[var(--primary)]"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{minGb} GB minimum</span>
            <span>
              {listing.available_bandwidth_gb
                ? `${listing.available_bandwidth_gb} GB available`
                : 'No limit'}
            </span>
          </div>
        </div>

        <div className="rounded-[var(--radius-md)] border border-border bg-secondary p-4">
          <p className="text-xs text-muted-foreground">You pay</p>
          <p
            className="mt-1 font-mono text-3xl font-semibold text-foreground"
            data-testid="buy-listing-price-ghs"
          >
            {quote?.pay_from_balance
              ? 'Covered by your balance'
              : priceReady && quote
                ? formatGHS(quote.amount_ghs)
                : '…'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            About ${estimatedCostUSD.toFixed(2)}. Card and mobile money fees included.
          </p>
          {quote?.credit_ghs && quote.credit_ghs > 0 && !quote.pay_from_balance ? (
            <p className="mt-2 text-xs text-[var(--success)]">
              {formatGHS(quote.credit_ghs)} credit from your ProxyHubb wallet is already taken off.
            </p>
          ) : null}
        </div>

        <ol className="space-y-2 text-sm text-muted-foreground">
          <li className="flex gap-2">
            <span className="font-mono text-foreground">1.</span>
            Pay with card or mobile money.
          </li>
          <li className="flex gap-2">
            <span className="font-mono text-foreground">2.</span>
            We hold your money safely until you use the bandwidth.
          </li>
          <li className="flex gap-2">
            <span className="font-mono text-foreground">3.</span>
            You get your proxy login right away. Bandwidth you don&apos;t use comes back as credit.
          </li>
        </ol>

        {notice ? (
          <div
            className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-secondary p-3 text-sm text-foreground"
            role="status"
          >
            <Info size={16} className="shrink-0" aria-hidden />
            {notice}
          </div>
        ) : null}
        {error || previewError ? (
          <div
            className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--destructive)_30%,var(--border))] bg-[color-mix(in_srgb,var(--destructive)_8%,transparent)] p-3 text-sm text-[var(--destructive)]"
            role="alert"
          >
            <AlertCircle size={16} className="shrink-0" aria-hidden />
            {error || previewError}
          </div>
        ) : null}
      </div>
    );
    footer = (
      <Button
        type="button"
        data-testid="buy-listing-start-connection"
        onClick={onPay}
        disabled={busy || !priceReady}
        isLoading={busy}
        className="w-full"
      >
        <CreditCard size={18} className="mr-2" aria-hidden />
        {payLabel}
      </Button>
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        // Before payment, a request is in flight; after payment the server finishes alone.
        if (!next && (!busy || payStage)) onClose();
      }}
      title={title}
      description={listing.title}
      testId="buy-listing-modal"
      footer={footer}
    >
      {body}
    </Modal>
  );
}

interface BuyListingModalProps {
  listing: Listing;
  /** An unpaid order to finish paying instead of creating a new one. */
  existingOrder?: Order;
  onClose: () => void;
  onSuccess: (orderId: string, credentials?: MarketplaceProxyCredentials) => void;
  surface?: MarketplaceFunnelSurface | string;
}

export function BuyListingModal({
  listing,
  existingOrder,
  onClose,
  onSuccess,
  surface = 'unknown',
}: BuyListingModalProps) {
  const { publicKey } = useWallet();
  const wallet = useAnchorWallet();
  const { user } = useAuth();
  const managedWallet = !!user?.managed_wallet?.address;
  const toast = useToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  // The Radix dialog is modal: it blocks clicks and traps focus outside itself, and
  // Paystack's checkout iframe lives outside it. Hide the dialog while Paystack is open.
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  // Server-side progress of a Google-account purchase after the buyer has paid.
  const [payStage, setPayStage] = useState<string | null>(null);
  const [payStartedAt, setPayStartedAt] = useState(0);
  const [failure, setFailure] = useState<{ outcome: PurchaseOutcome; message: string } | null>(
    null
  );
  const [notice, setNotice] = useState('');
  // Set once the buyer closes the dialog, so a purchase finishing in the background
  // doesn't reopen it with credentials.
  const closedRef = useRef(false);
  // Blocks a second wallet payment while one is still in progress.
  const paymentInFlight = useRef(false);
  const [error, setError] = useState('');
  // The order this dialog is paying for, once created (or the one being resumed).
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(existingOrder?.id ?? null);
  const [credentials, setCredentials] = useState<MarketplaceProxyCredentials | null>(null);
  const [completedOrderId, setCompletedOrderId] = useState<string | null>(null);
  const [bandwidth, setBandwidth] = useState(existingOrder?.bandwidth_gb ?? (listing.min_purchase_gb || 1));
  // The GHS preview follows the slider after it settles.
  const [previewGb, setPreviewGb] = useState(bandwidth);
  useEffect(() => {
    const t = setTimeout(() => setPreviewGb(bandwidth), 300);
    return () => clearTimeout(t);
  }, [bandwidth]);

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
  const estimatedCostUSD =
    existingOrder?.total_price ?? existingOrder?.price_total ?? effectivePricePerGB * bandwidth;
  const estimatedCostSOL = solPriceUsd > 0 ? estimatedCostUSD / solPriceUsd : null;
  const bulkRateActive = effectivePricePerGB < listing.price_per_gb - 1e-12;

  const e2eMockBuy =
    process.env.NODE_ENV !== 'production' &&
    (process.env.NEXT_PUBLIC_PLAYWRIGHT_E2E_MOCK_BUY === '1' ||
      (typeof window !== 'undefined' &&
        !!(window as Window & { __PROXYHUB_E2E_MOCK_BUY__?: boolean }).__PROXYHUB_E2E_MOCK_BUY__));
  const managedFlow = managedWallet && !e2eMockBuy;

  const {
    data: preview,
    isFetching: previewLoading,
    error: previewError,
    refetch: refetchPreview,
  } = useQuery({
    queryKey: ['paystack-preview', listing.id, previewGb],
    queryFn: () => getPaystackPreview(listing.id, previewGb),
    enabled: managedFlow,
    staleTime: 30_000,
  });
  const priceReady =
    !!preview && !preview.active_plan && previewGb === bandwidth && !previewLoading;

  const closeModal = () => {
    closedRef.current = true;
    onClose();
  };

  const finishOrder = async (orderId: string) => {
    await waitForOrderActive(orderId, {
      timeoutMs: e2eMockBuy ? 15_000 : 60_000,
      pollIntervalMs: e2eMockBuy ? 250 : 2000,
    });
    const credsResponse = await getOrderProxyCredentials(orderId);
    const nextCredentials = credsResponse.proxy_credentials;
    if (!nextCredentials?.username || !nextCredentials?.password || !nextCredentials?.endpoint) {
      throw new Error(
        'Order created, but proxy credentials were not returned after escrow confirmation.'
      );
    }
    void queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
    if (closedRef.current) return;
    setCompletedOrderId(orderId);
    setCredentials(nextCredentials);
    onSuccess(orderId, nextCredentials);
  };

  /**
   * Google-account buyers: pay in GHS with Paystack (or from SOL already in their
   * ProxyHubb wallet). The server funds the wallet and signs the on-chain escrow.
   */
  const handleManagedConnect = async () => {
    setLoading(true);
    setError('');
    setNotice('');
    setFailure(null);
    let orderId: string | null = null;
    let createdHere = false;
    let paid = false;
    try {
      if (pendingOrderId) {
        orderId = pendingOrderId;
      } else {
        const orderResult = await createOrderWithProvisioning({
          listing_id: listing.id,
          bandwidth_gb: bandwidth,
          session_type: listing.proxy_type === 'sticky' ? 'sticky' : 'rotating',
        });
        orderId = orderResult.order.id;
        createdHere = true;
      }

      const quote = await quotePaystackPayment(orderId);
      if (quote.pay_from_balance) {
        paid = true;
        setPayStartedAt(Date.now());
        setPayStage('paid');
        await payOrderFromBalance(orderId);
      } else {
        setCheckoutOpen(true);
        let outcome: 'success' | 'cancelled';
        try {
          outcome = await openPaystackCheckout(quote.access_code);
        } finally {
          setCheckoutOpen(false);
        }
        if (outcome === 'cancelled') {
          // The popup can close after a mobile money prompt; ask the server once.
          const check = await verifyPaystackPayment(orderId, quote.reference);
          if (check.status === 'quoted') {
            await cancelOrder(orderId).catch(() => undefined);
            setNotice("Payment cancelled. You weren't charged.");
            return;
          }
        }
        paid = true;
        setPayStartedAt(Date.now());
        setPayStage('quoted');
        await waitForPaystackActive(orderId, quote.reference, setPayStage);
      }
      setPayStage('active');
      await finishOrder(orderId);
    } catch (err: unknown) {
      console.error(err);
      if (err instanceof ApiError && err.code === 'active_plan_exists') {
        // The preview switches the dialog to the "already have a plan" screen.
        void refetchPreview();
        return;
      }
      if (orderId && createdHere && !paid) {
        // Nothing was charged: don't leave an unpaid order behind.
        await cancelOrder(orderId).catch(() => undefined);
      }
      if (err instanceof PurchaseOutcomeError) {
        setFailure({ outcome: err.outcome, message: err.message });
      } else if (paid) {
        setFailure({
          outcome: 'slow',
          message:
            'Your payment is safe, but we lost contact while setting it up. We finish it automatically, so check Orders in a minute.',
        });
      } else {
        setError(getErrorMessage(err) || 'Payment failed. Please try again.');
      }
    } finally {
      void queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
      setPayStage(null);
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    if (managedFlow) {
      await handleManagedConnect();
      return;
    }
    if (paymentInFlight.current) return;
    if (!e2eMockBuy && (!wallet || !publicKey)) {
      toast.warning('Wallet required', 'Please connect your Solana wallet first.');
      return;
    }

    paymentInFlight.current = true;
    setLoading(true);
    setError('');
    try {
      if (!e2eMockBuy) {
        await assertExpectedSolanaCluster();
        if (publicKey) {
          await assertBuyerHasSolOnCluster(publicKey);
        }
      }
      const order = pendingOrderId
        ? await getOrder(pendingOrderId)
        : (
            await createOrderWithProvisioning({
              listing_id: listing.id,
              bandwidth_gb: bandwidth,
              session_type: listing.proxy_type === 'sticky' ? 'sticky' : 'rotating',
            })
          ).order;
      setPendingOrderId(order.id);
      if (order.status === 'active' || order.status === 'completed') {
        await finishOrder(order.id);
        return;
      }
      if (!['pending', 'pending_payment'].includes(order.status)) {
        throw new Error('Review this existing order before paying again.');
      }

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

      await finishOrder(order.id);
    } catch (err: unknown) {
      console.error(err);
      if (err instanceof WrongSolanaClusterError || err instanceof ApiError) {
        setError(err.message);
      } else {
        const walletMsg = formatSolanaWalletError(err);
        const apiMsg = getErrorMessage(err);
        setError(
          walletMsg ||
            apiMsg ||
            'Could not start the connection. Check that your wallet has enough SOL.'
        );
      }
    } finally {
      paymentInFlight.current = false;
      setLoading(false);
    }
  };

  if (credentials) {
    return (
      <Modal
        open
        onOpenChange={(open) => {
          if (!open) closeModal();
        }}
        title="You're connected"
        description="Turn it on here, or use it in any app"
        testId="buy-listing-modal-success"
        footer={
          <div className="flex w-full flex-col gap-2">
            {completedOrderId ? (
              <Link
                href={ROUTES.marketplaceOrder(completedOrderId)}
                className="inline-flex w-full items-center justify-center rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-medium hover:bg-secondary"
              >
                View order
              </Link>
            ) : null}
            <Button type="button" onClick={closeModal} className="w-full">
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
            Your proxy is ready. Turn it on in this browser, or use it in another app or device.
          </p>
        </div>

        <div className="space-y-3">
          {completedOrderId ? (
            <ExtensionConnectCard orderId={completedOrderId} listingTitle={listing.title} compact />
          ) : null}
          <MarketplaceOrderCredentials credentials={credentials} />
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Your plan stops when its bandwidth is used up. You can find it any time under Orders.
        </p>
      </Modal>
    );
  }

  if (managedFlow) {
    return (
      <ManagedBuyView
        listing={listing}
        open={!checkoutOpen}
        onClose={closeModal}
        busy={loading}
        payStage={payStage}
        payStartedAt={payStartedAt}
        failure={failure}
        notice={notice}
        error={error}
        bandwidth={bandwidth}
        setBandwidth={setBandwidth}
        preview={preview}
        priceReady={priceReady}
        previewError={previewError ? getErrorMessage(previewError) : ''}
        estimatedCostUSD={estimatedCostUSD}
        onPay={() => void handleConnect()}
        onRetry={() => {
          setFailure(null);
          void refetchPreview();
        }}
      />
    );
  }

  return (
    <Modal
      open={!checkoutOpen}
      onOpenChange={(open) => {
        if (!open && !loading) onClose();
      }}
      title="Buy with SOL"
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
            {estimatedCostSOL != null ? `Pay ${estimatedCostSOL.toFixed(4)} SOL` : 'Pay with SOL'}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            You pay from your Solana wallet. The money is held safely until your bandwidth is used.
            This shop runs on Solana {shopSolanaClusterLabel()}, so set Phantom to it before you pay.
          </p>
          <MoneyRailHint rail="escrow" />
        </div>
      }
    >
      <div className="space-y-5">
        {!publicKey && <UnlockWalletPrompt compact />}
        <div className="flex gap-4 rounded-[var(--radius-md)] border border-border bg-secondary p-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-primary font-mono text-sm font-semibold text-primary-foreground">
            {listing.proxy_type?.[0]?.toUpperCase() ?? 'P'}
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">{listing.title}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <ShieldCheck size={12} className="text-[var(--info)]" aria-hidden />
                {listing.listing_offer_verified ? 'Verified provider' : 'Provider not verified yet'}
              </span>
              <span className="inline-flex items-center gap-1 font-mono">
                <Zap size={12} className="text-[var(--warning)]" aria-hidden />
                {listing.avg_latency_ms > 0
                  ? `${listing.avg_latency_ms} ms · ${['gateway', 'explorer'].includes(listing.sla_source || '') ? 'measured' : 'reported'}`
                  : 'Speed not measured yet'}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--info)_30%,var(--border))] bg-[color-mix(in_srgb,var(--info)_8%,transparent)] p-4">
          <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold text-[var(--info)]">
            <AlertCircle size={14} aria-hidden />
            You pay once for the amount you pick
          </h4>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Your proxy works until that bandwidth is used up. Nothing is charged after that.
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
            disabled={loading || Boolean(pendingOrderId)}
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
            <span className="min-w-0 flex-1">{error}</span>
            {pendingOrderId ? (
              <Link className="shrink-0 underline" href={ROUTES.marketplaceOrder(pendingOrderId)}>
                Review existing order
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
