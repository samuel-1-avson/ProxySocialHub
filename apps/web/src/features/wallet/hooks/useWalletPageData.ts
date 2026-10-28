"use client";

import { useAuth } from "@/lib/auth";
import { useCallback, useEffect, useState } from "react";
import { useWalletWS } from "@/lib/hooks/useWalletWS";
import {
  getWallet,
  getSystemConfig,
  getWithdrawalSecurity,
  Wallet as WalletType,
} from "@/lib/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_LARGE_WITHDRAW_SOL } from "../constants";
import type { WalletResult } from "../types";

export function useWalletPageData() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<WalletResult | null>(null);
  const [mounted, setMounted] = useState(false);

  const rawSolanaNetwork = process.env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet";
  const solanaNetwork =
    rawSolanaNetwork === "mainnet" ? "mainnet-beta" : rawSolanaNetwork;
  const isDevnet = solanaNetwork.toLowerCase().includes("devnet");
  const solanaRpc =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC ||
    "";
  const isLocalSolanaRpc = /localhost|127\.0\.0\.1/i.test(solanaRpc);
  const solanaRpcUrl =
    solanaRpc.trim() ||
    (isDevnet
      ? "https://api.devnet.solana.com"
      : "https://api.mainnet-beta.solana.com");

  const {
    data: wallet,
    isLoading: loading,
    error: walletError,
  } = useQuery({
    queryKey: ["wallet", user?.id],
    queryFn: () => getWallet(),
    enabled: !!user,
    refetchInterval: 30000,
    retry: 2,
  });

  const handleBalanceUpdate = useCallback(
    (update: { balance_sol: number }) => {
      queryClient.setQueryData(
        ["wallet", user?.id],
        (old: WalletType | undefined) =>
          old ? { ...old, balance_sol: update.balance_sol } : old,
      );
    },
    [queryClient, user?.id],
  );

  useWalletWS({
    userID: user?.id,
    onBalanceUpdate: handleBalanceUpdate,
    enabled: !!user,
  });

  const { data: treasuryConfig } = useQuery({
    queryKey: ["system-config"],
    queryFn: getSystemConfig,
    enabled: !!user,
    staleTime: 60000,
  });

  const { data: withdrawalSecurity, refetch: refetchWithdrawalSecurity } =
    useQuery({
      queryKey: ["withdrawal-security", user?.id],
      queryFn: getWithdrawalSecurity,
      enabled: !!user,
    });

  const largeWithdrawThresholdSOL =
    treasuryConfig?.large_withdraw_threshold_sol ?? DEFAULT_LARGE_WITHDRAW_SOL;

  useEffect(() => {
    setMounted(true);
  }, []);

  return {
    user,
    queryClient,
    processing,
    setProcessing,
    result,
    setResult,
    mounted,
    wallet,
    loading,
    walletError,
    treasuryConfig,
    withdrawalSecurity,
    refetchWithdrawalSecurity,
    largeWithdrawThresholdSOL,
    solanaNetwork,
    isDevnet,
    solanaRpc,
    isLocalSolanaRpc,
    solanaRpcUrl,
  };
}
