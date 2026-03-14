"use client";

import { useState, useEffect } from "react";
import { FileText, Search, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { getAuditLogs, type AuditLog, type AuditLogList } from "@/lib/api";

export default function AuditPage() {
  const [data, setData] = useState<AuditLogList | null>(null);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getAuditLogs({ page, action, entity });
      setData(res);
    } catch { /* handled */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [page, action, entity]);

  const exportCSV = () => {
    const logs = data?.audit_logs ?? [];
    const header = "ID,Actor,Action,Entity Type,Entity ID,IP,Time\n";
    const rows = logs.map((l) =>
      [l.id, l.actor_email, l.action, l.entity_type, l.entity_id, l.ip_address, l.created_at].join(",")
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-logs-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = data ? Math.ceil(data.total_count / 50) : 1;

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2 flex-1 min-w-48">
          <Search className="w-4 h-4 text-[#4a4a6a] shrink-0" />
          <input
            value={action}
            onChange={(e) => { setAction(e.target.value); setPage(1); }}
            placeholder="Filter by action…"
            className="w-full bg-[#111118] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-white placeholder-[#4a4a6a] focus:outline-none focus:border-indigo-500"
          />
        </div>
        <input
          value={entity}
          onChange={(e) => { setEntity(e.target.value); setPage(1); }}
          placeholder="Entity type…"
          className="bg-[#111118] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-white placeholder-[#4a4a6a] focus:outline-none focus:border-indigo-500 w-40"
        />
        <button
          onClick={exportCSV}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-[#111118] border border-[#1e1e2e] text-[#94a3b8] hover:text-white transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </button>
      </div>

      {/* Table */}
      <div className="admin-card !p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-[#1e1e2e] flex items-center gap-2">
          <FileText className="w-4 h-4 text-indigo-400" />
          <span className="text-sm font-semibold text-white">Audit Log</span>
          <span className="ml-auto text-xs text-[#4a4a6a]">{data?.total_count ?? 0} entries</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full admin-table text-sm">
            <thead>
              <tr className="border-b border-[#1e1e2e]">
                {["Actor", "Action", "Entity Type", "Entity ID", "IP Address", "Time"].map((h) => (
                  <th key={h} className="text-left text-[10px] font-semibold text-[#4a4a6a] uppercase tracking-wider px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e1e2e]">
              {loading && (
                <tr><td colSpan={6} className="text-center py-12 text-[#4a4a6a]">Loading…</td></tr>
              )}
              {!loading && !data?.audit_logs?.length && (
                <tr><td colSpan={6} className="text-center py-12 text-[#4a4a6a]">No audit logs found</td></tr>
              )}
              {(data?.audit_logs ?? []).map((log: AuditLog) => (
                <tr key={log.id} className="transition-colors">
                  <td className="px-4 py-2.5 text-xs text-[#94a3b8]">{log.actor_email || "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs font-mono text-indigo-400">{log.action}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[#94a3b8] capitalize">{log.entity_type}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-[#4a4a6a]">{log.entity_id?.slice(0, 12)}…</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-[#4a4a6a]">{log.ip_address || "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-[#94a3b8]">{new Date(log.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-[#1e1e2e]">
          <p className="text-xs text-[#4a4a6a]">50 entries per page</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 rounded hover:bg-white/5 text-[#4a4a6a] disabled:opacity-30 transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs text-[#94a3b8]">Page {page} of {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1.5 rounded hover:bg-white/5 text-[#4a4a6a] disabled:opacity-30 transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
