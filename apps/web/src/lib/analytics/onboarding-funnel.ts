import { postOnboardingEvent, type OnboardingEventName } from '@/lib/api/onboarding';

/**
 * Fire-and-forget onboarding funnel event (authenticated, wallet-only — no email).
 */
export function trackOnboardingEvent(
  event: OnboardingEventName,
  meta?: Record<string, string | number | boolean>,
  surface = 'onboarding',
): void {
  void postOnboardingEvent(event, surface, meta).catch(() => {
    /* analytics must not break UX */
  });
}

/** Deduped once per tab session for noisy UI events. */
export function trackOnboardingEventOnce(
  key: string,
  event: OnboardingEventName,
  meta?: Record<string, string | number | boolean>,
  surface = 'onboarding',
): void {
  if (typeof window === 'undefined') return;
  const storageKey = `onboarding:evt:${key}`;
  if (sessionStorage.getItem(storageKey)) return;
  sessionStorage.setItem(storageKey, '1');
  trackOnboardingEvent(event, meta, surface);
}

export const ONBOARDING_STEP_LABELS: Record<string, string> = {
  intent: 'Choose path',
  wallet: 'Confirm wallet',
  kyc: 'Identity verification',
  apply: 'Provider application',
  token: 'Create provider token',
  node: 'Register node',
  online: 'Go online',
  profile: 'Complete profile',
  fund: 'Fund wallet',
  browse: 'Browse marketplace',
  session: 'Start a session',
};

export function onboardingStepLabel(step: string | undefined | null): string {
  if (!step) return 'Get started';
  return ONBOARDING_STEP_LABELS[step] || step;
}
