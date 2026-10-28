"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useAuth } from "@/lib/auth";
import {
  getPassCatalog,
  getMyPass,
  getPassMigration,
  preparePassPurchase,
  confirmPassPurchase,
  type PreparePassPurchaseResponse,
  type PassCatalogItem,
} from "@/lib/api/passes";
import { getMySubscription, cancelSubscription } from "@/lib/api/subscriptions";
import {
  getConnection,
  assertExpectedSolanaCluster,
  shopSolanaClusterLabel,
} from "@/lib/solana";
import { sendSolTransfer, SolTransferFailedError } from "@/lib/solana-transfer";
import { Modal } from "@/components/patterns/Modal";
import {
  Loading,
  DataError,
  Status,
  amount,
  shortDate,
} from "@/components/workspace/Patterns";

type PendingPass = { tier: string; signature: string; purchaseId?: string };
function readPending(key: string): PendingPass | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    return value &&
      typeof value.tier === "string" &&
      typeof value.signature === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}
function httpsLink(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function BuyerBilling() {
  const { user } = useAuth();
  const wallet = useWallet();
  const client = useQueryClient();
  const key = `proxyhubb-pass-payment:${user?.id}:${shopSolanaClusterLabel()}`;
  const [pending, setPending] = useState<PendingPass | null>(() =>
    readPending(key),
  );
  const [selection, setSelection] = useState<PassCatalogItem | null>(null);
  const [quote, setQuote] = useState<PreparePassPurchaseResponse | null>(null);
  const [manualTier, setManualTier] = useState("");
  const [manualSignature, setManualSignature] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const keys = useRef(new Map<string, string>());
  const paymentInFlight = useRef(false);
  const mine = useQuery({
    queryKey: ["buyer-pass", user?.id],
    queryFn: getMyPass,
    staleTime: 15_000,
  });
  const catalog = useQuery({
    queryKey: ["pass-catalog"],
    queryFn: getPassCatalog,
    staleTime: 60_000,
  });
  const migration = useQuery({
    queryKey: ["buyer-pass-migration", user?.id],
    queryFn: getPassMigration,
    retry: 1,
  });
  const legacy = useQuery({
    queryKey: ["workspace-subscription", user?.id],
    queryFn: getMySubscription,
    retry: 1,
  });
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ["buyer-pass"] });
    void client.invalidateQueries({ queryKey: ["workspace-subscription"] });
    void client.invalidateQueries({ queryKey: ["wallet"] });
  };
  const confirm = useMutation({
    retry: false,
    mutationFn: (payment: PendingPass) =>
      confirmPassPurchase({
        tx_signature: payment.signature,
        purchase_id: payment.purchaseId,
        tier: payment.tier,
      }),
    onSuccess: (_result, payment) => {
      if (readPending(key)?.signature === payment.signature) {
        try {
          sessionStorage.removeItem(key);
        } catch {
          /* Storage may be disabled. */
        }
      }
      setPending((current) =>
        current?.signature === payment.signature ? null : current,
      );
      invalidate();
    },
  });
  const prepare = useMutation({
    retry: false,
    mutationFn: async (item: PassCatalogItem) => {
      if (!keys.current.has(item.tier))
        keys.current.set(item.tier, crypto.randomUUID());
      return preparePassPurchase(item.tier, keys.current.get(item.tier));
    },
    onSuccess: (result) => setQuote(result),
  });
  const pay = useMutation({
    retry: false,
    mutationFn: async () => {
      if (paymentInFlight.current)
        throw new Error("A payment is already in progress.");
      paymentInFlight.current = true;
      try {
        if (pending) {
          await confirm.mutateAsync(pending);
          return;
        }
        if (
          !quote ||
          quote.mode !== "treasury_sol_transfer" ||
          !quote.treasury ||
          !quote.purchase_id
        )
          throw new Error("A complete payment quote is required.");
        if (
          !wallet.connected ||
          !wallet.publicKey ||
          wallet.publicKey.toBase58() !== quote.buyer_wallet
        )
          throw new Error("Connect the wallet matching this purchase quote.");
        if (
          !Number.isSafeInteger(quote.amount_lamports) ||
          quote.amount_lamports! <= 0
        )
          throw new Error(
            "The quoted amount is invalid. No transaction was sent.",
          );
        const connection = getConnection();
        await assertExpectedSolanaCluster(connection);
        const signature = await sendSolTransfer(
          connection,
          {
            publicKey: wallet.publicKey,
            signTransaction: wallet.signTransaction,
            sendTransaction: wallet.sendTransaction,
          },
          new PublicKey(quote.treasury),
          quote.amount_lamports!,
          (signature) => {
            const payment = {
              tier: quote.tier,
              signature,
              purchaseId: quote.purchase_id,
            };
            setPending(payment);
            try {
              sessionStorage.setItem(key, JSON.stringify(payment));
            } catch {
              /* Keep recovery available in memory. */
            }
          },
        );
        const payment = {
          tier: quote.tier,
          signature,
          purchaseId: quote.purchase_id,
        };
        setPending(payment);
        try {
          sessionStorage.setItem(key, JSON.stringify(payment));
        } catch {
          /* Keep recovery available in memory. */
        }
        await confirm.mutateAsync(payment);
      } catch (error) {
        if (error instanceof SolTransferFailedError) {
          setPending((current) =>
            current?.signature === error.signature ? null : current,
          );
          if (readPending(key)?.signature === error.signature) {
            try {
              sessionStorage.removeItem(key);
            } catch {
              /* Optional recovery storage. */
            }
          }
        }
        throw error;
      } finally {
        paymentInFlight.current = false;
      }
    },
    onSuccess: () => {
      setSelection(null);
      setQuote(null);
    },
  });
  const cancel = useMutation({
    retry: false,
    mutationFn: () => cancelSubscription("Cancelled from account billing"),
    onSuccess: () => {
      setCancelOpen(false);
      invalidate();
    },
  });
  const external = httpsLink(quote?.purchase_url || selection?.purchase_url);
  return (
    <div className="ui-page">
      <section className="ui-surface ui-page">
        <div className="ui-section-heading">
          <h2>Access Pass & entitlements</h2>
          <Status tone={mine.isSuccess ? "good" : "neutral"}>
            {mine.data?.name || "Entitlement unavailable"}
          </Status>
        </div>
        {mine.isLoading && <Loading label="Loading your current access…" />}
        {mine.isError && (
          <DataError error={mine.error} retry={() => void mine.refetch()} />
        )}
        {mine.data && (
          <dl className="ui-detail-list">
            <div>
              <dt>Current tier</dt>
              <dd>{mine.data.tier}</dd>
            </div>
            <div>
              <dt>Entitlement source</dt>
              <dd>{mine.data.source.replace(/_/g, " ")}</dd>
            </div>
            <div>
              <dt>Period quota</dt>
              <dd>
                {mine.data.quota.unlimited
                  ? "Unlimited"
                  : `${amount(mine.data.quota.remaining_gb)} GB remaining of ${amount(mine.data.quota.limit_gb)} GB`}
              </dd>
            </div>
            <div>
              <dt>Legacy access until</dt>
              <dd>
                {mine.data.legacy_access_until
                  ? shortDate(mine.data.legacy_access_until)
                  : "No legacy period reported"}
              </dd>
            </div>
          </dl>
        )}
        <p className="ui-note">
          Access Passes provide account entitlements. Bandwidth orders have
          their own purchased quota and escrow; a pass does not confirm an
          active proxy connection.
        </p>
        <button
          className="ui-button secondary self-start"
          onClick={() => void mine.refetch()}
        >
          Refresh entitlements
        </button>
      </section>
      {pending && (
        <section className="ui-attention">
          <h3>Verify the existing pass payment</h3>
          <p>
            The original transaction is retained for {pending.tier}.
            Verification does not send another transfer.
          </p>
          <p className="ui-note" style={{ overflowWrap: "anywhere" }}>
            {pending.signature}
          </p>
          <button
            className="ui-button secondary"
            disabled={confirm.isPending}
            onClick={() => confirm.mutate(pending)}
          >
            Verify existing pass payment
          </button>
        </section>
      )}
      {confirm.isError && <DataError error={confirm.error} />}
      {confirm.isSuccess && (
        <p className="ui-note" role="status">
          {confirm.data.message} Refreshing the reported entitlement.
        </p>
      )}
      {catalog.isLoading && <Loading label="Loading available passes…" />}
      {catalog.isError && (
        <DataError error={catalog.error} retry={() => void catalog.refetch()} />
      )}
      {catalog.data && (
        <section>
          <h2 className="mb-4">Available passes</h2>
          {catalog.data.passes.map((item) => (
            <article className="ui-listing" key={item.tier}>
              <div>
                <h2>{item.name}</h2>
                <p className="ui-note">
                  {item.bandwidth_limit_gb == null
                    ? "Unlimited period quota"
                    : `${amount(item.bandwidth_limit_gb)} GB period quota`}{" "}
                  · {item.listing_limit} listing allowance
                </p>
                <ul className="ui-note mt-3">
                  {item.benefits?.map((benefit) => (
                    <li key={benefit}>{benefit}</li>
                  ))}
                </ul>
              </div>
              <div className="ui-listing-price">
                <strong>
                  {item.price_sol > 0
                    ? `${amount(item.price_sol, 9)} SOL`
                    : "Free"}
                </strong>
                <p>
                  {mine.data?.tier === item.tier
                    ? "Current entitlement"
                    : "Pass payment is separate from order escrow"}
                </p>
                {item.tier !== "none" && mine.data?.tier !== item.tier && (
                  <button
                    className="ui-button secondary small"
                    disabled={Boolean(pending)}
                    onClick={() => {
                      setSelection(item);
                      setQuote(null);
                      prepare.reset();
                      pay.reset();
                    }}
                  >
                    Review pass
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>
      )}
      <details className="ui-note">
        <summary>Verify a payment from another session</summary>
        <form
          className="ui-page mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            confirm.mutate({
              tier: manualTier,
              signature: manualSignature.trim(),
            });
          }}
        >
          <label className="ui-field">
            Pass tier
            <select
              className="ui-select"
              required
              value={manualTier}
              onChange={(e) => setManualTier(e.target.value)}
            >
              <option value="">Choose the paid pass</option>
              {catalog.data?.passes
                .filter((item) => item.tier !== "none")
                .map((item) => (
                  <option key={item.tier} value={item.tier}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="ui-field">
            Existing pass transaction signature
            <input
              className="ui-input"
              required
              value={manualSignature}
              onChange={(e) => setManualSignature(e.target.value)}
            />
          </label>
          <button
            className="ui-button secondary self-start"
            disabled={
              confirm.isPending || !manualTier || !manualSignature.trim()
            }
          >
            Verify original payment
          </button>
        </form>
      </details>
      {migration.data && <p className="ui-note">{migration.data.message}</p>}
      {legacy.data?.subscription && (
        <section className="ui-surface">
          <h2>Legacy subscription</h2>
          <p className="ui-note">
            {legacy.data.current_plan?.name || "Legacy access"} ·{" "}
            {legacy.data.subscription.status}
            {legacy.data.subscription.current_period_end
              ? ` · Period ends ${shortDate(legacy.data.subscription.current_period_end)}`
              : ""}
          </p>
          {!legacy.data.subscription.cancelled_at && (
            <button
              className="ui-button secondary mt-4"
              onClick={() => setCancelOpen(true)}
            >
              Stop legacy renewal…
            </button>
          )}
        </section>
      )}
      <Link className="ui-link self-start" href="/app/wallet?tab=history">
        Wallet payment history →
      </Link>
      <Modal
        open={Boolean(selection)}
        onOpenChange={(open) => {
          if (!open && !pay.isPending) {
            setSelection(null);
            setQuote(null);
          }
        }}
        title={`Review ${selection?.name || "Access Pass"}`}
        description={`Payment settles on ${shopSolanaClusterLabel()}.`}
      >
        <div className="ui-page">
          <p className="ui-note">
            The server supplies the final amount, destination, and purchase
            method before a wallet transfer is requested.
          </p>
          {prepare.isError && <DataError error={prepare.error} />}
          {pay.isError && <DataError error={pay.error} />}
          {!quote ? (
            <button
              className="ui-button"
              disabled={prepare.isPending || !selection}
              onClick={() => {
                if (selection) prepare.mutate(selection);
              }}
            >
              {prepare.isPending ? "Getting quote…" : "Get payment quote"}
            </button>
          ) : (
            <>
              <dl className="ui-detail-list">
                <div>
                  <dt>Amount</dt>
                  <dd>
                    {amount(
                      quote.amount_lamports != null
                        ? quote.amount_lamports / 1_000_000_000
                        : quote.amount_sol,
                      9,
                    )}{" "}
                    SOL
                  </dd>
                </div>
                <div>
                  <dt>Wallet</dt>
                  <dd>{quote.buyer_wallet}</dd>
                </div>
                <div>
                  <dt>Destination</dt>
                  <dd>{quote.treasury || "External purchase provider"}</dd>
                </div>
              </dl>
              {quote.mode === "external" ? (
                external ? (
                  <a
                    className="ui-button"
                    href={external}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open purchase provider ↗
                  </a>
                ) : (
                  <DataError
                    error={
                      new Error("The purchase provider link is unavailable.")
                    }
                  />
                )
              ) : (
                <button
                  className="ui-button"
                  disabled={
                    pay.isPending ||
                    confirm.isPending ||
                    !wallet.connected ||
                    !wallet.publicKey ||
                    wallet.publicKey.toBase58() !== quote.buyer_wallet
                  }
                  onClick={() => pay.mutate()}
                >
                  {pay.isPending
                    ? "Processing…"
                    : pending
                      ? "Verify existing transfer"
                      : "Approve pass payment in wallet"}
                </button>
              )}
              {(!wallet.connected ||
                wallet.publicKey?.toBase58() !== quote.buyer_wallet) && (
                <Link className="ui-link" href="/app/wallet">
                  Connect the quoted wallet →
                </Link>
              )}
            </>
          )}
        </div>
      </Modal>
      <Modal
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Stop legacy subscription renewal?"
        description="The server reports how long existing access remains available."
      >
        {cancel.isError && <DataError error={cancel.error} />}
        <button
          className="ui-button"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          Confirm cancellation
        </button>
      </Modal>
    </div>
  );
}
