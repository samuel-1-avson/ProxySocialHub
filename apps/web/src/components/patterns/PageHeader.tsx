"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  /** Small label above the title */
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Right-side actions (buttons, tabs, filters) */
  actions?: ReactNode;
  /** Optional "back" link shown above the title */
  backHref?: string;
  backLabel?: string;
  className?: string;
}

/**
 * Canonical page header — reconstruction plan §14 / Quiet Infrastructure.
 * One title, optional description, optional actions. No card chrome.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  backHref,
  backLabel = "Back",
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
    >
      <div className="min-w-0 space-y-1.5">
        {backHref ? (
          <Link
            href={backHref}
            className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={12} aria-hidden /> {backLabel}
          </Link>
        ) : null}
        {eyebrow ? (
          <div className="text-xs font-medium text-primary">{eyebrow}</div>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
