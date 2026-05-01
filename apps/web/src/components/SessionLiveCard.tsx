"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { API_BASE_URL } from "@/lib/api/client";
import { Activity, HardDrive, RefreshCw, WifiOff } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface LiveSession {
  id: string;
  buyer_id: string;
  provider_id: string;
  status: string;
  bytes_used: number;
  bandwidth_limit: number;
  started_at: string;
}

interface SessionStreamPayload {
  sessions: LiveSession[];
  count: number;
  total_bytes_used: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncate(s: string, len = 8): string {
  return s ? `${s.slice(0, len)}…` : "—";
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(Number(bytes || 0) / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const isActive = status === "active";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border text-[10px] font-bold uppercase font-mono ${
        isActive
          ? "bg-green-500/10 text-green-500 border-green-500/20"
          : "bg-secondary text-muted-foreground border-border"
      }`}
    >
      {isActive && (
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
      )}
      {status}
    </span>
  );
}

function BandwidthBar({
  used,
  limit,
}: {
  used: number;
  limit: number;
}) {
  const pct =
    limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const color =
    pct >= 90
      ? "bg-red-500"
      : pct >= 70
      ? "bg-amber-500"
      : "bg-green-500";

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
        <span>{formatBytes(used)}</span>
        <span>{limit > 0 ? formatBytes(limit) : "Unlimited"}</span>
      </div>
      <div className="h-1.5 w-full bg-secondary/50 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[9px] font-mono text-muted-foreground text-right">
        {limit > 0 ? `${pct}% used` : "No limit set"}
      </div>
    </div>
  );
}

function SessionCard({ session }: { session: LiveSession }) {
  return (
    <div className="p-4 rounded-2xl bg-white/2 border border-white/5 hover:border-primary/20 hover:bg-white/[0.04] transition-all space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={12} className="text-primary shrink-0" />
          <span className="text-[10px] font-black font-mono text-primary/70 uppercase tracking-widest">
            {truncate(session.id, 8)}
          </span>
        </div>
        <StatusBadge status={session.status} />
      </div>

      {/* IDs */}
      <div className="grid grid-cols-2 gap-3 text-[10px] font-mono">
        <div className="space-y-0.5">
          <p className="text-muted-foreground/50 uppercase font-bold tracking-widest">
            Buyer
          </p>
          <p className="text-foreground/80 truncate">
            {truncate(session.buyer_id, 10)}
          </p>
        </div>
        <div className="space-y-0.5">
          <p className="text-muted-foreground/50 uppercase font-bold tracking-widest">
            Provider
          </p>
          <p className="text-foreground/80 truncate">
            {session.provider_id ? truncate(session.provider_id, 10) : "—"}
          </p>
        </div>
      </div>

      {/* Bandwidth progress */}
      <div className="pt-1">
        <div className="flex items-center gap-1 text-[9px] font-mono font-bold uppercase text-muted-foreground/50 mb-1.5">
          <HardDrive size={9} />
          Bandwidth
        </div>
        <BandwidthBar
          used={session.bytes_used}
          limit={session.bandwidth_limit}
        />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function SessionLiveCard() {
  const { getAccessToken } = useAuth();

  const [payload, setPayload] = useState<SessionStreamPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = async () => {
    // Clean up any existing connection.
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    let token: string | null = null;
    try {
      token = await getAccessToken();
    } catch {
      setError("Failed to retrieve auth token.");
      return;
    }

    if (!token) {
      setError("Not authenticated.");
      return;
    }

    // Use /api/sessions/stream (a streaming Next.js API route) instead of
    // going through the /v1 rewrite — rewrites buffer SSE and break streaming.
    // The auth helper above refreshes and syncs the access-token cookie first.
    const url = "/api/sessions/stream";

    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("sessions", (e) => {
      try {
        const data: SessionStreamPayload = JSON.parse(e.data);
        setPayload(data);
        setConnected(true);
        setError(null);
      } catch {
        console.error("[SessionLiveCard] Failed to parse SSE data", e.data);
      }
    });

    es.onerror = () => {
      setConnected(false);
      setError("Stream disconnected. Reconnecting…");
      es.close();
      esRef.current = null;
      // Attempt reconnect after 5 s.
      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, 5000);
    };
  };

  useEffect(() => {
    connect();

    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sessions = payload?.sessions ?? [];

  return (
    <div className="glass-card !p-0 flex flex-col overflow-hidden border-white/5 bg-black/40 backdrop-blur-3xl rounded-[2rem] shadow-2xl">
      {/* ── Header ── */}
      <div className="p-6 border-b border-white/5 bg-white/[0.02] flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10 border border-primary/20">
            <Activity className="text-primary" size={16} />
          </div>
          <div className="space-y-0.5">
            <h3 className="font-black font-mono uppercase text-[10px] tracking-[0.3em]">
              Live Sessions
            </h3>
            <div className="text-[8px] font-mono text-muted-foreground/40 uppercase tracking-widest flex items-center gap-1.5">
              {connected ? (
                <>
                  <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                  Streaming
                </>
              ) : (
                <>
                  <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" />
                  Connecting
                </>
              )}
            </div>
          </div>
        </div>

        {/* Session count badge */}
        {payload !== null && (
          <div className="flex items-center gap-2 text-[10px] font-mono">
            <span className="px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary font-bold">
              {payload.count} active
            </span>
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide min-h-[200px] max-h-[480px]">
        {/* Error / reconnect banner */}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-mono font-bold uppercase">
            <WifiOff size={12} className="shrink-0" />
            {error}
          </div>
        )}

        {/* Loading state */}
        {!error && payload === null && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <RefreshCw
              size={24}
              className="text-primary animate-spin opacity-60"
            />
            <p className="font-mono text-[8px] uppercase tracking-[0.4em] text-muted-foreground/30">
              Awaiting Stream
            </p>
          </div>
        )}

        {/* Empty state */}
        {payload !== null && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 opacity-30">
            <Activity size={28} />
            <p className="text-[9px] font-black font-mono uppercase tracking-[0.4em]">
              No Active Sessions
            </p>
          </div>
        )}

        {/* Session cards */}
        {sessions.map((s) => (
          <SessionCard key={s.id} session={s} />
        ))}
      </div>

      {/* ── Footer ── */}
      {payload !== null && (
        <div className="p-4 border-t border-white/5 bg-white/[0.02]">
          <div className="flex items-center justify-between text-[9px] font-mono text-muted-foreground/40 uppercase tracking-widest">
            <span>Total Bandwidth Used</span>
            <span className="text-foreground/60 font-bold">
              {formatBytes(payload.total_bytes_used)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
