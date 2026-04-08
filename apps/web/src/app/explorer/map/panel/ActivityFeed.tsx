"use client";

/**
 * Activity Feed Component
 * Real-time node activity feed with filtering.
 * Fetches real session events from the backend API and subscribes
 * to the WebSocket for live updates.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassPanel } from "../components/GlassPanel";

interface ActivityEvent {
  id: string;
  type: "session_start" | "session_end" | "bandwidth" | "reward" | "status_change" | "error";
  nodeId: string;
  nodeName: string;
  timestamp: Date;
  details: string;
  value?: number;
}

interface ActivityFeedProps {
  maxItems?: number;
  filter?: "all" | "sessions" | "rewards" | "errors";
  nodeId?: string;
  className?: string;
}

// Event type configurations
const eventConfig: Record<ActivityEvent["type"], { icon: string; color: string; label: string }> = {
  session_start: { icon: "\u{1F50C}", color: "#39FF14", label: "Session Started" },
  session_end: { icon: "\u{1F50C}", color: "#FF4444", label: "Session Ended" },
  bandwidth: { icon: "\u{1F4CA}", color: "#00F5FF", label: "Bandwidth" },
  reward: { icon: "\u{1F4B0}", color: "#FFD700", label: "Reward" },
  status_change: { icon: "\u{1F504}", color: "#B24DFF", label: "Status" },
  error: { icon: "\u{26A0}\u{FE0F}", color: "#FF4444", label: "Error" },
};

/** Convert a raw session object from the API into an ActivityEvent. */
function sessionToEvent(s: Record<string, unknown>): ActivityEvent {
  const status = (s.status as string) || "";
  let type: ActivityEvent["type"] = "session_start";
  let details = "";
  let value: number | undefined;

  if (status === "active") {
    type = "session_start";
    details = `New session on ${(s.node_id as string) || "unknown"} (${(s.type as string) || "rotating"})`;
  } else if (status === "terminated" || status === "expired") {
    type = "session_end";
    details = `Session ended — ${((s.bytes_used as number) / (1024 * 1024)).toFixed(1)} MB used`;
  } else {
    type = "bandwidth";
    value = Math.round((s.bytes_used as number) / (1024 * 1024));
    details = `Transferred ${value} MB`;
  }

  return {
    id: (s.id as string) || crypto.randomUUID(),
    type,
    nodeId: (s.node_id as string) || "",
    nodeName: (s.node_id as string) || "Unknown",
    timestamp: new Date((s.created_at as string) || Date.now()),
    details,
    value,
  };
}

// Format relative time
const formatRelativeTime = (date: Date): string => {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
};

// Activity Item Component
function ActivityItem({ event, index }: { event: ActivityEvent; index: number }) {
  const config = eventConfig[event.type];
  
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ delay: index * 0.05 }}
      className="flex items-start gap-3 p-3 rounded-lg hover:bg-white/5 transition-colors group"
    >
      {/* Icon */}
      <div 
        className="w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0"
        style={{ 
          backgroundColor: `${config.color}20`,
          border: `1px solid ${config.color}40`,
        }}
      >
        {config.icon}
      </div>
      
      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-white font-medium text-sm">{config.label}</span>
          <span className="text-white/30 text-xs">•</span>
          <span className="text-white/40 text-xs">{event.nodeName}</span>
        </div>
        <p className="text-white/60 text-sm truncate">{event.details}</p>
      </div>
      
      {/* Time */}
      <div className="text-white/30 text-xs flex-shrink-0">
        {formatRelativeTime(event.timestamp)}
      </div>
    </motion.div>
  );
}

