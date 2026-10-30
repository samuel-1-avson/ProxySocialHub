import type { ReactNode } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";

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
    <div className="ui-loading" role="status">
      <Loader2 size={18} className="animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}
export function DataError({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div className="ui-error" role="alert">
      <strong className="ui-inline-icon">
        <AlertCircle size={17} aria-hidden="true" />
        This data is unavailable
      </strong>
      <p>
        {error instanceof Error
          ? error.message
          : "We could not load this section. Other parts of your workspace are still available."}
      </p>
      {retry && (
        <button className="ui-button small secondary" onClick={retry}>
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
}: {
  title: string;
  description: string;
  href?: string;
  action?: string;
}) {
  return (
    <section className="ui-empty">
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
}: {
  label: string;
  value: ReactNode;
  detail: string;
}) {
  return (
    <div>
      <div className="ui-stat-label">{label}</div>
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
