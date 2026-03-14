"use client";

import { useState, useEffect } from "react";
import { Vote, XCircle, CheckCircle, Clock } from "lucide-react";
import { listProposals, cancelProposal, type Proposal } from "@/lib/api";

const STATUS_COLOR: Record<string, string> = {
  active:    "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  pending:   "text-amber-400 bg-amber-500/10 border-amber-500/20",
  passed:    "text-sky-400 bg-sky-500/10 border-sky-500/20",
  rejected:  "text-red-400 bg-red-500/10 border-red-500/20",
  cancelled: "text-[#4a4a6a] bg-white/5 border-[#1e1e2e]",
  executed:  "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
};

export default function GovernancePage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listProposals();
      setProposals(res.proposals);
    } catch { /* handled */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleCancel = async (id: string, title: string) => {
    if (!confirm(`Cancel proposal "${title}"? This cannot be undone.`)) return;
    setCancelling(id);
    try { await cancelProposal(id); await load(); }
    catch (e) { alert(String(e)); }
    finally { setCancelling(null); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Vote className="w-4 h-4 text-indigo-400" />
        <h2 className="text-sm font-semibold text-white">Governance Proposals</h2>
        <span className="ml-auto text-xs text-[#4a4a6a]">{proposals.length} proposals</span>
      </div>

      <div className="space-y-3">
        {loading && (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!loading && proposals.length === 0 && (
          <div className="admin-card text-center py-12 text-[#4a4a6a]">No proposals found</div>
        )}
        {proposals.map((p) => {
          const total = (p.yes_votes ?? 0) + (p.no_votes ?? 0);
          const yesPct = total ? Math.round(((p.yes_votes ?? 0) / total) * 100) : 0;
          const active = p.status === "active" || p.status === "pending";
          return (
            <div key={p.id} className="admin-card space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded border capitalize ${STATUS_COLOR[p.status] ?? "text-[#94a3b8]"}`}>
                      {p.status}
                    </span>
                    <span className="text-[10px] text-[#4a4a6a]">{new Date(p.created_at).toLocaleDateString()}</span>
                  </div>
                  <h3 className="text-sm font-medium text-white">{p.title}</h3>
                  <p className="text-xs text-[#94a3b8] mt-1 line-clamp-2">{p.description}</p>
                </div>
                {active && (
                  <button
                    onClick={() => handleCancel(p.id, p.title)}
                    disabled={cancelling === p.id}
                    className="shrink-0 flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 disabled:opacity-40 transition-colors"
                  >
                    <XCircle className="w-3 h-3" />
                    {cancelling === p.id ? "…" : "Cancel"}
                  </button>
                )}
              </div>

              {/* Vote bar */}
              <div>
                <div className="flex justify-between text-[10px] text-[#4a4a6a] mb-1">
                  <span className="flex items-center gap-1">
                    <CheckCircle className="w-3 h-3 text-emerald-400" />
                    {p.yes_votes ?? 0} Yes ({yesPct}%)
                  </span>
                  <span className="flex items-center gap-1">
                    {p.no_votes ?? 0} No
                    <Clock className="w-3 h-3 text-red-400" />
                  </span>
                </div>
                <div className="h-1.5 bg-[#1e1e2e] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 rounded-full transition-all"
                    style={{ width: `${yesPct}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
