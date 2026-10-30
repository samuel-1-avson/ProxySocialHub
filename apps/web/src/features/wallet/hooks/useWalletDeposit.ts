"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { depositCrypto } from "@/lib/api";
import {
  formatSolanaWalletError,
  sendSolTransfer,
  SolTransferFailedError,
} from "@/lib/solana-transfer";
import { getSolscanTxUrl } from "@/lib/solscan";
import { getErrorMessage } from "@/lib/utils";
import type { QueryClient } from "@tanstack/react-query";
import { DEPOSIT_FEE_BUFFER_LAMPORTS } from "../constants";
import { parseSolAmountLamports } from "@/lib/sol-amount";
import type { WalletResult } from "../types";
import { assertExpectedSolanaCluster, shopSolanaCluster } from "@/lib/solana";

type RetainedDeposit = {
  amount: number;
  amountInput: string;
  signature: string;
};
function readDeposit(key: string): RetainedDeposit | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    return value &&
      typeof value.signature === "string" &&
      typeof value.amountInput === "string" &&
      value.amount > 0
      ? value
      : null;
  } catch {
    return null;
  }
}

type SolanaWallet = ReturnType<typeof useSolanaWallet>;

type WalletLike =
  | {
      linked_solana_address?: string | null;
    }
  | null
  | undefined;

type TreasuryConfigLike =
  | {
      treasury_solana?: string | null;
      deposit_address?: string | null;
      destination_kind?: "treasury" | "vault" | string | null;
      vault_address?: string | null;
    }
  | null
  | undefined;

