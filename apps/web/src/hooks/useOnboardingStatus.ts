"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  getOnboardingState,
  updateOnboarding,
  type OnboardingState,
} from "@/lib/api/onboarding";
import { trackOnboardingEvent } from "@/lib/analytics/onboarding-funnel";

export const onboardingQueryKey = ["onboarding-state"] as const;

const SOFT_DISMISS_KEY = "onboarding:banner:soft_dismiss";

function readSoftDismiss(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(SOFT_DISMISS_KEY) === "1";
}

export function useOnboardingStatus() {
  const { user, isAuthenticated } = useAuth();
  const qc = useQueryClient();
  const [softDismissed, setSoftDismissed] = useState(readSoftDismiss);

  const query = useQuery({
    queryKey: onboardingQueryKey,
    queryFn: getOnboardingState,
    enabled: isAuthenticated && !!user,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const state = query.data;
  const incomplete = Boolean(state && !state.completed_at);
  const needsOnboarding = Boolean(state?.needs_onboarding);
  const dismissed = Boolean(state?.dismissed_at);
  const showBanner = needsOnboarding && !softDismissed;

  const softDismissBanner = useCallback(() => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(SOFT_DISMISS_KEY, "1");
    }
    setSoftDismissed(true);
  }, []);

  const dismissPermanently = useCallback(async (): Promise<OnboardingState | null> => {
    const next = await updateOnboarding({ dismiss: true });
    trackOnboardingEvent("onboarding_dismissed", { via: "banner" }, "banner");
    setSoftDismissed(true);
    await qc.invalidateQueries({ queryKey: onboardingQueryKey });
    return next;
  }, [qc]);

  const resume = useCallback(async (): Promise<OnboardingState | null> => {
    if (dismissed) {
      const next = await updateOnboarding({ resume: true });
      trackOnboardingEvent(
        "onboarding_resumed",
        { current_step: next.current_step },
        "banner",
      );
      if (typeof window !== "undefined") {
        sessionStorage.removeItem(SOFT_DISMISS_KEY);
      }
      setSoftDismissed(false);
      await qc.invalidateQueries({ queryKey: onboardingQueryKey });
      return next;
    }
    trackOnboardingEvent(
      "onboarding_nudge_clicked",
      { current_step: state?.current_step || "unknown" },
      "banner",
    );
    return state ?? null;
  }, [dismissed, qc, state]);

  return {
    state,
    isLoading: query.isLoading,
    incomplete,
    needsOnboarding,
    dismissed,
    showBanner,
    softDismissBanner,
    dismissPermanently,
    resume,
    refetch: query.refetch,
  };
}
