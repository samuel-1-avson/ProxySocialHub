"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import {
  getWithdrawals,
  requestWithdrawChallenge,
  withdrawWallet,
} from "@/lib/api";
import { ApiError } from "@/lib/api/client";
import { signWithdrawChallengeMessage } from "@/lib/solana-message-sign";
import { formatSolanaWalletError } from "@/lib/solana-transfer";
import { getSolscanTxUrl } from "@/lib/solscan";
import { shopSolanaCluster } from "@/lib/solana";
import { parseSolAmountLamports } from "@/lib/sol-amount";
import {
  readTransferSession,
  useTransferSession,
  writeTransferSession,
} from "../transfer-session";
import type { WalletResult } from "../types";

type SolanaWallet = ReturnType<typeof useSolanaWallet>;
type WithdrawalReceipt = {
  userId: string;
  destination: string;
  amountInput: string;
  amountLamports: number;
  key: string;
  reference?: string;
  status?: string;
};
function parseReceipt(
  raw: string | null,
  userId?: string,
  address?: string | null,
): WithdrawalReceipt | null {
  try {
    const value = JSON.parse(raw || "null");
    return value &&
      value.userId === userId &&
      value.destination === address &&
      typeof value.key === "string" &&
      value.key.length > 0 &&
      Number.isSafeInteger(value.amountLamports) &&
      value.amountLamports > 0 &&
      parseSolAmountLamports(value.amountInput) === value.amountLamports
      ? value
      : null;
  } catch {
    return null;
  }
}
export function useWalletWithdraw(opts: {
  userId?: string;
  wallet:
    | {
        linked_solana_address?: string | null;
        balance_sol?: number | string | null;
        solana_network?: string;
      }
    | null
    | undefined;
  connected: boolean;
  publicKey: SolanaWallet["publicKey"];
  signMessage: SolanaWallet["signMessage"];
  processing: boolean;
  setProcessing: Dispatch<SetStateAction<boolean>>;
  setResult: Dispatch<SetStateAction<WalletResult | null>>;
  queryClient: QueryClient;
}) {
  const {
    userId,
    wallet,
    connected,
    publicKey,
    signMessage,
    processing,
    setProcessing,
    setResult,
    queryClient,
  } = opts;
  const address = wallet?.linked_solana_address;
  const network = shopSolanaCluster();
  const scope = `${userId}:${address}:${network}`;
  const recoveryKey = `proxyhubb-account-withdrawal:${scope}`;
  const rawReceipt = useTransferSession(recoveryKey);
  const pending = useMemo(
    () => parseReceipt(rawReceipt, userId, address),
    [rawReceipt, userId, address],
  );
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [local, setLocal] = useState<{
    scope: string;
    phase: "idle" | "approving" | "submitting" | "completed" | "failed";
  }>({ scope: "", phase: "idle" });
  const inFlight = useRef(false);
  const currentScope = useRef(scope);
  useEffect(() => {
    currentScope.current = scope;
  }, [scope]);
  const localPhase = local.scope === scope ? local.phase : "idle";
  function finish(status: string, txHash?: string) {
    if (status === "completed" || status === "failed")
      writeTransferSession(recoveryKey, null);
    void queryClient.invalidateQueries({ queryKey: ["wallet"] });
    void queryClient.invalidateQueries({ queryKey: ["wallet-chain-balance"] });
    if (currentScope.current !== scope) return;
    setLocal({ scope, phase: status === "completed" ? "completed" : "failed" });
    setWithdrawAmount("");
    setResult({
      success: status === "completed",
      message:
        status === "completed"
          ? "Withdrawal completed. SOL has been sent to your linked wallet."
          : "This withdrawal needs attention. Review its status in Activity before making another request.",
      solscanUrl:
        status === "completed" && txHash ? getSolscanTxUrl(txHash) : undefined,
    });
  }
  const statusQuery = useQuery({
    queryKey: ["wallet-withdrawal-status", scope, pending?.reference],
    enabled: Boolean(userId && pending?.reference && !processing),
    queryFn: async () => {
      const rows = await getWithdrawals(20);
      const row = rows.find((item) => item.reference === pending?.reference);
      if (row && ["completed", "failed", "ops_required"].includes(row.status))
        finish(row.status, row.tx_hash);
      return row ?? null;
    },
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.status === "ops_required" ? false : 5_000,
    refetchOnWindowFocus: true,
  });
  async function handleWithdrawSol() {
    if (inFlight.current || processing) return;
    const existing = parseReceipt(
      readTransferSession(recoveryKey),
      userId,
      address,
    );
    if (existing?.reference) return; // The queue owns it; only read its status.
    const exactLamports =
      existing?.amountLamports ?? parseSolAmountLamports(withdrawAmount);
    const input = existing?.amountInput ?? withdrawAmount;
    if (!userId || !address || !exactLamports || exactLamports <= 0) {
      setResult({
        success: false,
        message: "Enter a positive SOL amount and link your payment wallet.",
      });
      return;
    }
    if (
      wallet?.solana_network &&
      wallet.solana_network.replace("mainnet-beta", "mainnet") !==
        network.replace("mainnet-beta", "mainnet")
    ) {
      setResult({
        success: false,
        message:
          "Your account must use the payment network before withdrawing.",
      });
      return;
    }
    if (!existing && exactLamports / 1e9 > Number(wallet?.balance_sol ?? 0)) {
      setResult({
        success: false,
        message: "Your account does not have enough SOL for this withdrawal.",
      });
      return;
    }
    if (
      !connected ||
      !publicKey ||
      publicKey.toBase58() !== address ||
      !signMessage
    ) {
      setResult({
        success: false,
        message: "Connect your linked wallet to approve this withdrawal.",
      });
      return;
    }
    inFlight.current = true;
    setProcessing(true);
    setResult(null);
    let attempted = existing;
    try {
      setLocal({ scope, phase: "approving" });
      const challenge = await requestWithdrawChallenge(exactLamports);
      if (
        challenge.destination !== address ||
        challenge.amount_lamports !== exactLamports
      )
        throw new Error(
          "The withdrawal details changed. Please review the amount and destination again.",
        );
      if (currentScope.current !== scope) return;
      // Wallet approval signs the server's amount/destination challenge. No text is copied by the user.
      const { signature } = await signWithdrawChallengeMessage(
        signMessage,
        challenge.message,
      );
      if (currentScope.current !== scope) return;
      attempted = existing ?? {
        userId,
        destination: address,
        amountInput: input,
        amountLamports: exactLamports,
        key: crypto.randomUUID(),
      };
      // Persist before the request: a lost response must never create a second debit on reload.
      writeTransferSession(recoveryKey, attempted);
      setLocal({ scope, phase: "submitting" });
      const res = await withdrawWallet(exactLamports / 1e9, "", "", {
        amountLamports: exactLamports,
        idempotencyKey: attempted.key,
        challengeNonce: challenge.nonce,
        signature,
      });
      if (["completed", "failed"].includes(res.status))
        finish(res.status, res.tx_hash);
      else {
        writeTransferSession(recoveryKey, {
          ...attempted,
          reference: res.reference || undefined,
          status: res.status,
        });
        if (res.status === "ops_required") finish(res.status, res.tx_hash);
      }
      void queryClient.invalidateQueries({ queryKey: ["wallet"] });
    } catch (err) {
      const reference =
        err instanceof ApiError ? err.details?.reference : undefined;
      if (
        attempted &&
        err instanceof ApiError &&
        err.status === 409 &&
        typeof reference === "string" &&
        reference
      ) {
        writeTransferSession(recoveryKey, {
          ...attempted,
          reference,
          status: String(err.details?.status || "requested"),
        });
      } else if (
        !existing &&
        err instanceof ApiError &&
        [400, 401, 403, 404, 422].includes(err.status)
      ) {
        writeTransferSession(recoveryKey, null);
        if (currentScope.current === scope) {
          setLocal({ scope, phase: "failed" });
          setResult({
            success: false,
            message: /signature|challenge_nonce|POST \/v1/i.test(err.message)
              ? "Your approval could not be verified. Reconnect your wallet and approve the withdrawal again."
              : err.message,
          });
        }
      } else if (!attempted && currentScope.current === scope) {
        setLocal({ scope, phase: "failed" });
        setResult({ success: false, message: formatSolanaWalletError(err) });
      }
      // Unknown outcomes retain the exact attempt. Resuming uses its original idempotency key.
    } finally {
      inFlight.current = false;
      setProcessing(false);
    }
  }
  return {
    withdrawAmount,
    setWithdrawAmount,
    handleWithdrawSol,
    pending,
    phase: processing
      ? localPhase
      : pending
        ? pending.status === "ops_required"
          ? "failed"
          : "pending"
        : localPhase,
    statusUnavailable: statusQuery.isError,
    checkingStatus: statusQuery.isFetching,
    checkWithdrawal: () => statusQuery.refetch(),
  };
}
