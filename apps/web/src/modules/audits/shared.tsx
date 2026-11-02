"use client";
import type { ReactNode } from "react";
import { FlaskConical, History, Radio } from "lucide-react";
import { Status } from "@/components/workspace/Patterns";
import type { Assurance, AuditMode, EvidenceOrigin, JobStatus, RegionStatus } from "@/lib/api/audits";

type Tone = "good" | "warning" | "error" | "neutral";

export const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  partial: "Partial: some evidence is missing",
  failed: "Failed",
  cancelled: "Cancelled",
};
const STATUS_TONE: Record<JobStatus, Tone> = {
  queued: "neutral",
  running: "neutral",
  completed: "good",
  partial: "warning",
  failed: "error",
  cancelled: "neutral",
};
export function JobStatusLabel({ status }: { status: JobStatus }) {
  return <Status tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Status>;
}

export const REGION_STATUS_LABEL: Record<RegionStatus, string> = {
  pending: "Waiting",
  running: "Capturing",
  captured: "Verified and captured",
  unverified: "Captured, exit not verified",
  mismatch: "Wrong region: not interpreted",
  unavailable: "No session available",
  failed: "Capture failed",
  cancelled: "Cancelled",
};
const REGION_TONE: Record<RegionStatus, Tone> = {
  pending: "neutral",
  running: "neutral",
  captured: "good",
  unverified: "warning",
  mismatch: "error",
  unavailable: "error",
  failed: "error",
  cancelled: "neutral",
};
export function RegionStatusLabel({ status }: { status: RegionStatus }) {
  return <Status tone={REGION_TONE[status]}>{REGION_STATUS_LABEL[status]}</Status>;
}

export const ASSURANCE_LABEL: Record<Assurance, string> = {
  verified: "Verified: GeoIP estimate matches the request",
  unverified: "Unverified: exit country could not be confirmed",
  mismatch: "Mismatch: the exit is in a different country",
  direct_egress: "Direct connection detected (not proxied)",
  unavailable: "Egress was not observed",
};

export const MODE_LABEL: Record<AuditMode, string> = {
  live: "Live",
  fixture: "Synthetic fixture",
  replay: "Replay",
};

export function ModeBadge({ origin }: { origin: EvidenceOrigin }) {
  if (origin === "live_capture") {
    return (
      <span className="audit-badge live">
        <Radio size={12} aria-hidden="true" /> Live capture
      </span>
    );
  }
  if (origin === "recorded_replay") {
    return (
      <span className="audit-badge replay">
        <History size={12} aria-hidden="true" /> Recorded replay
      </span>
    );
  }
  return (
    <span className="audit-badge fixture">
      <FlaskConical size={12} aria-hidden="true" /> Synthetic fixture
    </span>
  );
}

/** The evidence mode is never implicit: every page that shows results starts with this banner. */
export function OriginBanner({ origin, compact = false }: { origin: EvidenceOrigin; compact?: boolean }) {
  const copy: Record<EvidenceOrigin, { cls: string; title: string; body: ReactNode }> = {
    live_capture: {
      cls: "live",
      title: "Live capture",
      body: "Evidence was newly captured through ProxyHubb regional sessions that you authorized. Each exit is verified before anything is interpreted.",
    },
    synthetic_fixture: {
      cls: "fixture",
      title: "Synthetic fixture: not a real regional capture",
      body: "A local demo website was visited through a local fixture proxy. Routes, IP addresses and locations are synthetic. This mode exists to demonstrate and test the audit pipeline, and it is never available in production.",
    },
    recorded_replay: {
      cls: "replay",
      title: "Recorded replay",
      body: "Evidence was captured earlier; each capture keeps its original timestamp. Only the AI analysis is new.",
    },
  };
  const c = copy[origin];
  return (
    <div className={`audit-banner ${c.cls}`} role="note">
      <div>
        <strong>{c.title}</strong>
        {!compact && c.body}
      </div>
    </div>
  );
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return "n/a";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "n/a"
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function ms(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value).toLocaleString()} ms` : "n/a";
}
