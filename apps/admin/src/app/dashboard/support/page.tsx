"use client";

import { useState } from "react";
import { HeartHandshake, Search, User, LogOut, Ban, CheckCircle, ShieldCheck, AlertTriangle } from "lucide-react";
import {
  getUser, getUserNotes, addUserNote,
  banUser, unbanUser, suspendUser, activateUser, forceLogout,
  type UserDetail, type AdminNote,
} from "@/lib/api";

export default function SupportPage() {
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [notes, setNotes] = useState<AdminNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setDetail(null);
    try {
      const d = await getUser(query.trim());
      const n = await getUserNotes(d.user.id);
      setDetail(d);
      setNotes(n.notes);
    } catch {
      setError("User not found. Try the full UUID.");
    } finally { setLoading(false); }
  };

  const doAction = async (action: () => Promise<unknown>) => {
    setActing(true);
    try {
      await action();
      if (detail) {
        const d = await getUser(detail.user.id);
        setDetail(d);
      }
    } catch (e) { alert(String(e)); }
    finally { setActing(false); }
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || !detail) return;
    await addUserNote(detail.user.id, newNote.trim());
    const n = await getUserNotes(detail.user.id);
    setNotes(n.notes);
    setNewNote("");
  };

  const user = detail?.user;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-2">
        <HeartHandshake className="w-4 h-4 text-indigo-400" />
        <h2 className="text-sm font-semibold text-white">Customer Support Panel</h2>
      </div>

      {/* User lookup */}
      <div className="admin-card">
        <p className="text-xs text-[#94a3b8] mb-3">Look up a user by UUID or email to manage their account.</p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4a4a6a]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="User UUID or email…"
              className="w-full pl-9 pr-4 py-2.5 bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg text-sm text-white placeholder-[#4a4a6a] focus:outline-none focus:border-indigo-500"
            />
          </div>
          <button
            onClick={search}
            disabled={loading}
            className="px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-sm text-white font-semibold transition-colors"
          >
            {loading ? "…" : "Lookup"}
          </button>
        </div>
        {error && <p className="text-sm text-red-400 mt-2">{error}</p>}
      </div>

      {user && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* User details + actions */}
          <div className="admin-card space-y-4">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-indigo-400" />
              <h3 className="text-sm font-semibold text-white">Account Details</h3>
            </div>
            <div className="space-y-2">
              {[
                ["Email", user.email],
                ["ID", user.id],
                ["Role", user.role],
                ["Status", user.status],
                ["Tier", user.trust_tier],
                ["Sessions", String(detail.session_count)],
                ["Joined", new Date(user.created_at).toLocaleDateString()],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs py-1.5 border-b border-[#1e1e2e] last:border-0">
                  <span className="text-[#94a3b8]">{k}</span>
                  <span className="text-white font-mono truncate max-w-40">{v}</span>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-2">
              {user.status !== "banned" ? (
                <button
                  onClick={() => doAction(() => banUser(user.id))}
                  disabled={acting}
                  className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 disabled:opacity-40 transition-colors"
                >
                  <Ban className="w-3 h-3" /> Ban
                </button>
              ) : (
                <button
                  onClick={() => doAction(() => unbanUser(user.id))}
                  disabled={acting}
                  className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
                >
                  <CheckCircle className="w-3 h-3" /> Unban
                </button>
              )}
              {user.status === "active" && (
                <button
                  onClick={() => doAction(() => suspendUser(user.id))}
                  disabled={acting}
                  className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 disabled:opacity-40 transition-colors"
                >
                  <AlertTriangle className="w-3 h-3" /> Suspend
                </button>
              )}
              {user.status === "suspended" && (
                <button
                  onClick={() => doAction(() => activateUser(user.id))}
                  disabled={acting}
                  className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
                >
                  <ShieldCheck className="w-3 h-3" /> Activate
                </button>
              )}
              <button
                onClick={() => doAction(() => forceLogout(user.id))}
                disabled={acting}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-white/5 border border-[#1e1e2e] text-[#94a3b8] hover:text-white disabled:opacity-40 transition-colors"
              >
                <LogOut className="w-3 h-3" /> Force Logout
              </button>
            </div>
          </div>

          {/* Notes */}
          <div className="admin-card space-y-3">
            <h3 className="text-sm font-semibold text-white">Internal Notes</h3>
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Add a support note…"
              rows={3}
              className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-white placeholder-[#4a4a6a] focus:outline-none focus:border-indigo-500 resize-none"
            />
            <button
              onClick={handleAddNote}
              disabled={!newNote.trim()}
              className="text-xs px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20 disabled:opacity-40 transition-colors"
            >
              Add Note
            </button>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {notes.map((n) => (
                <div key={n.id} className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg p-2.5">
                  <p className="text-xs text-white">{n.content}</p>
                  <p className="text-[10px] text-[#4a4a6a] mt-1">{n.admin_username} · {new Date(n.created_at).toLocaleString()}</p>
                </div>
              ))}
              {notes.length === 0 && <p className="text-xs text-[#4a4a6a] text-center py-2">No notes yet</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
