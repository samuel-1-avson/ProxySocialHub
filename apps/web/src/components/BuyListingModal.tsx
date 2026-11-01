"use client";

import { WalletBoundary } from "@/providers/WalletBoundary";
import { useEffect, useRef, useState } from "react";
import {
  ShieldCheck,
  Zap,
  Power,
  AlertCircle,
  CheckCircle,
  Copy,
  Eye,
  EyeOff,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Listing,
  confirmEscrowPayment,
  createOrderWithProvisioning,
  getOrderProxyCredentials,
  getOrder,
  initiateSmartContractPayment,
  marketplaceKeys,
  waitForOrderActive,
  type MarketplaceProxyCredentials,
  type Order,
} from "@/lib/api/marketplace";
import { getSystemConfig } from "@/lib/api/config";
import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
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
} from "@/lib/solana";
import { formatSolanaWalletError } from "@/lib/solana-transfer";
import { useToast } from "@/stores";
import { getErrorMessage } from "@/lib/utils";
import { ApiError } from "@/lib/api/client";
import Link from "next/link";
import { ROUTES } from "@/lib/navigation/routes";
import {
  trackMarketplaceEvent,
  type MarketplaceFunnelSurface,
} from "@/lib/analytics/marketplace-funnel";
import { Modal } from "@/components/patterns/Modal";
import { Button } from "@/components/ui/button";
import { MoneyRailHint } from "@/components/MoneyRailHint";
import { UnlockWalletPrompt } from "@/components/UnlockWalletPrompt";
import { ExtensionConnectCard } from "@/components/marketplace/ExtensionConnectCard";

async function waitForFundedEscrow(
  buyer: string,
  seller: string,
  opts?: { timeoutMs?: number; intervalMs?: number; escrowPda?: string },
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
      (info.status === "Pending" || info.status === "Active") &&
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
  existingOrder?: Order;
  onClose: () => void;
  onSuccess: (
    orderId: string,
    credentials?: MarketplaceProxyCredentials,
  ) => void;
  surface?: MarketplaceFunnelSurface | string;
}

