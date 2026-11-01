"use client";

import { useClipboard } from "@/hooks/useClipboard";
import { getSolscanAccountUrl } from "@/lib/solscan";
import { DataError } from "@/components/workspace/Patterns";
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GlassCard } from "@/components/ui/glass-card";
import {
  getWalletDetails,
  getWalletTransactions,
} from "@/lib/services/explorer";
import Link from "next/link";
import {
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  ArrowLeft,
  Fingerprint,
  Layers,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { ExplorerErrorState } from "@/components/explorer/ExplorerErrorState";

export default function WalletInspectorPage() {
  const params = useParams();
  const address = params.address as string;
  const [txPage, setTxPage] = useState(1);

  const {
    data: wallet,
    isLoading: loadingWallet,
    error,
    refetch,
  } = useQuery({
    queryKey: ["wallet", address],
    queryFn: () => getWalletDetails(address),
  });

  const {
    data: transactions,
    isLoading: loadingTx,
    error: historyError,
    refetch: retryHistory,
  } = useQuery({
    queryKey: ["wallet-tx", address, txPage],
    queryFn: () => getWalletTransactions(address, txPage, 10),
    enabled: !!wallet,
  });

  const { copy: copyToClipboard, feedback: copyFeedback } = useClipboard();

  if (error) {
    return (
      <ExplorerErrorState
        retry={() => void refetch()}
        error={error}
        entity="Wallet"
        backHref="/explorer"
        backLabel="Return to explorer"
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 font-mono"
    >
      {copyFeedback && (
        <p className="workflow-note" role="status">
          {copyFeedback}
        </p>
      )}
      {historyError && (
        <DataError
          title="Wallet transaction history is unavailable"
          error={historyError}
          retry={() => void retryHistory()}
        />
      )}
      {/* Header */}
      <header className="flex flex-col gap-6 border-b border-border pb-8">
        <div className="flex items-center gap-4">
          <Link
            href="/explorer"
            className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary transition-colors normal-case tracking-normal"
          >
            <ArrowLeft size={14} /> Explorer overview
          </Link>
        </div>

        {/* Wallet Header Card */}
        <GlassCard className="p-8 relative overflow-hidden border-border bg-card">
          <div className="absolute top-0 right-0 p-32 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />

          <div className="relative z-10">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-8">
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-primary/50 flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20">
                  <Fingerprint size={28} />
                </div>
                <div>
                  <div className="text-xs font-semibold text-primary normal-case tracking-normal mb-1">
                    Wallet Address
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-foreground break-all text-lg font-bold tracking-tight">
                      {address}
                    </span>
                    <button
                      onClick={() => copyToClipboard(address)}
                      className="p-2 rounded-lg bg-muted hover:bg-surface-hover text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="Copy address"
                    >
                      <Copy size={14} />
                    </button>
                    <a
                      href={getSolscanAccountUrl(address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 rounded-lg bg-muted hover:bg-surface-hover text-muted-foreground hover:text-primary transition-colors"
                      title="View on Solscan"
                    >
                      <ExternalLink size={14} />
                    </a>
                  </div>
                </div>
              </div>

              <div className="text-right">
                <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal mb-1">
                  Total Balance
                </p>
                {loadingWallet ? (
                  <div className="h-10 w-40 bg-muted animate-pulse rounded ml-auto" />
                ) : (
                  <div className="text-4xl font-semibold text-foreground tracking-tighter">
                    {wallet?.balance_sol?.toLocaleString()}{" "}
                    <span className="text-xl text-muted-foreground">SOL</span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  Native Solana balance
                </p>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-8 border-t border-border">
              <div className="bg-muted rounded-xl p-4 border border-border">
                <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal mb-1">
                  Platform Credit
                </p>
                <p className="font-mono text-lg font-bold">
                  {wallet?.balance_platform?.toFixed(2) || "0.00"}
                </p>
              </div>
              <div className="bg-muted rounded-xl p-4 border border-border">
                <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal mb-1">
                  Transactions
                </p>
                <p className="font-mono text-lg font-bold">
                  {wallet?.transaction_count?.toLocaleString() || "0"}
                </p>
              </div>
              <div className="bg-muted rounded-xl p-4 border border-border">
                <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal mb-1">
                  First Seen
                </p>
                <p className="font-mono text-sm text-muted-foreground">
                  {wallet?.first_activity
                    ? formatDistanceToNow(new Date(wallet.first_activity), {
                        addSuffix: true,
                      })
                    : "-"}
                </p>
              </div>
              <div className="bg-muted rounded-xl p-4 border border-border">
                <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal mb-1">
                  Last Activity
                </p>
                <p className="font-mono text-sm text-muted-foreground">
                  {wallet?.last_activity
                    ? formatDistanceToNow(new Date(wallet.last_activity), {
                        addSuffix: true,
                      })
                    : "-"}
                </p>
              </div>
            </div>
          </div>
        </GlassCard>
      </header>

      {/* Transactions List */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold normal-case tracking-tighter text-foreground flex items-center gap-3">
            <ArrowRightLeft size={20} className="text-primary" /> Transaction
            History
          </h2>
        </div>

        <GlassCard className="overflow-hidden border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-muted text-muted-foreground text-xs normal-case tracking-normal font-semibold">
                  <th className="px-6 py-4">Tx Hash</th>
                  <th className="px-6 py-4">Method</th>
                  <th className="px-6 py-4">To</th>
                  <th className="px-6 py-4 text-right">Value</th>
                  <th className="px-6 py-4 text-right">Age</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loadingTx ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={5} className="px-6 py-4 h-12 bg-muted"></td>
                    </tr>
                  ))
                ) : transactions?.transactions?.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <Layers size={32} className="text-muted-foreground" />
                        <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
                          No transactions found
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  transactions?.transactions?.map((tx) => (
                    <tr
                      key={tx.tx_hash}
                      className="hover:bg-surface-hover transition-colors"
                    >
                      <td className="px-6 py-4">
                        <Link
                          href={`/explorer/transactions/${tx.tx_hash}`}
                          className="font-mono text-primary hover:text-primary/80 text-xs font-bold"
                        >
                          {tx.tx_hash?.slice(0, 12)}...
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-3 py-1 rounded-lg text-xs font-semibold bg-muted text-muted-foreground border border-border normal-case tracking-normal">
                          {tx.tx_type}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div
                          className={`flex items-center gap-2 font-mono text-xs ${tx.to_address === address ? "text-emerald-500" : "text-muted-foreground"}`}
                        >
                          {tx.to_address === address ? (
                            <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-emerald-500/20 text-emerald-500">
                              IN
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-yellow-500/20 text-yellow-500">
                              OUT
                            </span>
                          )}
                          <Link
                            href={`/explorer/wallets/${tx.to_address}`}
                            className="hover:text-foreground truncate max-w-[120px]"
                          >
                            {tx.to_address?.slice(0, 8)}...
                          </Link>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="font-mono text-foreground font-bold">
                          {tx.amount?.toFixed(4)} {tx.currency}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right text-xs text-muted-foreground">
                        {tx.timestamp
                          ? formatDistanceToNow(new Date(tx.timestamp), {
                              addSuffix: true,
                            })
                          : "-"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="p-6 bg-muted flex items-center justify-between border-t border-border">
            <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
              Page <span className="text-foreground">{txPage}</span>
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setTxPage(Math.max(1, txPage - 1))}
                disabled={txPage === 1 || loadingTx}
                className="p-2 rounded-lg bg-muted border border-border hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={() => setTxPage(txPage + 1)}
                disabled={transactions && transactions.transactions.length < 10}
                className="p-2 rounded-lg bg-muted border border-border hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        </GlassCard>
      </div>
    </motion.div>
  );
}
