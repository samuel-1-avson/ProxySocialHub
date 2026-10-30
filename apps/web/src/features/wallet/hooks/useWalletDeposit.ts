"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { depositCrypto } from "@/lib/api";
import { ApiError } from "@/lib/api/client";
import {
  formatSolanaWalletError,
  sendSolTransfer,
  SolTransferFailedError,
} from "@/lib/solana-transfer";
import { getSolscanTxUrl } from "@/lib/solscan";
import { parseSolAmountLamports } from "@/lib/sol-amount";
import {
  assertExpectedSolanaCluster,
  getConnection,
  shopSolanaCluster,
} from "@/lib/solana";
import { DEPOSIT_FEE_BUFFER_LAMPORTS } from "../constants";
import {
  useTransferSession,
  readTransferSession,
  writeTransferSession,
} from "../transfer-session";
import type { WalletResult } from "../types";

type SolanaWallet = ReturnType<typeof useSolanaWallet>;
type DepositReceipt = {
  amountInput: string;
  amount: number;
  signature: string;
  userId?: string;
};
function parseReceipt(
  raw: string | null,
  userId?: string,
): DepositReceipt | null {
  try {
    const value = JSON.parse(raw || "null");
    const lamports = parseSolAmountLamports(value?.amountInput ?? "");
    return value &&
      typeof value.signature === "string" &&
      value.signature.length > 0 &&
      lamports !== null &&
      lamports > 0 &&
      value.amount === lamports / LAMPORTS_PER_SOL &&
      (!value.userId || value.userId === userId)
      ? value
      : null;
  } catch {
    return null;
  }
}
export function useWalletDeposit(opts: {
  userId?: string;
  wallet:
    | { linked_solana_address?: string | null; solana_network?: string }
    | null
    | undefined;
  treasuryConfig:
    | { treasury_solana?: string | null; deposit_address?: string | null }
    | null
    | undefined;
  connected: boolean;
  publicKey: SolanaWallet["publicKey"];
  signTransaction: SolanaWallet["signTransaction"];
  sendTransaction: SolanaWallet["sendTransaction"];
  processing: boolean;
  setProcessing: Dispatch<SetStateAction<boolean>>;
  setResult: Dispatch<SetStateAction<WalletResult | null>>;
  queryClient: QueryClient;
}) {
  const {
    userId,
    wallet,
    treasuryConfig,
    connected,
    publicKey,
    signTransaction,
    sendTransaction,
    processing,
    setProcessing,
    setResult,
    queryClient,
  } = opts;
  const network = shopSolanaCluster();
  const address = wallet?.linked_solana_address;
  const scope = `${userId}:${address}:${network}`;
  // Keep the earlier key readable so already-submitted deposits recover after an upgrade.
  const recoveryKey = `proxyhubb-account-deposit:${address}:${network}`;
  const rawReceipt = useTransferSession(recoveryKey);
  const pending = useMemo(
    () => parseReceipt(rawReceipt, userId),
    [rawReceipt, userId],
  );
  const [depositAmount, setDepositAmount] = useState("");
  const [showDepositConfirm, setShowDepositConfirm] = useState(false);
  const [local, setLocal] = useState<{
    scope: string;
    phase: "idle" | "approving" | "confirming" | "completed" | "failed";
  }>({ scope: "", phase: "idle" });
  const inFlight = useRef(false);
  const currentScope = useRef(scope);
  useEffect(() => {
    currentScope.current = scope;
  }, [scope]);
  const ledgerMatches =
    !wallet?.solana_network ||
    wallet.solana_network.replace("mainnet-beta", "mainnet") ===
      network.replace("mainnet-beta", "mainnet");

  const verification = useQuery({
    queryKey: ["wallet-deposit-verification", scope, pending?.signature],
    enabled: Boolean(
      userId && address && pending && ledgerMatches && !processing,
    ),
    queryFn: async () => {
      if (!pending) throw new Error("No pending deposit");
      // HTTP status checks work even when a browser or network blocks Solana WebSockets.
      const observed = await getConnection()
        .getSignatureStatuses([pending.signature], {
          searchTransactionHistory: true,
        })
        .catch(() => null);
      if (observed?.value[0]?.err) {
        if (readTransferSession(recoveryKey) === rawReceipt)
          writeTransferSession(recoveryKey, null);
        if (currentScope.current === scope) {
          setLocal({ scope, phase: "failed" });
          setResult({
            success: false,
            message:
              "The deposit failed on chain. Your account was not credited. Review the amount before trying again.",
          });
        }
        return { status: "failed" };
      }
      // A retry only verifies this receipt. It never requests another wallet transfer.
      const lamports = parseSolAmountLamports(pending.amountInput)!;
      const res = await depositCrypto(
        pending.amount,
        pending.signature,
        "solana",
        lamports,
      );
      if (["success", "completed", "credited"].includes(res.status)) {
        if (readTransferSession(recoveryKey) === rawReceipt)
          writeTransferSession(recoveryKey, null);
        void queryClient.invalidateQueries({ queryKey: ["wallet"] });
        void queryClient.invalidateQueries({
          queryKey: ["wallet-chain-balance"],
        });
        if (currentScope.current === scope) {
          setLocal({ scope, phase: "completed" });
          setDepositAmount("");
          setResult({
            success: true,
            message: `${res.credited_sol ?? res.credited ?? pending.amount} SOL added to your account funds.`,
            solscanUrl: res.solscan_url || getSolscanTxUrl(pending.signature),
          });
        }
      }
      return res;
    },
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    // Respect the API's five-per-minute limit. Pause on owner/policy errors.
    refetchInterval: (query) =>
      query.state.error instanceof ApiError &&
      [401, 403].includes(query.state.error.status)
        ? false
        : 30_000,
  });
  const localPhase = local.scope === scope ? local.phase : "idle";
  const phase = pending
    ? processing && localPhase === "confirming"
      ? "confirming"
      : verification.isFetching
        ? "verifying"
        : "pending"
    : localPhase;

  function initiateDeposit() {
    if (inFlight.current || processing || pending) return;
    const lamports = parseSolAmountLamports(depositAmount);
    if (lamports === null || lamports <= 0) {
      setResult({
        success: false,
        message: "Enter a positive SOL amount with up to 9 decimal places.",
      });
      return;
    }
    setResult(null);
    setShowDepositConfirm(true);
  }
  async function handleDepositSol() {
    if (
      inFlight.current ||
      processing ||
      parseReceipt(readTransferSession(recoveryKey), userId)
    )
      return;
    const lamports = parseSolAmountLamports(depositAmount);
    const treasury =
      treasuryConfig?.deposit_address || treasuryConfig?.treasury_solana;
    if (!lamports || !treasury || !userId || !address || !ledgerMatches) {
      setResult({
        success: false,
        message:
          "Your account and deposit destination must be available on the payment network before depositing.",
      });
      return;
    }
    if (
      !connected ||
      !publicKey ||
      publicKey.toBase58() !== address ||
      !signTransaction
    ) {
      setResult({
        success: false,
        message: "Connect your linked wallet to approve this deposit.",
      });
      return;
    }
    inFlight.current = true;
    setProcessing(true);
    setResult(null);
    try {
      const connection = getConnection();
      await assertExpectedSolanaCluster(connection);
      const balance = await connection.getBalance(publicKey, "confirmed");
      if (balance < lamports + DEPOSIT_FEE_BUFFER_LAMPORTS)
        throw new Error(
          "Your wallet needs enough SOL for this deposit and the network fee.",
        );
      if (currentScope.current !== scope) return;
      setLocal({ scope, phase: "approving" });
      setShowDepositConfirm(false);
      const payment = {
        amount: lamports / LAMPORTS_PER_SOL,
        amountInput: depositAmount,
        userId,
      };
      await sendSolTransfer(
        connection,
        { publicKey, signTransaction, sendTransaction },
        new PublicKey(treasury),
        lamports,
        (signature) => {
          writeTransferSession(recoveryKey, { ...payment, signature });
          if (currentScope.current === scope)
            setLocal({ scope, phase: "confirming" });
        },
        { waitForConfirmation: false },
      );
    } catch (err) {
      if (err instanceof SolTransferFailedError) {
        writeTransferSession(recoveryKey, null);
        if (currentScope.current === scope) {
          setLocal({ scope, phase: "failed" });
          setResult({
            success: false,
            message:
              "The deposit could not complete. Your account was not credited. You can review a new deposit.",
          });
        }
      } else if (
        !parseReceipt(readTransferSession(recoveryKey), userId) &&
        currentScope.current === scope
      ) {
        setLocal({ scope, phase: "failed" });
        setResult({ success: false, message: formatSolanaWalletError(err) });
      }
      // An uncertain confirmation retains the receipt and starts automatic verification.
    } finally {
      inFlight.current = false;
      setProcessing(false);
    }
  }
  return {
    depositAmount,
    setDepositAmount,
    showDepositConfirm,
    setShowDepositConfirm,
    initiateDeposit,
    handleDepositSol,
    pending,
    phase,
    verificationError: verification.isError,
    verifying: verification.isFetching,
    verificationPaused:
      verification.error instanceof ApiError &&
      [401, 403].includes(verification.error.status),
    checkDeposit: () => verification.refetch(),
  };
}
