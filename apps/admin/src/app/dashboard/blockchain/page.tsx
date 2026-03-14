"use client";

import { useState, useEffect } from "react";
import { Link as LinkIcon, ExternalLink, RefreshCw, Filter } from "lucide-react";
import { getExplorerTransactions } from "@/lib/api";

interface ExplorerTx {
  id: string;
  signature: string;
  type: string;
  amount: number;
  status: string;
  from_address: string;
  to_address: string;
  block_time: string;
  slot: number;
}

const TX_TYPE_COLOR: Record<string, string> = {
  escrow:     "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
  payout:     "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  staking:    "text-amber-400 bg-amber-500/10 border-amber-500/20",
  governance: "text-sky-400 bg-sky-500/10 border-sky-500/20",
};

function shortAddr(addr: string) {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function Solscan({ sig }: { sig: string }) {
  return (
    <a
      href={`https://solscan.io/tx/${sig}?cluster=devnet`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors"
    >
      <ExternalLink className="w-3 h-3" />
    </a>
  );
}

export default function BlockchainPage() {
  const [txs, setTxs] = useState<ExplorerTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getExplorerTransactions({ page, type: typeFilter });
      setTxs(res.transactions ?? res.data ?? []);
    } catch { /* handled */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [page, typeFilter]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LinkIcon className="w-4 h-4 text-indigo-400" />
          <h2 className="text-sm font-semibold text-white">Solana Transaction Explorer</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-[#4a4a6a]" />
            <select
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
              className="bg-[#111118] border border-[#1e1e2e] rounded-lg px-2.5 py-1.5 text-xs text-[#94a3b8] focus:outline-none focus:border-indigo-500"
            >
              <option value="">All Types</option>
              <option value="escrow">Escrow</option>
              <option value="payout">Payout</option>
              <option value="staking">Staking</option>
              <option value="governance">Governance</option>
            </select>
          </div>
          <button
            onClick={load}
            className="p-1.5 rounded-lg hover:bg-white/5 text-[#4a4a6a] transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="admin-card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full admin-table text-sm">
            <thead>
              <tr className="border-b border-[#1e1e2e]">
                {["Signature", "Type", "From", "To", "Amount", "Status", "Time"].map((h) => (
                  <th key={h} className="text-left text-[10px] font-semibold text-[#4a4a6a] uppercase tracking-wider px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e1e2e]">
              {loading && (
                <tr><td colSpan={7} className="text-center py-12 text-[#4a4a6a]">Loading…</td></tr>
              )}
              {!loading && txs.length === 0 && (
                <tr><td colSpan={7} className="text-center py-12 text-[#4a4a6a]">No transactions found</td></tr>
              )}
              {txs.map((tx) => (
                <tr key={tx.id ?? tx.signature} className="transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs text-[#94a3b8]">{shortAddr(tx.signature)}</span>
                      {tx.signature && <Solscan sig={tx.signature} />}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded border capitalize ${TX_TYPE_COLOR[tx.type] ?? "text-[#94a3b8] bg-white/5 border-[#1e1e2e]"}`}>
                      {tx.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-[#94a3b8]">{shortAddr(tx.from_address)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[#94a3b8]">{shortAddr(tx.to_address)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-emerald-400">
                    {tx.amount ? `${tx.amount.toFixed(4)} SOL` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded border ${
                      tx.status === "confirmed" || tx.status === "finalized"
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                        : "bg-amber-500/10 border-amber-500/20 text-amber-400"
                    }`}>
                      {tx.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#94a3b8]">
                    {tx.block_time ? new Date(tx.block_time).toLocaleTimeString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#1e1e2e]">
          <p className="text-xs text-[#4a4a6a]">Solana Devnet · Indexed by ProxyHub Explorer</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="text-xs px-2.5 py-1 rounded bg-[#0a0a0f] border border-[#1e1e2e] text-[#94a3b8] disabled:opacity-40 hover:text-white transition-colors"
            >
              Prev
            </button>
            <span className="text-xs text-[#94a3b8]">Page {page}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={txs.length < 20}
              className="text-xs px-2.5 py-1 rounded bg-[#0a0a0f] border border-[#1e1e2e] text-[#94a3b8] disabled:opacity-40 hover:text-white transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
