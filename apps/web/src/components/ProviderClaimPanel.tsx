"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { useAuth } from "@/lib/auth";
import {
  confirmProviderClaim,
  getProviderClaimSummary,
  prepareProviderClaim,
  type ProviderClaimPrepareResponse,
} from "@/lib/api/provider";
import { explorerHref } from "@/lib/navigation/workspace";
import { Loading, DataError, amount } from "@/components/workspace/Patterns";

export function ProviderClaimPanel() {
  const { user } = useAuth();
  const wallet = useWallet();
  const client = useQueryClient();
  const [progress, setProgress] = useState("");
  const [hasSigned, setHasSigned] = useState(false);
  const signed = useRef<{
    prepared: ProviderClaimPrepareResponse;
    signature: string;
  } | null>(null);
  const query = useQuery({
    queryKey: ["provider-claim-summary", user?.id],
    queryFn: getProviderClaimSummary,
    staleTime: 15_000,
  });
  const claim = query.data;
  const matching = Boolean(
    wallet.connected &&
      wallet.publicKey &&
      wallet.publicKey.toBase58() === claim?.payout_wallet,
  );
  const eligible = Boolean(
    claim?.oracle_ready &&
      claim.pending_count > 0 &&
      claim.pending_sol >= claim.min_claim_sol &&
      claim.payout_wallet,
  );
  const submit = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!matching || !wallet.signMessage || !wallet.publicKey)
        throw new Error(
          "Connect the Solana wallet matching the reported payout address.",
        );
      if (!signed.current) {
        const prepared = await prepareProviderClaim();
        if (prepared.wallet !== wallet.publicKey.toBase58())
          throw new Error(
            "The prepared payout address does not match your connected wallet.",
          );
        if (!prepared.message || !prepared.claim_id)
          throw new Error(
            "The payout authorization was incomplete. No message was signed.",
          );
        if (
          Number.isFinite(Date.parse(prepared.expires_at)) &&
          Date.parse(prepared.expires_at) <= Date.now()
        )
          throw new Error(
            "This payout authorization has expired. Refresh eligibility before trying again.",
          );
        setProgress("Approve the payout authorization in your wallet…");
        const signature = bs58.encode(
          await wallet.signMessage(new TextEncoder().encode(prepared.message)),
        );
        signed.current = { prepared, signature };
      }
      const { prepared, signature } = signed.current;
      if (prepared.wallet !== wallet.publicKey.toBase58())
        throw new Error(
          "Reconnect the wallet that signed this authorization before retrying.",
        );
      setHasSigned(true);
      setProgress("Submitting the signed authorization…");
      return confirmProviderClaim({
        claim_id: prepared.claim_id,
        message: prepared.message,
        signature,
      });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["provider-claim-summary"] });
      void client.invalidateQueries({
        queryKey: ["provider-earnings-summary"],
      });
      void client.invalidateQueries({ queryKey: ["provider-earnings"] });
      void client.invalidateQueries({ queryKey: ["provider-payouts"] });
    },
    onSettled: () => setProgress(""),
  });
  return (
    <section className="ui-surface ui-page">
      <div>
        <h2>Protocol payout authorization</h2>
        <p className="ui-note">
          Authorize eligible protocol earnings with the configured payout
          wallet. This is separate from the account payable balance.
        </p>
      </div>
      {query.isLoading && (
        <Loading label="Loading protocol payout eligibility…" />
      )}
      {query.isError && (
        <DataError error={query.error} retry={() => void query.refetch()} />
      )}
      {claim && (
        <>
          <dl className="ui-detail-list">
            <div>
              <dt>Reported pending</dt>
              <dd>{amount(claim.pending_sol, 9)} SOL</dd>
            </div>
            <div>
              <dt>Minimum claim</dt>
              <dd>{amount(claim.min_claim_sol, 9)} SOL</dd>
            </div>
            <div>
              <dt>Payout address</dt>
              <dd style={{ overflowWrap: "anywhere" }}>
                {claim.payout_wallet || "Not configured"}
              </dd>
            </div>
          </dl>
          {!claim.payout_wallet ? (
            <Link className="ui-link" href="/app/settings">
              Link a payout wallet →
            </Link>
          ) : (
            !matching && (
              <p className="ui-note">
                Connect the wallet matching this payout address through{" "}
                <Link className="ui-link" href="/app/wallet">
                  Wallet settings
                </Link>{" "}
                before authorizing.
              </p>
            )
          )}
          {!claim.oracle_ready && (
            <p className="ui-note">
              The payout service is not ready. Authorization is temporarily
              unavailable.
            </p>
          )}
          {progress && (
            <p className="ui-note" role="status">
              {progress}
            </p>
          )}
          {submit.isError && <DataError error={submit.error} />}
          {submit.data && (
            <div className="ui-attention" role="status">
              <h3>Authorization response: {submit.data.status}</h3>
              {submit.data.tx_hash ? (
                <a
                  className="ui-link"
                  href={explorerHref(
                    `/transactions/${encodeURIComponent(submit.data.tx_hash)}`,
                  )}
                >
                  Inspect the reported transaction ↗
                </a>
              ) : (
                <p>
                  A transaction hash has not been returned. Review payout
                  history before attempting another authorization.
                </p>
              )}
            </div>
          )}
          <button
            className="ui-button self-start"
            disabled={
              !eligible || !matching || submit.isPending || submit.isSuccess
            }
            onClick={() => submit.mutate()}
          >
            {submit.isPending
              ? "Authorizing…"
              : submit.isSuccess
                ? "Authorization submitted"
                : hasSigned
                  ? "Retry signed authorization"
                  : "Authorize protocol payout"}
          </button>
        </>
      )}
    </section>
  );
}
