"use client";

import {
  CheckCircle2,
  AlertTriangle,
  XOctagon,
  Clock,
  Loader2,
  Radio,
  ShieldCheck,
  PauseCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Status variants per reconstruction plan §11.6 — always icon + label (never color-only).
 */
export type StatusVariant =
  | "live"
  | "healthy"
  | "online"
  | "degraded"
  | "down"
  | "offline"
  | "syncing"
  | "processing"
  | "paused"
  | "pending"
  | "error"
  | "verified"
  | "new";

export type StatusSize = "sm" | "md";

/** @deprecated Prefer StatusVariant; kept for existing call sites */
export type StatusType = "online" | "offline" | "degraded" | "pending" | "processing";

interface StatusBadgeProps {
  status: StatusVariant | StatusType;
  label?: string;
  size?: StatusSize;
  /** Pulse only for live indicators; disabled under prefers-reduced-motion via CSS */
  pulse?: boolean;
  className?: string;
}

const CONFIG: Record<
  StatusVariant,
  { label: string; icon: typeof CheckCircle2; tone: string }
> = {
  live: {
    label: "Live",
    icon: Radio,
    tone: "text-[var(--success)] bg-[color-mix(in_srgb,var(--success)_12%,transparent)] border-[color-mix(in_srgb,var(--success)_30%,var(--border))]",
  },
  healthy: {
    label: "Healthy",
    icon: CheckCircle2,
    tone: "text-[var(--success)] bg-[color-mix(in_srgb,var(--success)_12%,transparent)] border-[color-mix(in_srgb,var(--success)_30%,var(--border))]",
  },
  online: {
    label: "Online",
    icon: CheckCircle2,
    tone: "text-[var(--success)] bg-[color-mix(in_srgb,var(--success)_12%,transparent)] border-[color-mix(in_srgb,var(--success)_30%,var(--border))]",
  },
  degraded: {
    label: "Degraded",
    icon: AlertTriangle,
    tone: "text-[var(--warning)] bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] border-[color-mix(in_srgb,var(--warning)_30%,var(--border))]",
  },
  down: {
    label: "Down",
    icon: XOctagon,
    tone: "text-[var(--destructive)] bg-[color-mix(in_srgb,var(--destructive)_12%,transparent)] border-[color-mix(in_srgb,var(--destructive)_30%,var(--border))]",
  },
  offline: {
    label: "Offline",
    icon: XOctagon,
    tone: "text-[var(--destructive)] bg-[color-mix(in_srgb,var(--destructive)_12%,transparent)] border-[color-mix(in_srgb,var(--destructive)_30%,var(--border))]",
  },
  syncing: {
    label: "Syncing",
    icon: Loader2,
    tone: "text-[var(--info)] bg-[color-mix(in_srgb,var(--info)_12%,transparent)] border-[color-mix(in_srgb,var(--info)_30%,var(--border))]",
  },
  processing: {
    label: "Processing",
    icon: Loader2,
    tone: "text-[var(--info)] bg-[color-mix(in_srgb,var(--info)_12%,transparent)] border-[color-mix(in_srgb,var(--info)_30%,var(--border))]",
  },
  paused: {
    label: "Paused",
    icon: PauseCircle,
    tone: "text-muted-foreground bg-secondary border-border",
  },
  pending: {
    label: "Pending",
    icon: Clock,
    tone: "text-muted-foreground bg-secondary border-border",
  },
  error: {
    label: "Error",
    icon: XOctagon,
    tone: "text-[var(--destructive)] bg-[color-mix(in_srgb,var(--destructive)_12%,transparent)] border-[color-mix(in_srgb,var(--destructive)_30%,var(--border))]",
  },
  verified: {
    label: "Verified",
    icon: ShieldCheck,
    tone: "text-[var(--info)] bg-[color-mix(in_srgb,var(--info)_12%,transparent)] border-[color-mix(in_srgb,var(--info)_30%,var(--border))]",
  },
  new: {
    label: "New",
    icon: Clock,
    tone: "text-muted-foreground bg-secondary border-border",
  },
};

export function StatusBadge({
  status,
  label,
  size = "sm",
  pulse = false,
  className,
}: StatusBadgeProps) {
  const config = CONFIG[status as StatusVariant] ?? CONFIG.pending;
  const Icon = config.icon;
  const text = label ?? config.label;
  const spinning = status === "syncing" || status === "processing";
  const showPulse = pulse || status === "live";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        config.tone,
        className
      )}
      role="status"
      aria-label={text}
    >
      <span className="relative flex h-3 w-3 items-center justify-center" aria-hidden>
        {showPulse ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-40 motion-reduce:hidden" />
        ) : null}
        <Icon size={12} className={spinning ? "animate-spin motion-reduce:animate-none" : ""} strokeWidth={2.5} />
      </span>
      {text}
    </span>
  );
}
