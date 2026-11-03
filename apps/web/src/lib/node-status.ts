"use client";

import { useEffect, useState } from "react";

/**
 * How long a node can stay silent before the dashboard stops calling it
 * online. Matches the server's stale window (PROVIDER_NODE_STALE_AFTER).
 */
export const NODE_STALE_AFTER_MS = 5 * 60_000;

type NodeLike = { status?: string; last_seen_at?: string | null };

/**
 * A node is online only while its last heartbeat is recent. The stored status
 * can lag behind: the server sweeps silent nodes offline every 30 seconds, and
 * a page that is already open would otherwise keep showing "online" until its
 * next refresh. A node with no last-seen time falls back to its stored status.
 */
export function isNodeOnline(node: NodeLike, now: number = Date.now()): boolean {
  if (node.status !== "online") return false;
  if (!node.last_seen_at) return true;
  const seen = Date.parse(node.last_seen_at);
  if (Number.isNaN(seen)) return true;
  return now - seen < NODE_STALE_AFTER_MS;
}

/** Status words for display: a silent "online" node reads as offline. */
export function nodeStatusLabel(node: NodeLike, now: number = Date.now()): string {
  if (node.status === "online") return isNodeOnline(node, now) ? "online" : "offline";
  return node.status ?? "unknown";
}

/** "Last seen 3 minutes ago", or "Never seen" when it has not reported. */
export function lastSeenText(
  node: NodeLike,
  now: number = Date.now(),
): string {
  if (!node.last_seen_at) return "Never seen";
  const seen = Date.parse(node.last_seen_at);
  if (Number.isNaN(seen)) return "Never seen";
  const seconds = Math.max(0, Math.round((now - seen) / 1000));
  if (seconds < 60) return "Last seen just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Last seen ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Last seen ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `Last seen ${days} days ago`;
}

/** The current time, refreshed every 30 seconds so statuses age on screen. */
export function useNodeClock(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
