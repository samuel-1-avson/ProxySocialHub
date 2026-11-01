"use client";

import { useClipboard } from "@/hooks/useClipboard";
import { getSolscanAccountUrl } from "@/lib/solscan";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { GlassCard } from "@/components/ui/glass-card";
import { getContractDetails } from "@/lib/services/explorer";
import Link from "next/link";
import {
  ArrowLeft,
  FileCode,
  ShieldCheck,
  XCircle,
  Copy,
  ExternalLink,
  Code2,
  Activity,
  Calendar,
  User,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { ExplorerErrorState } from "@/components/explorer/ExplorerErrorState";

export default function ContractInspectorPage() {
  const params = useParams();
  const address = params.address as string;

  const {
    data: contract,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["contract", address],
    queryFn: () => getContractDetails(address),
  });

  const { copy: copyToClipboard, feedback: copyFeedback } = useClipboard();

  if (error) {
    return (
      <ExplorerErrorState
        retry={() => void refetch()}
        error={error}
        entity="Contract"
        backHref="/explorer/contracts"
        backLabel="Return to contracts"
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
      {/* Header */}
      <header className="flex flex-col gap-6 border-b border-border pb-8">
        <div className="flex items-center gap-4">
          <Link
            href="/explorer/contracts"
            className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary transition-colors normal-case tracking-normal"
          >
            <ArrowLeft size={14} /> Back to Contracts
          </Link>
        </div>

        <GlassCard className="p-8 relative overflow-hidden border-border bg-card">
          <div className="absolute top-0 right-0 p-32 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />

          <div className="relative z-10">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-8">
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-primary/50 flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20">
                  <FileCode size={28} />
                </div>
                <div>
                  <div className="text-xs font-semibold text-primary normal-case tracking-normal mb-1">
                    Smart Contract
                  </div>
                  {isLoading ? (
                    <div className="h-8 w-48 bg-muted animate-pulse rounded" />
                  ) : (
                    <h1 className="text-2xl font-semibold text-foreground tracking-tighter">
                      {contract?.name || "Unknown Contract"}
                    </h1>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    <span className="font-mono text-muted-foreground text-xs break-all">
                      {address}
                    </span>
                    <button
                      onClick={() => copyToClipboard(address)}
                      className="p-1.5 rounded-lg bg-muted hover:bg-surface-hover text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="Copy address"
                    >
                      <Copy size={12} />
                    </button>
                    <a
                      href={getSolscanAccountUrl(address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-lg bg-muted hover:bg-surface-hover text-muted-foreground hover:text-primary transition-colors"
                      title="View on Solscan"
                    >
                      <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-end gap-3">
                {isLoading ? (
                  <div className="h-8 w-32 bg-muted animate-pulse rounded" />
                ) : contract?.is_verified ? (
                  <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-xs font-semibold normal-case tracking-normal">
                    <ShieldCheck size={14} /> Verified
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-muted border border-border text-muted-foreground text-xs font-semibold normal-case tracking-normal">
                    <XCircle size={14} /> Unverified
                  </div>
                )}
                {contract?.contract_type && (
                  <span className="px-3 py-1 rounded-lg text-xs font-semibold bg-muted text-muted-foreground border border-border normal-case tracking-normal">
                    {contract.contract_type}
                  </span>
                )}
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-8 border-t border-border">
              <div className="bg-muted rounded-xl p-4 border border-border">
                <div className="flex items-center gap-2 mb-1">
                  <Activity size={12} className="text-muted-foreground" />
                  <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
                    Total Calls
                  </p>
                </div>
                {isLoading ? (
                  <div className="h-6 w-24 bg-muted animate-pulse rounded" />
                ) : (
                  <p className="font-mono text-lg font-bold">
                    {contract?.total_calls?.toLocaleString() || "0"}
                  </p>
                )}
              </div>
              <div className="bg-muted rounded-xl p-4 border border-border">
                <div className="flex items-center gap-2 mb-1">
                  <Code2 size={12} className="text-muted-foreground" />
                  <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
                    Chain
                  </p>
                </div>
                {isLoading ? (
                  <div className="h-6 w-20 bg-muted animate-pulse rounded" />
                ) : (
                  <p className="font-mono text-lg font-bold normal-case">
                    {contract?.chain || "-"}
                  </p>
                )}
              </div>
              <div className="bg-muted rounded-xl p-4 border border-border">
                <div className="flex items-center gap-2 mb-1">
                  <User size={12} className="text-muted-foreground" />
                  <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
                    Deployer
                  </p>
                </div>
                {isLoading ? (
                  <div className="h-6 w-28 bg-muted animate-pulse rounded" />
                ) : contract?.deployer_address ? (
                  <Link
                    href={`/explorer/wallets/${contract.deployer_address}`}
                    className="font-mono text-sm text-primary hover:text-primary/80 font-bold"
                  >
                    {contract.deployer_address.slice(0, 8)}...
                  </Link>
                ) : (
                  <p className="font-mono text-sm text-muted-foreground">
                    Unknown
                  </p>
                )}
              </div>
              <div className="bg-muted rounded-xl p-4 border border-border">
                <div className="flex items-center gap-2 mb-1">
                  <Calendar size={12} className="text-muted-foreground" />
                  <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
                    Deployed
                  </p>
                </div>
                {isLoading ? (
                  <div className="h-6 w-28 bg-muted animate-pulse rounded" />
                ) : contract?.deployed_at ? (
                  <div>
                    <p className="font-mono text-sm text-muted-foreground">
                      {formatDistanceToNow(new Date(contract.deployed_at), {
                        addSuffix: true,
                      })}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {format(new Date(contract.deployed_at), "MMM d, yyyy")}
                    </p>
                  </div>
                ) : (
                  <p className="font-mono text-sm text-muted-foreground">-</p>
                )}
              </div>
            </div>
          </div>
        </GlassCard>
      </header>

      {/* Description */}
      {(isLoading || contract?.description) && (
        <GlassCard className="p-6 border-border bg-card">
          <h2 className="text-xs font-semibold text-muted-foreground normal-case tracking-normal mb-3">
            Description
          </h2>
          {isLoading ? (
            <div className="space-y-2">
              <div className="h-4 w-full bg-muted animate-pulse rounded" />
              <div className="h-4 w-3/4 bg-muted animate-pulse rounded" />
            </div>
          ) : (
            <p className="text-muted-foreground text-sm leading-relaxed">
              {contract?.description}
            </p>
          )}
        </GlassCard>
      )}

      {/* Source Code / ABI placeholder */}
      {!isLoading && contract?.is_verified && (
        <GlassCard className="p-6 border-border bg-card">
          <h2 className="text-xs font-semibold text-muted-foreground normal-case tracking-normal mb-3">
            Contract ABI
          </h2>
          {contract?.abi ? (
            <pre className="text-xs text-muted-foreground bg-muted rounded-xl p-4 overflow-x-auto max-h-64 border border-border">
              {JSON.stringify(contract.abi, null, 2)}
            </pre>
          ) : (
            <p className="text-muted-foreground text-xs normal-case tracking-normal">
              ABI not available
            </p>
          )}
        </GlassCard>
      )}
    </motion.div>
  );
}