export function ActivityFeed({ 
  maxItems = 50, 
  filter = "all",
  nodeId,
  className = "" 
}: ActivityFeedProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [activeFilter, setActiveFilter] = useState(filter);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const latestTimestamp = useRef<string | null>(null);

  /** Fetch recent sessions from the backend and convert to events. */
  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/sessions?limit=20&sort=created_at:desc", {
        headers: {
          Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("proxyhubb_token") || "" : ""}`,
        },
      });
      if (!res.ok) return;
      const data = await res.json();
      const sessions: Record<string, unknown>[] = Array.isArray(data) ? data : data.sessions || [];
      const mapped = sessions.map(sessionToEvent);
      if (mapped.length > 0) {
        latestTimestamp.current = (sessions[0]?.created_at as string) || null;
      }
      setEvents(mapped);
    } catch {
      // API unreachable — keep existing events
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Poll for updates every 10 seconds
  useEffect(() => {
    if (isPaused) return;

    intervalRef.current = setInterval(() => {
      fetchEvents();
    }, 10_000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPaused, fetchEvents]);
  
  // Filter events
  const filteredEvents = events.filter((event) => {
    if (nodeId && event.nodeId !== nodeId) return false;
    if (activeFilter === "all") return true;
    if (activeFilter === "sessions") return event.type === "session_start" || event.type === "session_end";
    if (activeFilter === "rewards") return event.type === "reward";
    if (activeFilter === "errors") return event.type === "error";
    return true;
  });
  
  const filters = [
    { id: "all", label: "All", count: events.length },
    { id: "sessions", label: "Sessions", count: events.filter(e => e.type === "session_start" || e.type === "session_end").length },
    { id: "rewards", label: "Rewards", count: events.filter(e => e.type === "reward").length },
    { id: "errors", label: "Errors", count: events.filter(e => e.type === "error").length },
  ];
  
  return (
    <GlassPanel className={`${className} overflow-hidden`} intensity="medium">
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">📡</span>
            <h3 className="text-white font-semibold">Live Activity</h3>
            <span className="px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 text-xs">
              LIVE
            </span>
          </div>
          <button
            onClick={() => setIsPaused(!isPaused)}
            className={`p-2 rounded-lg transition-colors ${
              isPaused ? "bg-yellow-500/20 text-yellow-400" : "hover:bg-white/5 text-white/40"
            }`}
            title={isPaused ? "Resume" : "Pause"}
          >
            {isPaused ? "▶️" : "⏸️"}
          </button>
        </div>
        
        {/* Filter Tabs */}
        <div className="flex gap-2">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id as typeof activeFilter)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeFilter === f.id
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                  : "text-white/50 hover:text-white hover:bg-white/5"
              }`}
            >
              {f.label}
              <span className="ml-1.5 text-white/30">({f.count})</span>
            </button>
          ))}
        </div>
      </div>
      
      {/* Event List */}
      <div className="max-h-[400px] overflow-y-auto">
        <AnimatePresence mode="popLayout">
          {filteredEvents.length === 0 ? (
            <div className="p-8 text-center text-white/40">
              <span className="text-3xl mb-2 block">📭</span>
              <p className="text-sm">No activity to display</p>
            </div>
          ) : (
            filteredEvents.map((event, index) => (
              <ActivityItem key={event.id} event={event} index={index} />
            ))
          )}
        </AnimatePresence>
        
        {/* Loading indicator for real-time updates */}
        {!isPaused && (
          <div className="p-2 text-center">
            <motion.div
              className="w-1.5 h-1.5 rounded-full bg-cyan-400 mx-auto"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
          </div>
        )}
      </div>
    </GlassPanel>
  );
}

// Compact version for embedding in other panels
export function ActivityFeedCompact({ 
  nodeId,
  maxItems = 5 
}: { 
  nodeId?: string;
  maxItems?: number;
}) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  
  useEffect(() => {
    const fetchCompactEvents = async () => {
      try {
        const url = nodeId
          ? `/api/v1/sessions?limit=${maxItems}&sort=created_at:desc&node_id=${nodeId}`
          : `/api/v1/sessions?limit=${maxItems}&sort=created_at:desc`;
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("proxyhubb_token") || "" : ""}`,
          },
        });
        if (!res.ok) return;
        const data = await res.json();
        const sessions: Record<string, unknown>[] = Array.isArray(data) ? data : data.sessions || [];
        setEvents(sessions.map(sessionToEvent));
      } catch {
        // API unreachable
      }
    };
    fetchCompactEvents();
  }, [maxItems, nodeId]);
  
  const filteredEvents = nodeId 
    ? events.filter(e => e.nodeId === nodeId).slice(0, maxItems)
    : events.slice(0, maxItems);
  
  return (
    <div className="space-y-2">
      {filteredEvents.map((event, index) => {
        const config = eventConfig[event.type];
        return (
          <motion.div
            key={event.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="flex items-center gap-2 text-sm"
          >
            <span>{config.icon}</span>
            <span className="text-white/60 truncate flex-1">{event.details}</span>
            <span className="text-white/30 text-xs">
              {formatRelativeTime(event.timestamp)}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}

export default ActivityFeed;
