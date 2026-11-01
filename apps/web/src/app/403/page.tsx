import { PublicStatusPage } from "@/components/marketing/PublicStatusPage";
import { ROUTES } from "@/lib/navigation/routes";

const POLICY_COPY: Record<
  string,
  { title: string; body: string; actionHref: string; actionLabel: string }
> = {
  provider: {
    title: "Provider access required",
    body: "This area is only available to approved providers. Apply to become a provider or switch to your provider workspace if you already have access.",
    actionHref: ROUTES.dashboardBecomeProvider,
    actionLabel: "Become a provider",
  },
  admin: {
    title: "Admin access required",
    body: "You do not have permission to view this administration area.",
    actionHref: ROUTES.dashboard,
    actionLabel: "Back to dashboard",
  },
  authenticated: {
    title: "Sign in required",
    body: "You need an active session to view this page.",
    actionHref: ROUTES.login,
    actionLabel: "Sign in",
  },
};

/**
 * Permission-denied page — reconstruction plan §15.26 / §6.2
 * Middleware redirects role failures here with ?policy=
 */
export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ policy?: string }>;
}) {
  const params = await searchParams;
  const policy = (params.policy || "authenticated").toLowerCase();
  const copy = POLICY_COPY[policy] ?? {
    title: "Access denied",
    body: "You do not have permission to view this page.",
    actionHref: ROUTES.dashboard,
    actionLabel: "Back to dashboard",
  };

  return (
    <PublicStatusPage
      code="403"
      title={copy.title}
      description={copy.body}
      actionHref={copy.actionHref}
      actionLabel={copy.actionLabel}
    />
  );
}
