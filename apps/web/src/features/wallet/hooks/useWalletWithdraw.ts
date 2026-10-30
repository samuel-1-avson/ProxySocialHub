"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import {
  getWithdrawals,
  requestWithdrawChallenge,
  withdrawWallet,
} from "@/lib/api";
import { signWithdrawChallengeMessage } from "@/lib/solana-message-sign";
import { WITHDRAW_SIGNATURE_THRESHOLD_SOL } from "../constants";
import { getSolscanTxUrl } from "@/lib/solscan";
import { getErrorMessage } from "@/lib/utils";
import type { QueryClient } from "@tanstack/react-query";
import type { WalletResult } from "../types";
import { parseSolAmountLamports } from "@/lib/sol-amount";

type SolanaWallet = ReturnType<typeof useSolanaWallet>;

type WalletLike =
  | {
      linked_solana_address?: string | null;
      balance_sol?: number | string | null;
    }
  | null
  | undefined;

export function useWalletWithdraw(opts: {
  wallet: WalletLike;
  connected: boolean;
  publicKey: SolanaWallet["publicKey"];
  signMessage: SolanaWallet["signMessage"];
  largeWithdrawThresholdSOL: number;
  processing: boolean;
  setProcessing: Dispatch<SetStateAction<boolean>>;
  setResult: Dispatch<SetStateAction<WalletResult | null>>;
  queryClient: QueryClient;
}) {
  const {
    wallet,
    connected,
    publicKey,
    signMessage,
    largeWithdrawThresholdSOL,
    processing,
    setProcessing,
    setResult,
    queryClient,
  } = opts;

  const [withdrawAmount, setWithdrawAmount] = useState("");
  // P0-9: one idempotency key per (amount) attempt; retries reuse it so the
  // server replays the first result instead of debiting twice.
  const idemRef = useRef<{ amount: number; key: string } | null>(null);
  const withdrawRequiresSignature =
    parseFloat(withdrawAmount) >
    Math.min(largeWithdrawThresholdSOL, WITHDRAW_SIGNATURE_THRESHOLD_SOL);

  // W-35: hard double-submit guard. The shared `processing` state
  // propagates a render too late to stop double-clicks/Enter repeats.
  const inFlightRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [pendingWithdrawal, setPendingWithdrawal] = useState<string | null>(
    null,
  );
  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    [],
  );

  const pollWithdrawalStatus = (reference?: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    let ticks = 0;
    pollRef.current = setInterval(async () => {
      ticks += 1;
      try {
        const rows = await getWithdrawals(5);
        const row = reference
          ? rows.find((r) => r.reference === reference)
          : rows.find(
              (r) =>
                !["completed", "failed", "ops_required"].includes(r.status),
            );
        if (!row) {
          if (ticks >= 36 && pollRef.current) clearInterval(pollRef.current);
          return;
        }
        if (row.status === "completed") {
          setPendingWithdrawal(null);
          setResult({
            success: true,
            message: "Withdrawal completed",
            solscanUrl: row.tx_hash ? getSolscanTxUrl(row.tx_hash) : undefined,
          });
          queryClient.invalidateQueries({ queryKey: ["wallet"] });
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (row.status === "failed" || row.status === "ops_required") {
          setPendingWithdrawal(null);
          setResult({
            success: false,
            message:
              "Withdrawal needs attention. Review its status in wallet activity before retrying.",
          });
          queryClient.invalidateQueries({ queryKey: ["wallet"] });
          if (pollRef.current) clearInterval(pollRef.current);
        } else {
          setPendingWithdrawal(`Withdrawal ${row.status}...`);
        }
      } catch {
        // transient poll failure: keep trying until the tick budget ends
      }
      if (ticks >= 36 && pollRef.current) {
        clearInterval(pollRef.current);
        setPendingWithdrawal(null);
      }
    }, 5000);
  };

  const handleWithdrawSol = async () => {
    if (inFlightRef.current) return;
    if (!wallet?.linked_solana_address) {
      setResult({
        success: false,
        message: "Link a Solana wallet before withdrawing",
      });
      return;
    }
    const exactLamports = parseSolAmountLamports(withdrawAmount);
    const amt = exactLamports === null ? 0 : exactLamports / 1_000_000_000;
    if (!amt || amt <= 0) {
      setResult({ success: false, message: "Enter a valid withdrawal amount" });
      return;
    }
    if (amt > Number(wallet.balance_sol || 0)) {
      setResult({ success: false, message: "Insufficient custodial balance" });
      return;
    }

    inFlightRef.current = true;
    setProcessing(true);
    setResult(null);
    try {
      let opts:
        | {
            nonce?: string;
            signature?: string;
            challengeNonce?: string;
            idempotencyKey?: string;
            amountLamports?: number;
          }
        | undefined;
      // W-13: above the dust threshold, sign the SERVER challenge (binds
      // user + destination + exact lamports; single-use, 5 min).
      const sigThreshold = Math.min(
        largeWithdrawThresholdSOL,
        WITHDRAW_SIGNATURE_THRESHOLD_SOL,
      );
      if (amt > sigThreshold) {
        if (!signMessage || !connected || !publicKey) {
          throw new Error(
            `Withdrawals over ${sigThreshold} SOL require wallet signature. Connect Phantom/Solflare`,
          );
        }
        const linked = wallet.linked_solana_address;
        if (publicKey.toBase58() !== linked) {
          throw new Error(
            `Connected wallet must match your linked address (${linked.slice(0, 4)}…${linked.slice(-4)})`,
          );
        }
        const challenge = await requestWithdrawChallenge(exactLamports!);
        if (
          challenge.destination !== wallet.linked_solana_address ||
          challenge.amount_lamports !== exactLamports
        )
          throw new Error(
            "The withdrawal challenge does not match the requested amount and destination.",
          );
        const { signature } = await signWithdrawChallengeMessage(
          signMessage,
          challenge.message,
        );
        opts = { challengeNonce: challenge.nonce, signature };
      }
      if (!idemRef.current || idemRef.current.amount !== amt) {
        const key =
          globalThis.crypto?.randomUUID?.() ??
          "withdraw-" + Date.now() + "-" + Math.random().toString(36).slice(2);
        idemRef.current = { amount: amt, key };
      }
      opts = {
        ...(opts ?? {}),
        idempotencyKey: idemRef.current.key,
        amountLamports: exactLamports!,
      };
      const res = await withdrawWallet(amt, "", "", opts);
      const txRef = res.tx_hash;
      const processing = !["completed", "failed", "ops_required"].includes(
        res.status,
      );
      const failed = ["failed", "ops_required"].includes(res.status);
      setResult({
        success: !failed,
        message: failed
          ? `Withdrawal ${res.status}. Review wallet activity before retrying.`
          : processing
            ? res.message ||
              `Withdrawal ${res.status}. Review wallet activity for settlement.`
            : txRef
              ? `Withdrawal submitted (${txRef.slice(0, 12)}…)`
              : "Withdrawal submitted",
        solscanUrl: processing
          ? undefined
          : res.solscan_url || (txRef ? getSolscanTxUrl(txRef) : undefined),
      });
      idemRef.current = null;
      setWithdrawAmount("");
      if (processing) {
        setPendingWithdrawal("Withdrawal queued...");
        pollWithdrawalStatus(res.reference || undefined);
      }
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
    } catch (err: unknown) {
      setResult({
        success: false,
        message: getErrorMessage(err) || "Withdrawal failed",
      });
    } finally {
      inFlightRef.current = false;
      setProcessing(false);
    }
  };

  return {
    withdrawAmount,
    setWithdrawAmount,
    withdrawRequiresSignature,
    processing,
    pendingWithdrawal,
    handleWithdrawSol,
  };
}
