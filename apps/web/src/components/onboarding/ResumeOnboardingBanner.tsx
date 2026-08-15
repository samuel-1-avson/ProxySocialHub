"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowRight, ListChecks, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import {
  onboardingStepLabel,
  trackOnboardingEventOnce,
} from "@/lib/analytics/onboarding-funnel";
import { ROUTES } from "@/lib/navigation/routes";

/**
 * Persistent (until soft/permanent dismiss) resume banner for incomplete wallet onboarding.
 * No email — in-app only.
 */
export function ResumeOnboardingBanner({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const {
    state,
    showBanner,
    softDismissBanner,
    dismissPermanently,
    resume,
  } = useOnboardingStatus();

  const onOnboardingPage = pathname?.startsWith(ROUTES.onboarding);

  useEffect(() => {
    if (!showBanner || onOnboardingPage || !state) return;
    trackOnboardingEventOnce(
      `banner:${state.current_step}`,
      "onboarding_banner_shown",
      {
        current_step: state.current_step,
        intent: state.intent || "none",
      },
      "banner",
    );
  }, [showBanner, onOnboardingPage, state]);

  if (!showBanner || onOnboardingPage || !state) {
    return null;
  }

  const stepLabel = onboardingStepLabel(state.current_step);
  const catalog = state.step_catalog?.length ? state.step_catalog : [];
  const done = catalog.filter((s) => state.steps?.[s]?.completed_at).length;
  const total = Math.max(catalog.length, 1);

  return (
    <div
      className={`${compact ? "mb-0" : "mb-6"} border border-primary/40 bg-primary/5 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3`}
    >
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <ListChecks className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-mono font-bold uppercase tracking-wide">
            Continue setup
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Next: {stepLabel}
            {catalog.length > 0 ? ` · ${done}/${total} steps` : ""}
            {state.intent ? ` · ${state.intent} path` : ""}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <Link
          href={ROUTES.onboarding}
          onClick={() => {
            void resume();
          }}
          className="btn-retro btn-retro-primary inline-flex items-center gap-2 px-3 py-2 text-[11px]"
        >
          Resume
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
        <button
          type="button"
          onClick={() => softDismissBanner()}
          className="btn-retro btn-retro-outline inline-flex px-3 py-2 text-[11px]"
          title="Hide until next visit"
        >
          Later
        </button>
        <button
          type="button"
          onClick={() => void dismissPermanently()}
          className="p-2 text-muted-foreground hover:text-foreground border border-transparent hover:border-border"
          aria-label="Dismiss setup reminders"
          title="Don't remind me again"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
