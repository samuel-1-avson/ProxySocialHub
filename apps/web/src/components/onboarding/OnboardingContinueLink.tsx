"use client";

import Link from "next/link";
import { ArrowRight, ListChecks } from "lucide-react";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import {
  onboardingStepLabel,
  trackOnboardingEvent,
} from "@/lib/analytics/onboarding-funnel";
import { ROUTES } from "@/lib/navigation/routes";

/**
 * Compact wallet-only nudge (nav / dashboard card). No email.
 */
export function OnboardingContinueLink({
  className = "",
  variant = "link",
}: {
  className?: string;
  variant?: "link" | "button" | "card";
}) {
  const { incomplete, dismissed, state, resume } = useOnboardingStatus();

  if (!incomplete || !state) return null;

  const label = dismissed ? "Resume setup" : "Continue setup";
  const step = onboardingStepLabel(state.current_step);

  const onClick = () => {
    trackOnboardingEvent(
      "onboarding_nudge_clicked",
      {
        current_step: state.current_step,
        dismissed: dismissed,
        variant,
      },
      variant === "card" ? "dashboard" : "nav",
    );
    void resume();
  };

  if (variant === "card") {
    return (
      <div className={`border border-border bg-card p-5 space-y-3 ${className}`}>
        <div className="flex items-center gap-2 text-primary font-mono text-[10px] font-bold uppercase tracking-widest">
          <ListChecks size={14} />
          Setup incomplete
        </div>
        <p className="text-sm text-muted-foreground">
          Pick up where you left off — next step: <span className="font-mono text-foreground">{step}</span>
        </p>
        <Link
          href={ROUTES.onboarding}
          onClick={onClick}
          className="btn-retro btn-retro-primary inline-flex items-center gap-2 px-4 py-2.5 text-xs"
        >
          {label}
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    );
  }

  if (variant === "button") {
    return (
      <Link href={ROUTES.onboarding} onClick={onClick} className={className}>
        <button
          type="button"
          className="btn-retro btn-retro-outline px-4 py-2 text-[10px] flex items-center gap-2 border-primary/50 text-primary"
        >
          <ListChecks size={14} />
          {label.toUpperCase()}
        </button>
      </Link>
    );
  }

  return (
    <Link
      href={ROUTES.onboarding}
      onClick={onClick}
      className={`text-xs font-mono uppercase tracking-wider text-primary hover:underline ${className}`}
    >
      {label}
    </Link>
  );
}
