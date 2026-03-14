"use client";

import { useState, useEffect } from "react";
import { Scale, Gavel } from "lucide-react";
import { listDisputes, forceResolveDispute, type DisputeJury } from "@/lib/api";

const STATUS_COLOR: Record<string, string> = {
  pending:         "text-amber-400 bg-amber-500/10 border-amber-500/20",
  active:          "text-sky-400 bg-sky-500/10 border-sky-500/20",
  resolved:        "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  admin_resolved:  "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
  cancelled:       "text-[#94a3b8] bg-white/5 border-[#1e1e2e]",
};

export default function DisputesPage() {
  const [disputes, setDisputes] = useState<DisputeJury[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);
  const [form, setForm] = useState<{ id: string; resolution: string; reason: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listDisputes();
      setDisputes(res.disputes);
    } catch { /* handled */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleResolve = async () => {
    if (!form) return;
    setResolving(form.id);
    try {
      await forceResolveDispute(form.id, form.resolution, form.reason);
      setForm(null);
      await load();
    } catch (e) { alert(String(e)); }
    finally { setResolving(null); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Scale className="w-4 h-4 text-indigo-400" />
        <h2 className="text-sm font-semibold text-white">Dispute Management</h2>
        <span className="ml-auto text-xs text-[#4a4a6a]">{disputes.length} disputes</span>
      </div>

      {/* Force-resolve modal */}
      {form && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-[#111118] border border-[#1e1e2e] rounded-2xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Gavel className="w-4 h-4 text-red-400" />
              Force Resolve Dispute
            </h3>
            <div>
              <label className="text-xs text-[#94a3b8] mb-1.5 block">Resolution</label>
              <select
                value={form.resolution}
                onChange={(e) => setForm((f) => f ? { ...f, resolution: e.target.value } : f)}
                className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="refund_buyer">Refund Buyer</option>
                <option value="pay_provider">Pay Provider</option>
                <option value="split">Split (50/50)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-[#94a3b8] mb-1.5 block">Reason (logged in audit)</label>
              <textarea
                value={form.reason}
                onChange={(e) => setForm((f) => f ? { ...f, reason: e.target.value } : f)}
                rows={3}
                className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 resize-none"
                placeholder="Explain the reason for admin override…"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setForm(null)}
                className="flex-1 py-2 rounded-lg bg-white/5 border border-[#1e1e2e] text-sm text-[#94a3b8] hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleResolve}
                disabled={!form.reason.trim() || !!resolving}
                className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 text-sm font-semibold text-white transition-colors"
              >
                {resolving ? "Resolving…" : "Force Resolve"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="admin-card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full admin-table text-sm">
            <thead>
              <tr className="border-b border-[#1e1e2e]">
                {["Dispute ID", "Session", "Status", "Verdict", "Created", "Action"].map((h) => (
                  <th key={h} className="text-left text-[10px] font-semibold text-[#4a4a6a] uppercase tracking-wider px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e1e2e]">
              {loading && (
                <tr><td colSpan={6} className="text-center py-12 text-[#4a4a6a]">Loading…</td></tr>
              )}
              {!loading && disputes.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-[#4a4a6a]">No disputes found</td></tr>
              )}
              {disputes.map((d) => (
                <tr key={d.id} className="transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-[#94a3b8]">{d.id.slice(0, 8)}…</td>
                  <td className="px-4 py-3 font-mono text-xs text-[#94a3b8]">{d.session_id?.slice(0, 8)}…</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded border capitalize ${STATUS_COLOR[d.status] ?? "text-[#94a3b8]"}`}>
                      {d.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#94a3b8]">{d.verdict ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-[#94a3b8]">{new Date(d.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    {d.status !== "resolved" && d.status !== "admin_resolved" && (
                      <button
                        onClick={() => setForm({ id: d.id, resolution: "refund_buyer", reason: "" })}
                        className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors"
                      >
                        <Gavel className="w-3 h-3" />
                        Force Resolve
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