function BuyListingModalContent({
  listing,
  existingOrder,
  onClose,
  onSuccess,
  surface = "unknown",
}: BuyListingModalProps) {
  const { publicKey } = useWallet();
  const wallet = useAnchorWallet();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const paymentInFlight = useRef(false);
  const [error, setError] = useState("");
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(
    existingOrder?.id ?? null,
  );
  const [credentials, setCredentials] =
    useState<MarketplaceProxyCredentials | null>(null);
  const [completedOrderId, setCompletedOrderId] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState("");
  const minimumBandwidth =
    Number.isFinite(listing.min_purchase_gb) && listing.min_purchase_gb >= 0
      ? listing.min_purchase_gb
      : null;
  const availableBandwidth =
    Number.isFinite(listing.available_bandwidth_gb) &&
    listing.available_bandwidth_gb > 0
      ? listing.available_bandwidth_gb
      : null;
  const validPurchaseTerms =
    minimumBandwidth !== null &&
    availableBandwidth !== null &&
    minimumBandwidth <= availableBandwidth &&
    Number.isFinite(listing.price_per_gb) &&
    listing.price_per_gb > 0 &&
    listing.status === "active";
  const [bandwidth, setBandwidth] = useState(
    existingOrder?.bandwidth_gb ??
      (minimumBandwidth === 0
        ? Math.min(1, availableBandwidth ?? 0)
        : (minimumBandwidth ?? 0)),
  );
  const validSelection =
    validPurchaseTerms &&
    Number.isFinite(bandwidth) &&
    bandwidth > 0 &&
    bandwidth >= (minimumBandwidth ?? Infinity) &&
    bandwidth <= (availableBandwidth ?? 0);

  const { data: systemConfig } = useQuery({
    queryKey: ["system-config-public"],
    queryFn: getSystemConfig,
    staleTime: 60_000,
  });
  const solPriceUsd = Number(systemConfig?.sol_price_usd || 0);

  useEffect(() => {
    trackMarketplaceEvent("buy_modal_open", {
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
    existingOrder?.total_price ??
    existingOrder?.price_total ??
    effectivePricePerGB * bandwidth;
  const estimatedCostSOL =
    solPriceUsd > 0 ? estimatedCostUSD / solPriceUsd : null;
  const bulkRateActive = effectivePricePerGB < listing.price_per_gb - 1e-12;

  const copyToClipboard = async (text: string, key: string) => {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopyError(
        "Clipboard access is unavailable. Reveal and select the value to copy it manually.",
      );
    }
  };

  const e2eMockBuy =
    process.env.NODE_ENV !== "production" &&
    (process.env.NEXT_PUBLIC_PLAYWRIGHT_E2E_MOCK_BUY === "1" ||
      (typeof window !== "undefined" &&
        !!(window as Window & { __PROXYHUB_E2E_MOCK_BUY__?: boolean })
          .__PROXYHUB_E2E_MOCK_BUY__));

  const finishOrder = async (orderId: string) => {
    const credsResponse = await getOrderProxyCredentials(orderId);
    const nextCredentials = credsResponse.proxy_credentials;
    if (
      !nextCredentials?.username ||
      !nextCredentials?.password ||
      !nextCredentials?.endpoint
    ) {
      throw new Error(
        "Order created, but proxy credentials were not returned after escrow confirmation.",
      );
    }

    setCompletedOrderId(orderId);
    setCredentials(nextCredentials);
    void queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
    onSuccess(orderId, nextCredentials);
  };

  const handleConnect = async () => {
    if (paymentInFlight.current) return;
    if (!pendingOrderId && !validSelection) {
      setError(
        "Purchase terms are unavailable. Reload this listing before starting a new order.",
      );
      return;
    }
    if (!e2eMockBuy && (!wallet || !publicKey)) {
      toast.warning(
        "Wallet required",
        "Please connect your Solana wallet first.",
      );
      return;
    }

    paymentInFlight.current = true;
    setLoading(true);
    setError("");
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
              session_type:
                listing.proxy_type === "sticky" ? "sticky" : "rotating",
            })
          ).order;
      setPendingOrderId(order.id);
      if (order.status === "active" || order.status === "completed") {
        await finishOrder(order.id);
        return;
      }
      if (!["pending", "pending_payment"].includes(order.status)) {
        throw new Error(
          "Review this existing order before attempting payment again.",
        );
      }

      const params = await initiateSmartContractPayment(order.id);
      const buyerPk = params.buyer_pubkey || publicKey?.toBase58() || "";
      const sellerPk = params.seller_pubkey;

      let escrowTx: string | undefined;
      const useMultisig = params.escrow_seed_kind === "multisig";
      const escrowPdaHint = params.escrow_pda;
      const ensureEscrowOnChain = async () => {
        if (e2eMockBuy) return;
        if (!buyerPk || !sellerPk) {
          throw new Error("Missing buyer/seller wallet for escrow.");
        }
        const already = escrowPdaHint
          ? await getEscrowInfoByPDA(escrowPdaHint)
          : await getEscrowInfo(buyerPk, sellerPk);
        if (
          already &&
          already.amount > 0 &&
          (already.status === "Pending" || already.status === "Active")
        ) {
          return;
        }
        try {
          if (useMultisig) {
            if (!params.escrow_expires_at) {
              throw new Error(
                "Missing escrow_expires_at for multisig escrow init.",
              );
            }
            const { tx } = await initializeEscrowMultisig(
              wallet,
              sellerPk,
              params.amount_lamports,
              params.bandwidth_gb,
              params.escrow_expires_at,
            );
            escrowTx = tx;
          } else {
            const { tx } = await initializeEscrow(
              wallet,
              sellerPk,
              params.amount_lamports,
              params.bandwidth_gb,
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
            "Escrow transaction did not land on-chain. Approve the wallet popup, ensure you have enough SOL, then try again.",
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
          confirmErr instanceof ApiError ? confirmErr.code : undefined;
        const msg = getErrorMessage(confirmErr);
        if (code === "escrow_missing" || /escrow not found/i.test(msg)) {
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
            "Failed to connect. Check your on-chain SOL wallet balance (devnet).",
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
          if (!open) onClose();
        }}
        title="Purchase complete"
        description="Connect in Chrome, or copy credentials for curl and SDKs"
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
            Connect with ProxyHubb to turn on HTTP CONNECT in this browser.
            Credentials below are for curl and other clients.
          </p>
        </div>

        {completedOrderId ? (
          <div className="mb-4">
            <ExtensionConnectCard
              orderId={completedOrderId}
              listingTitle={listing.title}
              compact
            />
          </div>
        ) : null}

        <div className="space-y-3 rounded-[var(--radius-md)] border border-border bg-secondary p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Proxy credentials
          </p>
          <p className="text-xs text-muted-foreground">
            HTTP CONNECT at this endpoint. Password is HMAC for the public buyer
            edge.
          </p>
          {[
            { label: "Endpoint", value: credentials.endpoint, key: "endpoint" },
            { label: "Username", value: credentials.username, key: "username" },
          ].map(({ label, value, key }) => (
            <div key={key} className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="break-all font-mono text-sm text-foreground">
                  {value}
                </p>
              </div>
              <button
                type="button"
                onClick={() => copyToClipboard(value, key)}
                className="shrink-0 rounded-[var(--radius-sm)] p-2 text-muted-foreground hover:bg-background hover:text-foreground"
                aria-label={`Copy ${label}`}
              >
                {copied === key ? (
                  <CheckCircle
                    size={14}
                    className="text-[var(--success)]"
                    aria-hidden
                  />
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
                {showPass ? credentials.password : "••••••••••••"}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="rounded-[var(--radius-sm)] p-2 text-muted-foreground hover:bg-background hover:text-foreground"
                aria-label={showPass ? "Hide password" : "Reveal password"}
                aria-pressed={showPass}
              >
                {showPass ? (
                  <EyeOff size={14} aria-hidden />
                ) : (
                  <Eye size={14} aria-hidden />
                )}
              </button>
              <button
                type="button"
                onClick={() =>
                  copyToClipboard(credentials.password, "password")
                }
                className="rounded-[var(--radius-sm)] p-2 text-muted-foreground hover:bg-background hover:text-foreground"
                aria-label="Copy password"
              >
                {copied === "password" ? (
                  <CheckCircle
                    size={14}
                    className="text-[var(--success)]"
                    aria-hidden
                  />
                ) : (
                  <Copy size={14} aria-hidden />
                )}
              </button>
            </div>
          </div>
        </div>

        {copied && (
          <p role="status" className="sr-only">
            Copied {copied} to clipboard.
          </p>
        )}
        {copyError && (
          <p role="alert" className="ui-error mt-4">
            {copyError}
          </p>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Configure your client as an HTTP proxy. Traffic consumes your
          purchased bandwidth, and the session ends when its quota is reached.
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
      title="Review purchase"
      description={listing.title}
      testId="buy-listing-modal"
      footer={
        <div className="flex w-full flex-col gap-2">
          <Button
            type="button"
            data-testid="buy-listing-start-connection"
            onClick={() => void handleConnect()}
            disabled={loading || (!pendingOrderId && !validSelection)}
            isLoading={loading}
            className="w-full"
          >
            <Power size={18} className="mr-2" aria-hidden />
            Fund escrow & continue
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            You pay from your linked Solana wallet into on-chain escrow.
            Platform balance is not used. Session ends when bandwidth quota is
            exhausted. This shop settles on Solana {shopSolanaClusterLabel()} —
            set Phantom to that cluster before you pay.
          </p>
          <MoneyRailHint rail="escrow" />
        </div>
      }
    >
      <div className="space-y-5">
        {!pendingOrderId && !validPurchaseTerms && (
          <p role="alert" className="ui-error">
            Purchase terms are unavailable. Reload this listing before starting
            a new order.
          </p>
        )}
        {!publicKey && <UnlockWalletPrompt compact />}
        <div className="flex gap-4 rounded-[var(--radius-md)] border border-border bg-secondary p-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-primary font-mono text-sm font-semibold text-primary-foreground">
            {listing.proxy_type?.[0]?.toUpperCase() ?? "P"}
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {listing.title}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <ShieldCheck
                  size={12}
                  className="text-[var(--info)]"
                  aria-hidden
                />
                {listing.listing_offer_verified
                  ? "Signed offer verified"
                  : "Offer signature not verified"}
              </span>
              <span className="inline-flex items-center gap-1 font-mono">
                <Zap size={12} className="text-[var(--warning)]" aria-hidden />
                {listing.avg_latency_ms > 0
                  ? `${listing.avg_latency_ms} ms · ${["gateway", "explorer"].includes(listing.sla_source || "") ? "measured" : "reported"}`
                  : "Latency unmeasured"}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--info)_30%,var(--border))] bg-[color-mix(in_srgb,var(--info)_8%,transparent)] p-4">
          <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold text-[var(--info)]">
            <AlertCircle size={14} aria-hidden />
            Bandwidth held in escrow
          </h4>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Fund the selected bandwidth quota from your SOL wallet. Usage is
            settled against the order escrow, and the session ends when its
            quota is exhausted.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label
              htmlFor="buy-bandwidth"
              className="text-xs font-medium text-muted-foreground"
            >
              Bandwidth quota
            </label>
            <span className="font-mono text-sm font-semibold text-foreground">
              {bandwidth} GB
            </span>
          </div>
          <input
            id="buy-bandwidth"
            type="range"
            min={minimumBandwidth ?? 0}
            max={
              validPurchaseTerms
                ? Math.min(
                    availableBandwidth!,
                    Math.max(100, minimumBandwidth!),
                  )
                : 0
            }
            step={1}
            disabled={loading || Boolean(pendingOrderId) || !validPurchaseTerms}
            value={bandwidth}
            onChange={(e) => setBandwidth(Number(e.target.value))}
            className="w-full accent-[var(--primary)]"
          />
          <div className="flex justify-between font-mono text-xs text-muted-foreground">
            <span>
              Min:{" "}
              {minimumBandwidth === 0
                ? "No minimum"
                : (minimumBandwidth ?? "—") + " GB"}
            </span>
            <span>Avail: {availableBandwidth ?? "—"} GB</span>
          </div>
        </div>

        {validPurchaseTerms && bandwidth <= 0 && (
          <p role="status" className="text-sm text-muted-foreground">
            Select a positive bandwidth quota to continue.
          </p>
        )}
        <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-border bg-secondary p-4">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">
              Estimated total
            </p>
            <p
              data-testid="buy-estimated-total"
              className="font-mono text-2xl font-semibold text-[var(--success)]"
            >
              {existingOrder || validPurchaseTerms
                ? "$" +
                  estimatedCostUSD.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 8,
                  })
                : "—"}
            </p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {estimatedCostSOL != null
                ? `≈ ${estimatedCostSOL.toFixed(9)} SOL escrow`
                : "SOL estimate pending price feed"}
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
            {pendingOrderId && (
              <Link
                className="underline"
                href={`/app/activity/orders/${encodeURIComponent(pendingOrderId)}`}
              >
                Review existing order
              </Link>
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

export function BuyListingModal(props: BuyListingModalProps) {
  return (
    <WalletBoundary>
      <BuyListingModalContent {...props} />
    </WalletBoundary>
  );
}
