"use client";

import { useState, useEffect, useRef } from "react";
import { Activity, Radio, X } from "lucide-react";
import { authHeaders } from "@/lib/auth";

// /api prefix routes through Next.js rewrite proxy to the backend
const API_BASE = "/api";

interface LiveSession {
  id: string;
  user_id: string;
  node_id: string;
  status: string;
  bytes_up: number;
  bytes_down: number;
  started_at: string;
  duration_s?: number;
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [connected, setConnected] = useState(false);
  const [total, setTotal] = useState(0);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const token = Object.values(authHeaders())[0]?.split(" ")[1];
    const url = token
      ? `${API_BASE}/v1/admin/sessions/stream?token=${encodeURIComponent(token)}`
      : null;

    if (!url) return;

    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.addEventListener("session_update", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        setSessions(data.sessions ?? []);
        setTotal(data.total ?? 0);
      } catch { /* ignore parse errors */ }
    });

    return () => {
      es.close();
      setConnected(false);
    };
  }, []);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Radio className={`w-4 h-4 ${connected ? "text-emerald-400 animate-pulse" : "text-[#4a4a6a]"}`} />
          <span className="text-sm font-medium text-white">Live Session Monitor</span>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${
            connected
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-[#1e1e2e] border-[#1e1e2e] text-[#4a4a6a]"
          }`}>
            {connected ? "LIVE" : "Connecting…"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm text-[#94a3b8]">
          <Activity className="w-4 h-4" />
          <span>{total} active session{total !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* Table */}
      <div className="admin-card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full admin-table text-sm">
            <thead>
              <tr className="border-b border-[#1e1e2e]">
                {["Session ID", "User", "Node", "Upload", "Download", "Status", "Duration"].map((h) => (
                  <th key={h} className="text-left text-[10px] font-semibold text-[#4a4a6a] uppercase tracking-wider px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e1e2e]">
              {sessions.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-16 text-[#4a4a6a]">
                    {connected ? "No active sessions" : "Connecting to live feed…"}
                  </td>
                </tr>
              )}
              {sessions.map((s) => (
                <tr key={s.id} className="transition-colors animate-pulse-slow">
                  <td className="px-4 py-3 font-mono text-xs text-[#94a3b8]">{s.id.slice(0, 12)}…</td>
                  <td className="px-4 py-3 font-mono text-xs text-[#94a3b8]">{s.user_id.slice(0, 8)}…</td>
                  <td className="px-4 py-3 font-mono text-xs text-[#94a3b8]">{s.node_id?.slice(0, 8)}…</td>
                  <td className="px-4 py-3 text-xs text-sky-400">{bytes(s.bytes_up ?? 0)}</td>
                  <td className="px-4 py-3 text-xs text-emerald-400">{bytes(s.bytes_down ?? 0)}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded border bg-emerald-500/10 border-emerald-500/20 text-emerald-400">
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#94a3b8]">
                    {s.duration_s ? `${Math.floor(s.duration_s / 60)}m ${s.duration_s % 60}s` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* SSE note */}
      <p className="text-xs text-[#4a4a6a] flex items-center gap-1.5">
        <X className="w-3 h-3" />
        Session data streams via Server-Sent Events from the control-api SSE endpoint.
      </p>
    </div>
  );
}
