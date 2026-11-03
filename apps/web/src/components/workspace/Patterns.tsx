import type { ReactNode } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Inbox,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { LOCATION_SHARED_LATER, isMaskedLocation } from "@/lib/listing-display";

export function PageHeading({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string;
  description: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="ui-page-header">
      <div>
        {eyebrow && <div className="ui-eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="ui-actions">{actions}</div>}
    </header>
  );
}
export function Loading({
  label = "Loading your workspace…",
}: {
  label?: string;
}) {
  return (
    <div className="ui-loading-panel" role="status" aria-live="polite">
      <div className="ui-loading-label">
        <Loader2 size={17} className="animate-spin" aria-hidden="true" />
        {label}
      </div>
      <div className="ui-loading-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
export function DataError({
  error,
  retry,
  title = "This data is unavailable",
}: {
  error: unknown;
  retry?: () => void;
  title?: string;
}) {
  const message = error instanceof Error ? error.message : "";
  const generic =
    !message ||
    /^(request failed|failed to fetch|network error)$/i.test(message);
  return (
    <div className="ui-error" role="alert">
      <strong className="ui-inline-icon">
        <AlertCircle size={17} aria-hidden="true" />
        {title}
      </strong>
      <p>
        {generic
          ? "We couldn’t load this section. Try again in a moment; your other workspace tools are still available."
          : message}
      </p>
      {retry && (
        <button
          type="button"
          className="ui-button small secondary"
          onClick={retry}
        >
          <RefreshCw size={13} aria-hidden="true" />
          Try again
        </button>
      )}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  href,
  action,
  icon,
}: {
  title: string;
  description: string;
  href?: string;
  action?: string;
  icon?: ReactNode;
}) {
  return (
    <section className="ui-empty">
      <span className="ui-empty-icon" aria-hidden="true">
        {icon ?? <Inbox size={24} />}
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {href && (
        <Link className="ui-button" href={href}>
          {action}
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      )}
    </section>
  );
}
export function Status({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "good" | "warning" | "error" | "neutral";
}) {
  return <span className={`ui-status ${tone}`}>{children}</span>;
}
export function Stat({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: ReactNode;
  detail: string;
  icon?: ReactNode;
}) {
  return (
    <div className="ui-stat-card">
      <div className="ui-stat-top">
        <div className="ui-stat-label">{label}</div>
        {icon && (
          <span className="ui-stat-icon" aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
      <div className="ui-stat-value">{value}</div>
      <div className="ui-stat-detail">{detail}</div>
    </div>
  );
}
export function amount(value: unknown, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: digits })
    : "Not available";
}
export function countryName(code?: string): string {
  if (!code) return "Location not specified";
  if (isMaskedLocation(code)) return LOCATION_SHARED_LATER;
  try {
    return (
      new Intl.DisplayNames(["en"], { type: "region" }).of(
        code.toUpperCase(),
      ) ?? code
    );
  } catch {
    return code;
  }
}
export function shortDate(value?: string): string {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
