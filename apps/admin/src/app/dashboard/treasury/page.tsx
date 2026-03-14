"use client";

import { useState, useEffect } from "react";
import { Wallet, DollarSign, ArrowUpRight, RefreshCw, CheckCircle } from "lucide-react";
import {
  getTreasuryOverview, getPendingPayouts, getPayoutHistory, processPayout,
  type TreasuryOverview, type PendingPayout, type LedgerEntry,
} from "@/lib/api";

export default function TreasuryPage() {
  const [overview, setOverview] = useState<TreasuryOverview | null>(null);
  const [pending, setPending] = useState<PendingPayout[]>([]);
  const [history, setHistory] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [payoutPhone, setPayoutPhone] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [o, p, h] = await Promise.all([getTreasuryOverview(), getPendingPayouts(), getPayoutHistory()]);
      setOverview(o);
      setPending(p.payouts);
      setHistory(h.payouts);
    } catch { /* handled */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handlePayout = async (userId: string, amount: number) => {
    const phone = payoutPhone[userId];
    if (!phone) { alert("Enter phone number first"); return; }
    if (!confirm(`Process payout of ${amount.toFixed(4)} SOL to ${phone}?`)) return;

    setProcessing(userId);
    try {
      await processPayout(userId, phone, amount);
      await load();
    } catch (e) { alert(String(e)); }
    finally { setProcessing(null); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overview cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Revenue", value: `${(overview?.revenue.total ?? 0).toFixed(4)} SOL`, icon: <DollarSign className="w-4 h-4" />, color: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20" },
          { label: "This Month", value: `${(overview?.revenue.this_month ?? 0).toFixed(4)} SOL`, icon: <ArrowUpRight className="w-4 h-4" />, color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
          { label: "Pending Payouts", value: `${(overview?.payouts.pending_total_sol ?? 0).toFixed(4)} SOL`, icon: <Wallet className="w-4 h-4" />, color: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
          { label: "Active Escrows", value: overview?.escrows.active_count ?? "—", icon: <CheckCircle className="w-4 h-4" />, color: "text-sky-400 bg-sky-500/10 border-sky-500/20" },
        ].map((s) => (
          <div key={s.label} className="admin-card flex items-center gap-3">
            <div className={`p-2 rounded-lg border ${s.color}`}>{s.icon}</div>
            <div>
              <p className="text-xs text-[#94a3b8]">{s.label}</p>
              <p className="text-lg font-bold text-white">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Payouts */}
        <div className="admin-card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Pending Payouts</h2>
            <button onClick={load} className="p-1.5 rounded hover:bg-white/5 text-[#4a4a6a] transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {pending.length === 0 ? (
            <p className="text-sm text-[#4a4a6a] text-center py-6">No pending payouts</p>
          ) : (
            <div className="space-y-3">
              {pending.map((p) => (
                <div key={p.user_id} className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg p-3 space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-white">{p.email}</p>
                      <p className="text-xs text-[#94a3b8]">{p.role} · {p.earnings_ghs.toFixed(4)} SOL</p>
                    </div>
                    <span className="text-xs text-amber-400 font-mono">{p.earnings_ghs.toFixed(4)} SOL</span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      placeholder="Phone number"
                      value={payoutPhone[p.user_id] ?? ""}
                      onChange={(e) => setPayoutPhone((prev) => ({ ...prev, [p.user_id]: e.target.value }))}
                      className="flex-1 bg-[#111118] border border-[#1e1e2e] rounded px-2.5 py-1.5 text-xs text-white placeholder-[#4a4a6a] focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      onClick={() => handlePayout(p.user_id, p.earnings_ghs)}
                      disabled={processing === p.user_id}
                      className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
                    >
                      {processing === p.user_id ? "…" : "Pay Out"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Payout History */}
        <div className="admin-card space-y-4">
          <h2 className="text-sm font-semibold text-white">Payout History</h2>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {history.length === 0 ? (
              <p className="text-sm text-[#4a4a6a] text-center py-6">No payouts yet</p>
            ) : (
              history.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between py-2 border-b border-[#1e1e2e] last:border-0">
                  <div>
                    <p className="text-xs text-white">{entry.description}</p>
                    <p className="text-[10px] text-[#4a4a6a]">{new Date(entry.created_at).toLocaleString()}</p>
                  </div>
                  <span className="text-xs font-mono text-amber-400">{Math.abs(entry.amount).toFixed(4)} SOL</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
