"use client";

import React, {
  useState,
  useRef,
  useCallback,
  useSyncExternalStore,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeading, DataError } from "@/components/workspace/Patterns";
import { isExplorerNotFound } from "@/lib/services/explorer-errors";
import { GlassCard } from "@/components/ui/glass-card";
import {
  getRecentTransactions,
  getBlocks,
  getTransactionDetails,
  getWalletDetails,
  getBlockDetail,
  getNodeDetail,
  getContractDetails,
} from "@/lib/services/explorer";
import {
  detectExplorerSearchType,
  type ExplorerSearchKind,
} from "@/lib/explorer-search";
import Link from "next/link";
import {
  ArrowLeft,
  Search,
  Server,
  Box,
  ArrowRightLeft,
  Wallet,
  ChevronRight,
  Loader,
  Fingerprint,
  AlertCircle,
  type LucideIcon,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type SearchType = "auto" | ExplorerSearchKind;

const SEARCH_TYPES: {
  label: string;
  value: SearchType;
  icon: LucideIcon;
  hint: string;
}[] = [
  {
    label: "Auto",
    value: "auto",
    icon: Search,
    hint: "Detect type automatically",
  },
  {
    label: "Transaction",
    value: "transaction",
    icon: ArrowRightLeft,
    hint: "64–90 char signature",
  },
  {
    label: "Wallet",
    value: "wallet",
    icon: Wallet,
    hint: "32–44 char address",
  },
  { label: "Block", value: "block", icon: Box, hint: "Block number" },
  {
    label: "Contract",
    value: "contract",
    icon: Fingerprint,
    hint: "Program / contract address",
  },
  { label: "Node", value: "node", icon: Server, hint: "Node ID (exact)" },
  {
    label: "Nodes",
    value: "nodes_query",
    icon: Server,
    hint: "Search nodes by id or location",
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
};

const subscribeToHydration = () => () => {};
export default function SearchPage() {
  const interactiveReady = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState<SearchType>("auto");
  const [submitted, setSubmitted] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const resolvedType: ExplorerSearchKind =
    searchType === "auto" ? detectExplorerSearchType(submitted) : searchType;

  const {
    data: txResult,
    isLoading: loadingTx,
    error: txError,
    refetch: refetchTx,
  } = useQuery({
    queryKey: ["search-tx", submitted],
    queryFn: () => getTransactionDetails(submitted),
    enabled: !!submitted && resolvedType === "transaction",
    retry: false,
  });

  const {
    data: walletResult,
    isLoading: loadingWallet,
    error: walletError,
    refetch: refetchWallet,
  } = useQuery({
    queryKey: ["search-wallet", submitted],
    queryFn: () => getWalletDetails(submitted),
    enabled: !!submitted && resolvedType === "wallet",
    retry: false,
  });

  const {
    data: blockResult,
    isLoading: loadingBlock,
    error: blockError,
    refetch: refetchBlock,
  } = useQuery({
    queryKey: ["search-block", submitted],
    queryFn: () => getBlockDetail(submitted),
    enabled: !!submitted && resolvedType === "block",
    retry: false,
  });

  const {
    data: nodeResult,
    isLoading: loadingNode,
    error: nodeError,
    refetch: refetchNode,
  } = useQuery({
    queryKey: ["search-node", submitted],
    queryFn: () => getNodeDetail(submitted),
    enabled: !!submitted && resolvedType === "node",
    retry: false,
  });

  const {
    data: contractResult,
    isLoading: loadingContract,
    error: contractError,
    refetch: refetchContract,
  } = useQuery({
    queryKey: ["search-contract", submitted],
    queryFn: () => getContractDetails(submitted),
    enabled: !!submitted && resolvedType === "contract",
    retry: false,
  });

  const { data: recentTx } = useQuery({
    queryKey: ["recent-tx-search"],
    queryFn: () => getRecentTransactions(1, 5),
    retry: false,
  });

  const { data: recentBlocks } = useQuery({
    queryKey: ["recent-blocks-search"],
    queryFn: () => getBlocks(1, 5),
    retry: false,
  });

  const isLoading =
    loadingTx ||
    loadingWallet ||
    loadingBlock ||
    loadingNode ||
    loadingContract;
  const hasResult = !!(
    txResult ||
    walletResult ||
    blockResult ||
    nodeResult ||
    contractResult
  );
  const isNodesBrowse = resolvedType === "nodes_query" && !!submitted;
  const searchError =
    txError || walletError || blockError || nodeError || contractError;
  const retrySearch = () => {
    const action = {
      transaction: refetchTx,
      wallet: refetchWallet,
      block: refetchBlock,
      node: refetchNode,
      contract: refetchContract,
      nodes_query: refetchNode,
    }[resolvedType];
    void action();
  };
  const hasError = !!submitted && !isLoading && !hasResult && !isNodesBrowse;

  const handleSearch = useCallback(() => {
    const q = query.trim();
    if (!q) return;
    setSubmitted(q);
  }, [query]);

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="explorer-record-search space-y-8 max-w-4xl mx-auto"
    >
      <Link href="/explorer" className="ui-button ghost w-fit">
        <ArrowLeft size={15} aria-hidden="true" />
        Back to Explorer
      </Link>
      <PageHeading
        eyebrow="Explorer / Record lookup"
        title="Search public records"
        description="Look up a transaction, wallet, block, contract, or node. Choose a record type or let the search detect it."
      />

      {/* Search Form */}
      <motion.section variants={itemVariants} className="space-y-4">
        {/* Type Selector */}
        <div className="flex flex-wrap gap-2">
          {SEARCH_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={searchType === t.value}
              disabled={!interactiveReady}
              onClick={() => setSearchType(t.value)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold tracking-wide border transition-all ${searchType === t.value ? "bg-primary/10 border-primary/30 text-primary" : "bg-muted border-border text-muted-foreground hover:text-foreground"}`}
            >
              <t.icon size={10} /> {t.label}
            </button>
          ))}
        </div>

        {/* Input */}
        <GlassCard className="border-border bg-card rounded-2xl !p-2">
          <div className="flex items-center gap-3">
            <Search
              size={16}
              className="text-muted-foreground ml-4 flex-shrink-0"
            />
            <input
              ref={inputRef}
              type="text"
              data-testid="explorer-search-query"
              disabled={!interactiveReady}
              aria-label="Search query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder={
                searchType === "transaction"
                  ? "Enter transaction signature (64–90 chars)..."
                  : searchType === "wallet"
                    ? "Enter wallet address..."
                    : searchType === "block"
                      ? "Enter block number..."
                      : searchType === "contract"
                        ? "Enter contract address..."
                        : searchType === "node"
                          ? "Enter exact node ID..."
                          : searchType === "nodes_query"
                            ? "Search nodes by id, city, country..."
                            : "Search transactions, wallets, blocks, nodes..."
              }
              className="min-w-0 w-full flex-1 bg-transparent text-foreground text-sm font-mono placeholder-muted-foreground outline-none py-4 pr-4"
            />
            <button
              type="button"
              data-testid="explorer-search-submit"
              disabled={!interactiveReady || !query.trim() || isLoading}
              onClick={handleSearch}
              className="flex items-center gap-2 px-6 py-3 rounded-[1.5rem] bg-primary text-primary-foreground text-sm font-semibold tracking-wide hover:bg-primary/90 transition-all flex-shrink-0"
            >
              {isLoading ? (
                <Loader size={12} className="animate-spin" />
              ) : (
                <Search size={12} />
              )}
              Search
            </button>
          </div>
        </GlassCard>

        {searchType !== "auto" && (
          <p className="text-xs font-semibold text-muted-foreground normal-case tracking-wide px-2">
            {SEARCH_TYPES.find((t) => t.value === searchType)?.hint}
          </p>
        )}
      </motion.section>

      {/* Results */}
      <AnimatePresence mode="wait">
        {submitted && (
          <motion.section
            key={submitted}
            variants={itemVariants}
            initial="hidden"
            animate="show"
            className="space-y-4"
          >
            <div className="flex items-center gap-3 px-2">
              <Fingerprint size={12} className="text-primary" />
              <span className="text-xs font-semibold text-muted-foreground normal-case tracking-wide">
                Results for:{" "}
                <span className="text-primary font-mono">
                  {submitted.slice(0, 30)}
                  {submitted.length > 30 ? "..." : ""}
                </span>
              </span>
              {!isLoading && (
                <span className="text-xs font-semibold text-muted-foreground normal-case tracking-wide ml-2">
                  Type: {resolvedType}
                </span>
              )}
            </div>

            {isLoading && (
              <GlassCard className="border-border bg-card rounded-2xl !p-6 text-center">
                <Loader
                  size={24}
                  className="animate-spin text-primary mx-auto mb-4"
                />
                <p className="text-xs font-semibold text-muted-foreground normal-case tracking-wide">
                  Scanning network...
                </p>
              </GlassCard>
            )}

            {/* Transaction Result */}
            {txResult && (
              <GlassCard className="border-primary/20 bg-primary/[0.02] rounded-2xl !p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <ArrowRightLeft size={16} className="text-primary" />
                    <span className="text-sm font-semibold text-primary normal-case tracking-wide">
                      Transaction Found
                    </span>
                  </div>
                  <Link
                    href={`/explorer/transactions/${submitted}`}
                    className="flex items-center gap-1 text-xs font-semibold text-primary normal-case tracking-wide hover:text-primary/80 transition-colors"
                  >
                    View Full <ChevronRight size={10} />
                  </Link>
                </div>
                {[
                  { label: "Tx Hash", value: txResult.tx_hash },
                  { label: "Status", value: txResult.status },
                  {
                    label: "Amount",
                    value: `${txResult.amount} ${txResult.currency}`,
                  },
                  {
                    label: "Type",
                    value: txResult.tx_type?.replace(/_/g, " "),
                  },
                  {
                    label: "Block",
                    value: txResult.block_number?.toLocaleString(),
                  },
                ].map((f) => (
                  <div
                    key={f.label}
                    className="flex justify-between items-center py-2 border-b border-border"
                  >
                    <span className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
                      {f.label}
                    </span>
                    <span className="text-sm font-semibold text-foreground font-mono truncate max-w-[60%] text-right">
                      {f.value || "—"}
                    </span>
                  </div>
                ))}
              </GlassCard>
            )}

            {/* Wallet Result */}
            {walletResult && (
              <GlassCard className="border-primary/20 bg-primary/[0.02] rounded-2xl !p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Wallet size={16} className="text-primary" />
                    <span className="text-sm font-semibold text-primary normal-case tracking-wide">
                      Wallet Found
                    </span>
                  </div>
                  <Link
                    href={`/explorer/wallets/${submitted}`}
                    className="flex items-center gap-1 text-xs font-semibold text-primary normal-case tracking-wide hover:text-primary/80 transition-colors"
                  >
                    View Full <ChevronRight size={10} />
                  </Link>
                </div>
                {[
                  { label: "Address", value: walletResult.address },
                  {
                    label: "Balance",
                    value: `${walletResult.balance_sol?.toFixed(6)} SOL`,
                  },
                  {
                    label: "Transactions",
                    value: walletResult.transaction_count?.toLocaleString(),
                  },
                  {
                    label: "Contract",
                    value: walletResult.is_contract ? "Yes" : "No",
                  },
                ].map((f) => (
                  <div
                    key={f.label}
                    className="flex justify-between items-center py-2 border-b border-border"
                  >
                    <span className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
                      {f.label}
                    </span>
                    <span className="text-sm font-semibold text-foreground font-mono truncate max-w-[60%] text-right">
                      {f.value || "—"}
                    </span>
                  </div>
                ))}
              </GlassCard>
            )}

            {/* Block Result */}
            {blockResult && (
              <GlassCard className="border-primary/20 bg-primary/[0.02] rounded-2xl !p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Box size={16} className="text-primary" />
                    <span className="text-sm font-semibold text-primary normal-case tracking-wide">
                      Block Found
                    </span>
                  </div>
                  <Link
                    href={`/explorer/blocks/${blockResult.block_number}`}
                    className="flex items-center gap-1 text-xs font-semibold text-primary normal-case tracking-wide hover:text-primary/80 transition-colors"
                  >
                    View Full <ChevronRight size={10} />
                  </Link>
                </div>
                {[
                  {
                    label: "Block #",
                    value: blockResult.block_number?.toLocaleString(),
                  },
                  {
                    label: "Hash",
                    value: blockResult.block_hash?.slice(0, 24) + "...",
                  },
                  {
                    label: "Transactions",
                    value: blockResult.transaction_count?.toLocaleString(),
                  },
                  {
                    label: "Validator",
                    value: blockResult.validator_pubkey
                      ? blockResult.validator_pubkey.slice(0, 20) + "..."
                      : "—",
                  },
                ].map((f) => (
                  <div
                    key={f.label}
                    className="flex justify-between items-center py-2 border-b border-border"
                  >
                    <span className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
                      {f.label}
                    </span>
                    <span className="text-sm font-semibold text-foreground font-mono truncate max-w-[60%] text-right">
                      {f.value || "—"}
                    </span>
                  </div>
                ))}
              </GlassCard>
            )}

            {/* Node list search (no single-node lookup) */}
            {isNodesBrowse && !isLoading && (
              <GlassCard className="border-primary/20 bg-primary/[0.02] rounded-2xl !p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Server size={16} className="text-primary" />
                    <span className="text-sm font-semibold text-primary normal-case tracking-wide">
                      Node search
                    </span>
                  </div>
                  <Link
                    href={`/explorer/nodes?q=${encodeURIComponent(submitted)}`}
                    data-testid="explorer-search-browse-nodes"
                    className="flex items-center gap-1 text-xs font-semibold text-primary normal-case tracking-wide hover:text-primary/80 transition-colors"
                  >
                    Browse matches <ChevronRight size={10} />
                  </Link>
                </div>
                <p className="text-xs font-semibold text-muted-foreground normal-case tracking-wide mt-4">
                  Opens the nodes grid filtered by id, region, country, or city.
                </p>
              </GlassCard>
            )}

            {/* Contract Result */}
            {contractResult && (
              <GlassCard className="border-primary/20 bg-primary/[0.02] rounded-2xl !p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Fingerprint size={16} className="text-primary" />
                    <span className="text-sm font-semibold text-primary normal-case tracking-wide">
                      Contract Found
                    </span>
                  </div>
                  <Link
                    href={`/explorer/contracts/${submitted}`}
                    className="flex items-center gap-1 text-xs font-semibold text-primary normal-case tracking-wide hover:text-primary/80 transition-colors"
                  >
                    View Full <ChevronRight size={10} />
                  </Link>
                </div>
                {[
                  { label: "Address", value: contractResult.address },
                  { label: "Name", value: contractResult.name },
                  { label: "Type", value: contractResult.contract_type },
                  {
                    label: "Verified",
                    value: contractResult.is_verified ? "Yes" : "No",
                  },
                ].map((f) => (
                  <div
                    key={f.label}
                    className="flex justify-between items-center py-2 border-b border-border"
                  >
                    <span className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
                      {f.label}
                    </span>
                    <span className="text-sm font-semibold text-foreground font-mono truncate max-w-[60%] text-right">
                      {f.value || "—"}
                    </span>
                  </div>
                ))}
              </GlassCard>
            )}

            {/* Node Result */}
            {nodeResult && (
              <GlassCard className="border-primary/20 bg-primary/[0.02] rounded-2xl !p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Server size={16} className="text-primary" />
                    <span className="text-sm font-semibold text-primary normal-case tracking-wide">
                      Node Found
                    </span>
                  </div>
                  <Link
                    href={`/explorer/nodes/${submitted}`}
                    className="flex items-center gap-1 text-xs font-semibold text-primary normal-case tracking-wide hover:text-primary/80 transition-colors"
                  >
                    View Full <ChevronRight size={10} />
                  </Link>
                </div>
                {[
                  {
                    label: "Node ID",
                    value: nodeResult.node_id?.slice(0, 24) + "...",
                  },
                  {
                    label: "Type",
                    value: nodeResult.is_validator ? "Validator" : "Proxy",
                  },
                  { label: "Region", value: nodeResult.region || "—" },
                  {
                    label: "Uptime",
                    value: `${(nodeResult.uptime_percent || 0).toFixed(2)}%`,
                  },
                  {
                    label: "Status",
                    value: nodeResult.is_active ? "Active" : "Offline",
                  },
                ].map((f) => (
                  <div
                    key={f.label}
                    className="flex justify-between items-center py-2 border-b border-border"
                  >
                    <span className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
                      {f.label}
                    </span>
                    <span className="text-sm font-semibold text-foreground font-mono truncate max-w-[60%] text-right">
                      {f.value || "—"}
                    </span>
                  </div>
                ))}
              </GlassCard>
            )}

            {hasError &&
              (searchError && !isExplorerNotFound(searchError) ? (
                <DataError
                  title="The search service is unavailable"
                  error={searchError}
                  retry={retrySearch}
                />
              ) : (
                <div className="ui-surface p-8 text-center">
                  <AlertCircle
                    size={28}
                    className="text-muted-foreground mx-auto mb-3"
                    aria-hidden="true"
                  />
                  <h2 className="text-lg font-semibold">No matching record</h2>
                  <p className="text-sm text-muted-foreground mt-2">
                    Check the identifier or try another record type.
                  </p>
                </div>
              ))}
          </motion.section>
        )}
      </AnimatePresence>

      {/* Quick Access */}
      {!submitted && (
        <motion.div
          variants={itemVariants}
          className="grid grid-cols-1 md:grid-cols-2 gap-6"
        >
          {/* Recent Transactions */}
          <GlassCard className="border-border bg-card rounded-2xl !p-5">
            <h3 className="text-sm font-semibold text-muted-foreground normal-case tracking-wide mb-4 flex items-center gap-2">
              <ArrowRightLeft size={10} /> Recent Transactions
            </h3>
            <div className="space-y-2">
              {(recentTx?.transactions || []).slice(0, 5).map((tx) => (
                <Link
                  key={tx.tx_hash}
                  href={`/explorer/transactions/${tx.tx_hash}`}
                  className="flex items-center justify-between py-2 border-b border-border hover:border-primary/20 transition-colors group"
                >
                  <span className="font-mono text-xs text-primary group-hover:text-primary/80 transition-colors">
                    {tx.tx_hash?.slice(0, 14)}...
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {tx.amount?.toFixed(3)} {tx.currency}
                  </span>
                </Link>
              ))}
            </div>
            <Link
              href="/explorer/transactions"
              className="block mt-3 text-xs font-semibold text-primary normal-case tracking-wide hover:text-primary transition-colors"
            >
              View all transactions →
            </Link>
          </GlassCard>

          {/* Recent Blocks */}
          <GlassCard className="border-border bg-card rounded-2xl !p-5">
            <h3 className="text-sm font-semibold text-muted-foreground normal-case tracking-wide mb-4 flex items-center gap-2">
              <Box size={10} /> Recent Blocks
            </h3>
            <div className="space-y-2">
              {(recentBlocks?.blocks || []).slice(0, 5).map((b) => (
                <Link
                  key={b.block_hash}
                  href={`/explorer/blocks/${b.block_number}`}
                  className="flex items-center justify-between py-2 border-b border-border hover:border-primary/20 transition-colors group"
                >
                  <span className="font-mono text-xs text-primary group-hover:text-primary/80 transition-colors">
                    #{b.block_number?.toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {b.transaction_count} txs
                  </span>
                </Link>
              ))}
            </div>
            <Link
              href="/explorer/blocks"
              className="block mt-3 text-xs font-semibold text-primary normal-case tracking-wide hover:text-primary transition-colors"
            >
              View all blocks →
            </Link>
          </GlassCard>
        </motion.div>
      )}
    </motion.div>
  );
}
