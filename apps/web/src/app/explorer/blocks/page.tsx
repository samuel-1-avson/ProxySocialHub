"use client";

import { DataError } from "@/components/workspace/Patterns";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { GlassCard } from "@/components/ui/glass-card";
import { getBlocks } from "@/lib/services/explorer";
import Link from "next/link";
import {
  Box,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  ArrowLeft,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { motion } from "framer-motion";

export default function BlocksExplorer() {
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["explorer-blocks", page],
    queryFn: () => getBlocks(page, pageSize),
    refetchInterval: 10000,
  });

  const total = data?.total ?? 0;
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;
  const hasBlocks = total > 0;

  const containerVariants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.05 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0 },
  };

  if (error)
    return (
      <div className="ui-page">
        <h1>Blocks</h1>
        <DataError
          title="Blocks are unavailable"
          error={error}
          retry={() => void refetch()}
        />
      </div>
    );

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="space-y-8 font-mono"
    >
      {/* Header */}
      <motion.header
        variants={itemVariants}
        className="flex flex-col gap-6 border-b border-border pb-8"
      >
        <Link
          href="/explorer"
          className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary transition-colors normal-case tracking-normal w-fit"
        >
          <ArrowLeft size={14} /> Explorer overview
        </Link>

        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6">
          <div>
            <div className="text-xs font-semibold text-primary normal-case tracking-normal mb-1">
              Public records / Blocks
            </div>
            <h1 className="text-4xl font-semibold normal-case tracking-tighter text-foreground flex items-center gap-4">
              <Box className="text-primary" size={32} />
              Blocks
            </h1>
            <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal mt-2">
              Historical record of all verified segment hashes
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
              Total Blocks
            </p>
            <p className="text-3xl font-semibold text-foreground tracking-tighter">
              {data?.total?.toLocaleString() || "0"}
            </p>
          </div>
        </div>
      </motion.header>

      {/* Blocks Table */}
      <motion.section variants={itemVariants}>
        <GlassCard className="overflow-hidden border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-muted text-muted-foreground text-xs normal-case tracking-normal font-semibold">
                  <th className="px-6 py-4">Block</th>
                  <th className="px-6 py-4">Hash</th>
                  <th className="px-6 py-4">Time</th>
                  <th className="px-6 py-4 text-center">Transactions</th>
                  <th className="px-6 py-4">Chain</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={5} className="px-6 py-4 h-14 bg-muted"></td>
                    </tr>
                  ))
                ) : data?.blocks?.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-20 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <Database size={48} className="text-muted-foreground" />
                        <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
                          No blocks indexed yet
                        </p>
                        <p className="text-xs text-muted-foreground max-w-md">
                          The blockchain indexer is starting up. Blocks will
                          appear here once the sync is complete.
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  data?.blocks?.map((block) => (
                    <tr
                      key={block.block_hash}
                      className="hover:bg-surface-hover transition-colors group"
                    >
                      <td className="px-6 py-4">
                        <Link
                          href={`/explorer/blocks/${block.block_number}`}
                          className="font-mono text-primary font-bold text-sm hover:underline"
                        >
                          #{block.block_number?.toLocaleString()}
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-mono text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                          {block.block_hash?.slice(0, 20)}...
                          {block.block_hash?.slice(-12)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Clock size={12} />
                          {block.timestamp
                            ? formatDistanceToNow(new Date(block.timestamp), {
                                addSuffix: true,
                              })
                            : "-"}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="px-3 py-1 rounded-lg bg-muted text-xs text-muted-foreground font-bold border border-border">
                          {block.transaction_count} TXS
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs text-muted-foreground font-mono normal-case tracking-normal">
                          {block.chain}
                        </span>
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
              {hasBlocks ? (
                <>
                  Page <span className="text-foreground">{page}</span> of{" "}
                  <span className="text-foreground">{totalPages}</span>
                </>
              ) : (
                <span className="text-muted-foreground">No blocks indexed</span>
              )}
            </p>
            <div className="flex gap-2">
              <button
                aria-label="Previous page"
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={!hasBlocks || page === 1}
                className="p-2 rounded-lg bg-muted border border-border hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft aria-hidden="true" className="w-5 h-5" />
              </button>
              <button
                aria-label="Next page"
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={!hasBlocks || page >= totalPages}
                className="p-2 rounded-lg bg-muted border border-border hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight aria-hidden="true" className="w-5 h-5" />
              </button>
            </div>
          </div>
        </GlassCard>
      </motion.section>

      {error && (
        <motion.div
          variants={itemVariants}
          className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold normal-case tracking-normal text-center"
        >
          Failed to load blocks. Please check your connection to the ProxyHub
          network.
        </motion.div>
      )}
    </motion.div>
  );
}