export function useWalletDeposit(opts: {
  wallet: WalletLike;
  treasuryConfig: TreasuryConfigLike;
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

  const [depositAmount, setDepositAmount] = useState("");
  const [depositTxHash, setDepositTxHash] = useState("");
  const [showManualDeposit, setShowManualDeposit] = useState(false);
  const [showDepositConfirm, setShowDepositConfirm] = useState(false);
  const [depositConfirmAmount, setDepositConfirmAmount] = useState<
    number | null
  >(null);
  const recoveryKey = `proxyhubb-account-deposit:${wallet?.linked_solana_address}:${shopSolanaCluster()}`;
  const retainedDeposit = wallet?.linked_solana_address
    ? readDeposit(recoveryKey)
    : null;
  const restoreDeposit = (payment = retainedDeposit) => {
    if (!payment) return;
    setDepositAmount(payment.amountInput);
    setDepositTxHash(payment.signature);
    setShowManualDeposit(true);
  };
  const confirmedTransfer = useRef<{
    amount: number;
    signature: string;
  } | null>(null);

  const creditDepositOnServer = async (amt: number, signature: string) => {
    const exactLamports = parseSolAmountLamports(depositAmount);
    if (exactLamports === null || exactLamports <= 0)
      throw new Error(
        "Enter an exact SOL amount with at most 9 decimal places.",
      );
    const res = await depositCrypto(amt, signature, "solana", exactLamports);
    const solscan = res.solscan_url || getSolscanTxUrl(signature);
    setResult({
      success: true,
      message:
        res.message ||
        `Deposit verification: ${res.status}${res.credited_sol != null ? ` · ${res.credited_sol} SOL credited` : ""}`,
      solscanUrl: solscan,
    });
    setDepositAmount("");
    setDepositTxHash("");
    confirmedTransfer.current = null;
    try {
      sessionStorage.removeItem(recoveryKey);
    } catch {
      /* Optional recovery storage. */
    }
    queryClient.invalidateQueries({ queryKey: ["wallet"] });
  };

  // W-35: hard double-submit guard for deposit actions.
  const depositInFlightRef = useRef(false);

  const handleDepositVerify = async () => {
    if (depositInFlightRef.current) return;
    const exactLamports = parseSolAmountLamports(depositAmount);
    const amt = exactLamports === null ? 0 : exactLamports / LAMPORTS_PER_SOL;
    const txHash = depositTxHash.trim();
    if (!amt || amt <= 0 || !txHash) {
      setResult({
        success: false,
        message: "Enter deposit amount and transaction signature",
      });
      return;
    }
    if (!wallet?.linked_solana_address) {
      setResult({
        success: false,
        message: "Link a Solana wallet before verifying a deposit",
      });
      return;
    }
    depositInFlightRef.current = true;
    setProcessing(true);
    setResult(null);
    try {
      await creditDepositOnServer(amt, txHash);
    } catch (err: unknown) {
      setResult({
        success: false,
        message: getErrorMessage(err) || "Deposit verification failed",
      });
    } finally {
      depositInFlightRef.current = false;
      setProcessing(false);
    }
  };

  const initiateDeposit = () => {
    if (confirmedTransfer.current || retainedDeposit) {
      restoreDeposit();
      setShowManualDeposit(true);
      setResult({
        success: false,
        message:
          "A transfer was already submitted. Verify its existing transaction before sending another.",
      });
      return;
    }
    const exactLamports = parseSolAmountLamports(depositAmount);
    const amt = exactLamports === null ? 0 : exactLamports / LAMPORTS_PER_SOL;
    if (!amt || amt <= 0) {
      setResult({ success: false, message: "Enter a valid deposit amount" });
      return;
    }
    if (!wallet?.linked_solana_address) {
      setResult({
        success: false,
        message: "Link a Solana wallet first (Linked Wallets tab)",
      });
      return;
    }
    setDepositConfirmAmount(amt);
    setShowDepositConfirm(true);
  };

  const handleDepositSol = async () => {
    if (depositInFlightRef.current) return;
    const exactLamports = parseSolAmountLamports(depositAmount);
    const amt = exactLamports === null ? 0 : exactLamports / LAMPORTS_PER_SOL;
    if (!amt || amt <= 0) {
      setResult({ success: false, message: "Enter a valid deposit amount" });
      return;
    }
    const treasury =
      treasuryConfig?.deposit_address || treasuryConfig?.treasury_solana;
    if (!treasury) {
      setResult({
        success: false,
        message: treasuryConfig
          ? "Platform deposit address is not configured. Deposits are unavailable until an admin sets SOLANA_TREASURY_ADDRESS or SOLANA_DEPOSIT_VAULT_ADDRESS."
          : "Deposit address is still loading. Try again in a moment",
      });
      return;
    }
    if (!wallet?.linked_solana_address) {
      setResult({
        success: false,
        message: "Link a Solana wallet first (Linked Wallets tab)",
      });
      return;
    }
    if (!connected || !publicKey || (!signTransaction && !sendTransaction)) {
      setResult({
        success: false,
        message:
          "Unlock your linked Solana wallet to sign the deposit, then try again",
      });
      return;
    }
    const linked = wallet.linked_solana_address;
    if (publicKey.toBase58() !== linked) {
      setResult({
        success: false,
        message: `Wrong wallet unlocked. Switch to your linked address (${linked.slice(0, 4)}…${linked.slice(-4)})`,
      });
      return;
    }

    depositInFlightRef.current = true;
    setProcessing(true);
    setResult(null);
    try {
      const { getConnection } = await import("@/lib/solana");
      const previous = confirmedTransfer.current || readDeposit(recoveryKey);
      if (previous) {
        if (previous.amount !== amt)
          throw new Error(
            "Verify the original deposit amount before starting another transfer.",
          );
        await creditDepositOnServer(amt, previous.signature);
        return;
      }
      const connection = getConnection();
      await assertExpectedSolanaCluster(connection);
      const treasuryPk = new PublicKey(treasury);
      const lamports = exactLamports ?? 0;
      if (lamports <= 0) {
        throw new Error("Amount is too small");
      }

      const balance = await connection.getBalance(publicKey);
      const feeBuffer = DEPOSIT_FEE_BUFFER_LAMPORTS;
      if (balance < lamports + feeBuffer) {
        setResult({
          success: false,
          message: `Not enough SOL in your wallet (need ~${amt} SOL plus network fee)`,
        });
        return;
      }

      setResult({
        success: true,
        message: "Approve the transfer in your wallet…",
        type: "info",
      });
      const signature = await sendSolTransfer(
        connection,
        {
          publicKey,
          signTransaction,
          sendTransaction,
        },
        treasuryPk,
        lamports,
        (signature) => {
          confirmedTransfer.current = { amount: amt, signature };
          setDepositTxHash(signature);
          setShowManualDeposit(true);
          try {
            sessionStorage.setItem(
              recoveryKey,
              JSON.stringify({
                amount: amt,
                amountInput: depositAmount,
                signature,
              }),
            );
          } catch {
            /* Recovery remains available in memory. */
          }
        },
      );
      confirmedTransfer.current = { amount: amt, signature };
      setDepositTxHash(signature);
      setShowManualDeposit(true);

      setResult({
        success: true,
        message: "Transaction confirmed. Crediting balance…",
        type: "info",
      });
      await creditDepositOnServer(amt, signature);
    } catch (err: unknown) {
      if (err instanceof SolTransferFailedError) {
        confirmedTransfer.current = null;
        setDepositTxHash("");
        try {
          sessionStorage.removeItem(recoveryKey);
        } catch {
          /* Optional recovery storage. */
        }
      }
      setResult({ success: false, message: formatSolanaWalletError(err) });
    } finally {
      depositInFlightRef.current = false;
      setProcessing(false);
    }
  };

  const copyTreasuryAddress = async () => {
    const addr =
      treasuryConfig?.deposit_address || treasuryConfig?.treasury_solana;
    if (!addr) return;
    await navigator.clipboard.writeText(addr);
    const label =
      treasuryConfig?.destination_kind === "vault"
        ? "Deposit vault address"
        : "Treasury address";
    setResult({ success: true, message: `${label} copied` });
  };

  return {
    depositAmount,
    setDepositAmount,
    depositTxHash,
    setDepositTxHash,
    showManualDeposit,
    setShowManualDeposit,
    showDepositConfirm,
    setShowDepositConfirm,
    depositConfirmAmount,
    setDepositConfirmAmount,
    processing,
    initiateDeposit,
    handleDepositSol,
    handleDepositVerify,
    copyTreasuryAddress,
    retainedDeposit,
    restoreDeposit,
  };
}
