import { Suspense } from 'react';
import OnboardingClient from './OnboardingClient';

/**
 * Suspense boundary required for useSearchParams in the wizard.
 */
export default function OnboardingRoute() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
          Loading onboarding…
        </div>
      }
    >
      <OnboardingClient />
    </Suspense>
  );
}
