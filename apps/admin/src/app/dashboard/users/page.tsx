"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, Ban, CheckCircle, AlertTriangle, ChevronLeft, ChevronRight, UserX, ShieldCheck, LogOut } from "lucide-react";
import {
  listUsers, banUser, unbanUser, suspendUser, activateUser, updateUserTier,
  forceLogout, type AdminUser, type UserList,
} from "@/lib/api";

const STATUS_COLOR: Record<string, string> = {
  active:    "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  suspended: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  banned:    "text-red-400 bg-red-500/10 border-red-500/20",
};

const TIER_COLOR: Record<string, string> = {
  new:      "text-[#94a3b8] bg-white/5 border-white/10",
  verified: "text-sky-400 bg-sky-500/10 border-sky-500/20",
  premium:  "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
};

export default function UsersPage() {
  const router = useRouter();
  const [data, setData] = useState<UserList | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionUser, setActionUser] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listUsers({ page, per_page: 20, role: roleFilter, status: statusFilter });
      setData(res);
    } catch { /* handled by api.ts redirect */ }
    finally { setLoading(false); }
  }, [page, roleFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (action: () => Promise<unknown>, userId: string) => {
    setActionUser(userId);
    try { await action(); await load(); } catch (e) { alert(String(e)); }
    finally { setActionUser(null); }
  };

  const totalPages = data ? Math.ceil(data.total_count / 20) : 1;

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4a4a6a]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search email or ID…"
            className="w-full pl-9 pr-4 py-2 bg-[#111118] border border-[#1e1e2e] rounded-lg text-sm text-white placeholder-[#4a4a6a] focus:outline-none focus:border-indigo-500"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
          className="bg-[#111118] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-[#94a3b8] focus:outline-none focus:border-indigo-500"
        >
          <option value="">All Roles</option>
          <option value="user">User</option>
          <option value="provider">Provider</option>
          <option value="admin">Admin</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="bg-[#111118] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-[#94a3b8] focus:outline-none focus:border-indigo-500"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="banned">Banned</option>
        </select>
      </div>

      {/* Table */}
      <div className="admin-card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full admin-table text-sm">
            <thead>
              <tr className="border-b border-[#1e1e2e]">
                {["Email / ID", "Role", "Status", "Tier", "Joined", "Actions"].map((h) => (
                  <th key={h} className="text-left text-[10px] font-semibold text-[#4a4a6a] uppercase tracking-wider px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e1e2e]">
              {loading && (
                <tr><td colSpan={6} className="text-center py-12 text-[#4a4a6a]">Loading…</td></tr>
              )}
              {!loading && !data?.users?.length && (
                <tr><td colSpan={6} className="text-center py-12 text-[#4a4a6a]">No users found</td></tr>
              )}
              {(data?.users ?? []).filter(u =>
                !search || u.email.toLowerCase().includes(search.toLowerCase()) || u.id.includes(search)
              ).map((user: AdminUser) => (
                <tr key={user.id} className="transition-colors">
                  <td className="px-4 py-3">
                    <button onClick={() => router.push(`/dashboard/users/${user.id}`)} className="hover:text-indigo-400 transition-colors text-left">
                      <p className="text-white text-sm">{user.email}</p>
                      <p className="text-[10px] text-[#4a4a6a] font-mono">{user.id.slice(0, 8)}…</p>
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-[#94a3b8] capitalize">{user.role}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded border capitalize ${STATUS_COLOR[user.status] ?? "text-[#94a3b8]"}`}>
                      {user.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded border capitalize ${TIER_COLOR[user.trust_tier] ?? ""}`}>
                      {user.trust_tier}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#94a3b8]">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {user.status !== "banned" ? (
                        <button
                          onClick={() => doAction(() => banUser(user.id), user.id)}
                          disabled={actionUser === user.id}
                          title="Ban user"
                          className="p-1.5 rounded hover:bg-red-500/10 text-[#4a4a6a] hover:text-red-400 transition-colors disabled:opacity-40"
                        >
                          <Ban className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button
                          onClick={() => doAction(() => unbanUser(user.id), user.id)}
                          disabled={actionUser === user.id}
                          title="Unban user"
                          className="p-1.5 rounded hover:bg-emerald-500/10 text-[#4a4a6a] hover:text-emerald-400 transition-colors disabled:opacity-40"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {user.status === "active" && (
                        <button
                          onClick={() => doAction(() => suspendUser(user.id), user.id)}
                          disabled={actionUser === user.id}
                          title="Suspend user"
                          className="p-1.5 rounded hover:bg-amber-500/10 text-[#4a4a6a] hover:text-amber-400 transition-colors disabled:opacity-40"
                        >
                          <AlertTriangle className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {user.status === "suspended" && (
                        <button
                          onClick={() => doAction(() => activateUser(user.id), user.id)}
                          disabled={actionUser === user.id}
                          title="Activate user"
                          className="p-1.5 rounded hover:bg-emerald-500/10 text-[#4a4a6a] hover:text-emerald-400 transition-colors disabled:opacity-40"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => doAction(() => forceLogout(user.id), user.id)}
                        disabled={actionUser === user.id}
                        title="Force logout"
                        className="p-1.5 rounded hover:bg-white/5 text-[#4a4a6a] hover:text-white transition-colors disabled:opacity-40"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                      </button>
                      <select
                        value={user.trust_tier}
                        onChange={(e) => doAction(() => updateUserTier(user.id, e.target.value), user.id)}
                        disabled={actionUser === user.id}
                        className="ml-1 bg-[#0a0a0f] border border-[#1e1e2e] rounded text-xs text-[#94a3b8] px-1.5 py-1 focus:outline-none disabled:opacity-40"
                      >
                        <option value="new">new</option>
                        <option value="verified">verified</option>
                        <option value="premium">premium</option>
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#1e1e2e]">
          <p className="text-xs text-[#4a4a6a]">
            {data?.total_count ?? 0} users total
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded hover:bg-white/5 text-[#4a4a6a] disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs text-[#94a3b8]">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded hover:bg-white/5 text-[#4a4a6a] disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
