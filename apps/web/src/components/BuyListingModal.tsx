'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ShieldCheck,
  Zap,
  Power,
  AlertCircle,
  CheckCircle,
  Coins,
  Copy,
  CreditCard,
  ExternalLink,
  Loader2,
  RefreshCw,
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
  getManagedCheckoutPreview,
  getOrderProxyCredentials,
  initiateSmartContractPayment,
  marketplaceKeys,
  payOrderFromBalance,
  quotePaystackPayment,
  verifyPaystackPayment,
  waitForOrderActive,
  type ManagedCheckoutPreview,
  type MarketplaceProxyCredentials,
  type Order,
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
  shopSolanaCluster,
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
import { WalletBoundary } from '@/providers/WalletBoundary';
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

function formatUSD(amount: number) {
  return amount > 0 && amount < 0.01 ? 'less than $0.01' : `$${amount.toFixed(2)}`;
}

/**
 * SOL with enough decimals to be meaningful for small orders. `roundUp` is for amounts
 * the buyer has to send: rounding down would leave the wallet a few lamports short.
 */
function formatSOL(amount: number, roundUp = false) {
  if (!Number.isFinite(amount) || amount <= 0) return '0 SOL';
  const digits = amount >= 1 ? 3 : amount >= 0.01 ? 4 : 6;
  const f = 10 ** digits;
  const v = roundUp ? Math.ceil(amount * f - 1e-7) / f : Math.round(amount * f) / f;
  // Drop trailing zeros: 0.0079 SOL, not 0.007900 SOL.
  return `${parseFloat(v.toFixed(digits))} SOL`;
}

