"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Trash2, Plus } from "lucide-react";
import {
  getUser, getUserNotes, addUserNote, deleteUserNote,
  banUser, unbanUser, suspendUser, activateUser, forceLogout,
  type UserDetail, type AdminNote,
} from "@/lib/api";

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [notes, setNotes] = useState<AdminNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [d, n] = await Promise.all([getUser(id), getUserNotes(id)]);
      setDetail(d);
      setNotes(n.notes);
    } catch { router.replace("/dashboard/users"); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [id]);

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    setSaving(true);
    try {
      await addUserNote(id, newNote.trim());
      setNewNote("");
      const n = await getUserNotes(id);
      setNotes(n.notes);
    } catch (e) { alert(String(e)); }
    finally { setSaving(false); }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!confirm("Delete this note?")) return;
    await deleteUserNote(id, noteId);
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const user = detail?.user;
  if (!user) return null;

  return (
    <div className="max-w-4xl space-y-6">
      <button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-[#94a3b8] hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Users
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Profile */}
        <div className="admin-card space-y-4">
          <h2 className="text-sm font-semibold text-white">User Profile</h2>
          <div className="space-y-2.5 text-sm">
            {[
              ["Email", user.email],
              ["ID", user.id],
              ["Role", user.role],
              ["Status", user.status],
              ["Trust Tier", user.trust_tier],
              ["Joined", new Date(user.created_at).toLocaleString()],
              ["Sessions", String(detail?.session_count ?? 0)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-1.5 border-b border-[#1e1e2e] last:border-0">
                <span className="text-[#94a3b8] shrink-0">{k}</span>
                <span className="text-white text-right font-mono text-xs truncate">{v}</span>
              </div>
            ))}
          </div>

          {/* Quick actions */}
          <div className="flex flex-wrap gap-2 pt-2">
            {user.status !== "banned"
              ? <button onClick={() => banUser(id).then(load)} className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors">Ban</button>
              : <button onClick={() => unbanUser(id).then(load)} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 transition-colors">Unban</button>
            }
            {user.status === "active"
              ? <button onClick={() => suspendUser(id).then(load)} className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-colors">Suspend</button>
              : user.status === "suspended"
              ? <button onClick={() => activateUser(id).then(load)} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 transition-colors">Activate</button>
              : null
            }
            <button onClick={() => forceLogout(id).then(load)} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-[#1e1e2e] text-[#94a3b8] hover:text-white transition-colors">Force Logout</button>
          </div>
        </div>

        {/* Admin Notes */}
        <div className="admin-card space-y-4">
          <h2 className="text-sm font-semibold text-white">Internal Admin Notes</h2>
          <p className="text-xs text-[#4a4a6a]">Notes are private — never shown to the user.</p>

          {/* Add note */}
          <div className="space-y-2">
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Add a note about this user…"
              rows={3}
              maxLength={2000}
              className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-white placeholder-[#4a4a6a] focus:outline-none focus:border-indigo-500 resize-none"
            />
            <button
              onClick={handleAddNote}
              disabled={saving || !newNote.trim()}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20 disabled:opacity-40 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {saving ? "Saving…" : "Add Note"}
            </button>
          </div>

          {/* Notes list */}
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {notes.length === 0 && (
              <p className="text-xs text-[#4a4a6a] text-center py-4">No notes yet</p>
            )}
            {notes.map((note) => (
              <div key={note.id} className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg p-3 group">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="text-xs text-white whitespace-pre-wrap">{note.content}</p>
                    <p className="text-[10px] text-[#4a4a6a] mt-1">
                      {note.admin_username} · {new Date(note.created_at).toLocaleString()}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteNote(note.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/10 text-[#4a4a6a] hover:text-red-400 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