function formatDay(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** How a Google-account buyer pays. SOL is the main way; card / mobile money is the fallback. */
type ManagedPayMethod = 'sol' | 'card';

/** Whether card / mobile money can be picked for this checkout, and why not. */
function cardOption(quote: Extract<ManagedCheckoutPreview, { active_plan: false }> | null) {
  if (!quote) return { available: false, note: '' };
  if (!quote.fiat_enabled) return { available: false, note: 'Not available yet' };
  if (quote.pay_from_balance) return { available: false, note: 'Not needed. Your SOL covers this order.' };
  if (quote.fiat_error || quote.amount_ghs == null) {
    return { available: false, note: quote.fiat_error || 'Price unavailable right now' };
  }
  return { available: true, note: `No SOL? Pay ${formatGHS(quote.amount_ghs)} in Ghana cedis.` };
}

function AddSolPanel({
  address,
  shortfallSOL,
  refreshing,
  onRefresh,
}: {
  address: string;
  shortfallSOL: number;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const network = shopSolanaCluster();
  const label = shopSolanaClusterLabel();
  const testFunds = network !== 'mainnet-beta';
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    setCopyError('');
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      setCopyError('Copy is unavailable. Select the address and copy it.');
    }
  }

  return (
    <div
      className="space-y-3 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--warning)_30%,var(--border))] bg-[color-mix(in_srgb,var(--warning)_6%,transparent)] p-4"
      data-testid="buy-add-sol"
    >
      <p className="text-sm font-medium text-foreground">
        Add at least {formatSOL(shortfallSOL, true)} to your ProxyHubb wallet
      </p>
      <p className="text-xs text-muted-foreground">
        Send SOL on Solana {label} to this address. Your balance updates here by itself.
      </p>
      <code className="block select-all break-all rounded-[var(--radius-sm)] bg-background/60 px-2 py-1.5 font-mono text-xs leading-5 text-foreground">
        {address}
      </code>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          {copied ? <CheckCircle size={14} className="mr-1.5" aria-hidden /> : <Copy size={14} className="mr-1.5" aria-hidden />}
          {copied ? 'Copied' : 'Copy address'}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw size={14} className={`mr-1.5 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
          Check balance
        </Button>
        {testFunds ? (
          <a
            href="https://faucet.solana.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-8 items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
          >
            Get free {label} SOL
            <ExternalLink size={12} aria-hidden />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : null}
      </div>
      {testFunds ? (
        <p className="text-xs text-muted-foreground">
          Only send {label.toLowerCase()} SOL. This shop does not use real funds.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
        {copyError || (copied ? 'Address copied.' : '')}
      </p>
    </div>
  );
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
  /** An order already exists for this amount (resumed, or kept for a retry). */
  amountLocked: boolean;
  preview: ManagedCheckoutPreview | undefined;
  priceReady: boolean;
  previewError: string;
  refreshing: boolean;
  onRefresh: () => void;
  estimatedCostUSD: number;
  method: ManagedPayMethod;
  setMethod: (method: ManagedPayMethod) => void;
  onPay: (method: ManagedPayMethod) => void;
  onRetry: () => void;
}

/**
 * The buy dialog for Google-account buyers: pick an amount → pay with SOL from the
 * ProxyHubb wallet (main way) or by card / mobile money (fallback) → setting up → done.
 */
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
  amountLocked,
  preview,
  priceReady,
  previewError,
  refreshing,
  onRefresh,
  estimatedCostUSD,
  method,
  setMethod,
  onPay,
  onRetry,
}: ManagedBuyViewProps) {
  const minGb = listing.min_purchase_gb || 1;
  const maxGb = Math.min(listing.available_bandwidth_gb || 1000, 100);
  const quote = preview && !preview.active_plan ? preview : null;
  const card = cardOption(quote);
  // A card choice that stopped making sense (SOL arrived, or card payments were
  // switched off) falls back to SOL.
  const payMethod: ManagedPayMethod = method === 'card' && card.available ? 'card' : 'sol';
  const solShort = !!quote && !quote.pay_from_balance;

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
    const optionClass = (selected: boolean, disabled: boolean) =>
      `flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border p-3 transition-colors ${
        selected
          ? 'border-primary bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]'
          : 'border-border bg-secondary hover:border-[color-mix(in_srgb,var(--primary)_40%,var(--border))]'
      } ${disabled ? 'cursor-not-allowed opacity-60 hover:border-border' : ''}`;

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
            disabled={busy || amountLocked}
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

        <fieldset className="space-y-2" disabled={busy}>
          <legend className="mb-2 text-sm font-medium text-foreground">Pay with</legend>
          <label className={optionClass(payMethod === 'sol', false)} data-testid="buy-method-sol">
            <input
              type="radio"
              name="buy-pay-method"
              value="sol"
              checked={payMethod === 'sol'}
              onChange={() => setMethod('sol')}
              className="mt-1 accent-[var(--primary)]"
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                <Coins size={15} className="text-primary" aria-hidden />
                Solana (SOL)
                <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
                  Main
                </span>
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                From your ProxyHubb wallet
                {quote ? <> · You have <span className="font-mono">{formatSOL(quote.balance_sol)}</span></> : null}
              </span>
            </span>
          </label>
          <label
            className={optionClass(payMethod === 'card', !card.available)}
            data-testid="buy-method-card"
            aria-disabled={!card.available}
          >
            <input
              type="radio"
              name="buy-pay-method"
              value="card"
              checked={payMethod === 'card'}
              disabled={!card.available}
              onChange={() => setMethod('card')}
              className="mt-1 accent-[var(--primary)]"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <CreditCard size={15} aria-hidden />
                Card or mobile money
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {card.note || (quote ? '' : 'Checking…')}
              </span>
            </span>
          </label>
        </fieldset>

        {payMethod === 'sol' ? (
          <div className="rounded-[var(--radius-md)] border border-border bg-secondary p-4">
            <p className="text-xs text-muted-foreground">You pay</p>
            <p
              className="mt-1 font-mono text-3xl font-semibold text-foreground"
              data-testid="buy-listing-price-sol"
            >
              {priceReady && quote ? formatSOL(quote.amount_sol) : '…'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              About {formatUSD(quote?.usd_total ?? estimatedCostUSD)}. Held safely on Solana until you
              use the bandwidth.
            </p>
            {quote ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Your wallet needs {formatSOL(quote.required_sol, true)} in total: the price plus
                about {formatSOL(Math.max(0, quote.required_sol - quote.amount_sol), true)} for
                Solana network costs and a small reserve that stays in your wallet.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="rounded-[var(--radius-md)] border border-border bg-secondary p-4">
            <p className="text-xs text-muted-foreground">You pay</p>
            <p
              className="mt-1 font-mono text-3xl font-semibold text-foreground"
              data-testid="buy-listing-price-ghs"
            >
              {priceReady && quote?.amount_ghs != null ? formatGHS(quote.amount_ghs) : '…'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              About {formatUSD(quote?.usd_total ?? estimatedCostUSD)}. Card and mobile money fees
              included.
            </p>
            {quote?.credit_ghs && quote.credit_ghs > 0 ? (
              <p className="mt-2 text-xs text-[var(--success)]">
                {formatGHS(quote.credit_ghs)} of SOL already in your ProxyHubb wallet is taken off.
              </p>
            ) : null}
          </div>
        )}

        {payMethod === 'sol' && solShort && quote ? (
          <>
            <AddSolPanel
              address={quote.wallet_address}
              shortfallSOL={quote.shortfall_sol}
              refreshing={refreshing}
              onRefresh={onRefresh}
            />
            {!card.available && !quote.fiat_enabled ? (
              <p className="text-xs text-muted-foreground">
                Card and mobile money payments are not available yet, so add SOL to buy.
              </p>
            ) : null}
          </>
        ) : null}

        <ol className="space-y-2 text-sm text-muted-foreground">
          <li className="flex gap-2">
            <span className="font-mono text-foreground">1.</span>
            {payMethod === 'sol'
              ? 'You pay in SOL from your ProxyHubb wallet. No extension needed.'
              : 'You pay by card or mobile money. We turn it into SOL in your ProxyHubb wallet.'}
          </li>
          <li className="flex gap-2">
            <span className="font-mono text-foreground">2.</span>
            The SOL is held safely on Solana until you use the bandwidth.
          </li>
          <li className="flex gap-2">
            <span className="font-mono text-foreground">3.</span>
            You get your proxy login right away. SOL for bandwidth you don&apos;t use comes back to
            your wallet.
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

    if (payMethod === 'sol') {
      footer = (
        <div className="flex w-full flex-col gap-2">
          <Button
            type="button"
            data-testid="buy-listing-start-connection"
            onClick={() => onPay('sol')}
            disabled={busy || !priceReady || solShort}
            isLoading={busy}
            className="w-full"
          >
            <Coins size={18} className="mr-2" aria-hidden />
            {!priceReady || !quote
              ? 'Pay with SOL'
              : solShort
                ? 'Add SOL to pay'
                : `Pay ${formatSOL(quote.amount_sol)}`}
          </Button>
          {solShort && card.available && quote?.amount_ghs != null ? (
            <Button
              type="button"
              variant="outline"
              data-testid="buy-pay-with-card-instead"
              onClick={() => setMethod('card')}
              disabled={busy}
              className="w-full"
            >
              <CreditCard size={16} className="mr-2" aria-hidden />
              No SOL? Pay {formatGHS(quote.amount_ghs)} by card or mobile money
            </Button>
          ) : null}
        </div>
      );
    } else {
      footer = (
        <div className="flex w-full flex-col gap-2">
          <Button
            type="button"
            data-testid="buy-listing-start-connection"
            onClick={() => onPay('card')}
            disabled={busy || !priceReady}
            isLoading={busy}
            className="w-full"
          >
            <CreditCard size={18} className="mr-2" aria-hidden />
            {priceReady && quote?.amount_ghs != null
              ? `Pay ${formatGHS(quote.amount_ghs)}`
              : 'Pay with card or mobile money'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setMethod('sol')}
            disabled={busy}
            className="w-full"
          >
            Pay with SOL instead
          </Button>
        </div>
      );
    }
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

/**
 * Buy dialog. Pays from the browser wallet (or the managed Paystack flow),
 * so it must always mount inside a wallet provider no matter which route
 * opened it. Layout-level wallet allowlists previously left this dialog on
 * the disconnected default wallet context for signed-in buyers; wrapping
 * here removes that failure mode for every present and future caller
 * (WalletBoundary is a no-op when a provider already exists above).
 */
export function BuyListingModal(props: BuyListingModalProps) {
  return (
    <WalletBoundary>
      <BuyListingModalInner {...props} />
    </WalletBoundary>
  );
}

function BuyListingModalInner({
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
  // The API forbids self-purchase (self_purchase_forbidden). Say so up front
  // instead of letting the buyer connect a wallet and fail at order creation.
  const isOwnListing = Boolean(user?.id && listing.seller_id && listing.seller_id === user.id);
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
  // Google-account buyers pay with SOL from their ProxyHubb wallet unless they pick
  // card / mobile money (only offered when SOL is short and card payments are on).
  const [payMethod, setPayMethod] = useState<ManagedPayMethod>('sol');
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

  const e2eMockBuyFlag =
    process.env.NODE_ENV !== 'production' &&
    typeof window !== 'undefined' &&
    !!(window as Window & { __PROXYHUB_E2E_MOCK_BUY__?: boolean }).__PROXYHUB_E2E_MOCK_BUY__;
  const e2eMockBuy =
    process.env.NODE_ENV !== 'production' &&
    (process.env.NEXT_PUBLIC_PLAYWRIGHT_E2E_MOCK_BUY === '1' || e2eMockBuyFlag);
  // The build-wide e2e flag only fakes browser-wallet signing. Google-account checkout
  // runs against stubbed APIs, so only a test that asks for the mock explicitly skips it.
  const managedFlow = managedWallet && !e2eMockBuyFlag;

  const {
    data: preview,
    isFetching: previewFetching,
    error: previewError,
    refetch: refetchPreview,
  } = useQuery({
    queryKey: ['managed-checkout-preview', listing.id, previewGb],
    queryFn: () => getManagedCheckoutPreview(listing.id, previewGb),
    enabled: managedFlow,
    staleTime: 30_000,
    // While the buyer is adding SOL, notice it arriving without a click.
    refetchInterval: (query) => {
      const data = query.state.data;
      return data && !data.active_plan && !data.pay_from_balance && payMethod === 'sol' && !loading
        ? 10_000
        : false;
    },
  });
  // A background balance re-check keeps the current price on screen; a new amount waits.
  const priceReady = !!preview && !preview.active_plan && previewGb === bandwidth;

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
   * Google-account buyers. SOL (the main way): the server opens the on-chain escrow from
   * SOL already in their ProxyHubb wallet. Card / mobile money (fallback): they pay in
   * GHS with Paystack, the treasury sends the missing SOL, and the server opens the same
   * escrow.
   */
  const handleManagedConnect = async (method: ManagedPayMethod) => {
    setLoading(true);
    setError('');
    setNotice('');
    setFailure(null);
    let orderId: string | null = null;
    let createdHere = false;
    let paid = false;
    // Set when a SOL payment may still land, so the order is kept for a retry.
    let keepOrder = false;
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

      if (method === 'sol') {
        setPayStartedAt(Date.now());
        setPayStage('paid');
        try {
          await payOrderFromBalance(orderId);
        } catch (payErr: unknown) {
          // These answers come before any SOL moves.
          if (payErr instanceof ApiError && (payErr.status < 500 || payErr.status === 503)) {
            throw payErr;
          }
          // A lost connection or a failed escrow send may still land. Keep this order:
          // paying again finds an escrow that landed and finishes the same order.
          keepOrder = true;
          setPendingOrderId(orderId);
          throw payErr;
        }
        paid = true;
        setPayStage('active');
        await finishOrder(orderId);
        return;
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
      if (orderId && createdHere && !paid && !keepOrder) {
        // Nothing was charged: don't leave an unpaid order behind.
        await cancelOrder(orderId).catch(() => undefined);
      }
      if (keepOrder) {
        setError(
          'We could not confirm your SOL payment yet. Nothing is lost: press Pay again to finish this same order, or check Orders in a minute.'
        );
        return;
      }
      if (err instanceof ApiError && err.code === 'insufficient_balance') {
        void refetchPreview();
        setError('Your ProxyHubb wallet does not have enough SOL for this order yet. Add SOL, or pay by card or mobile money if it is offered.');
        return;
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

  const handleConnect = async (method: ManagedPayMethod = 'sol') => {
    if (isOwnListing) {
      setError("This is your own listing. Sign in with a different (buyer) wallet to buy it, or open someone else's listing.");
      return;
    }
    if (managedFlow) {
      await handleManagedConnect(method);
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
        amountLocked={Boolean(pendingOrderId)}
        preview={preview}
        priceReady={priceReady}
        previewError={previewError ? getErrorMessage(previewError) : ''}
        refreshing={previewFetching}
        onRefresh={() => void refetchPreview()}
        estimatedCostUSD={estimatedCostUSD}
        method={payMethod}
        setMethod={(next) => {
          setError('');
          setPayMethod(next);
        }}
        onPay={(method) => void handleConnect(method)}
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
            disabled={loading || isOwnListing}
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
        {isOwnListing ? (
          <div
            className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--warning)_30%,var(--border))] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] p-3 text-sm text-[var(--warning)]"
            role="note"
          >
            <AlertCircle size={16} aria-hidden />
            <span>This is your own listing — you can&apos;t buy it with this account. Use a different buyer wallet to test a purchase.</span>
          </div>
        ) : !publicKey ? (
          <UnlockWalletPrompt compact expectedAddress={user?.wallet_address ?? null} />
        ) : null}
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
