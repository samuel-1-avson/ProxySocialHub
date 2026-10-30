import Link from 'next/link';
import { ROUTES } from '@/lib/navigation/routes';

const POLICY_COPY: Record<string, { title: string; body: string; actionHref: string; actionLabel: string }> = {
  provider: {
    title: 'Provider access required',
    body: 'This area is only available to approved providers. Apply to become a provider or switch to your provider workspace if you already have access.',
    actionHref: ROUTES.dashboardBecomeProvider,
    actionLabel: 'Become a provider',
  },
  admin: {
    title: 'Admin access required',
    body: 'You do not have permission to view this administration area.',
    actionHref: ROUTES.dashboard,
    actionLabel: 'Back to dashboard',
  },
  authenticated: {
    title: 'Sign in required',
    body: 'You need an active session to view this page.',
    actionHref: ROUTES.login,
    actionLabel: 'Sign in',
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
  const policy = (params.policy || 'authenticated').toLowerCase();
  const copy = POLICY_COPY[policy] ?? {
    title: 'Access denied',
    body: 'You do not have permission to view this page.',
    actionHref: ROUTES.dashboard,
    actionLabel: 'Back to dashboard',
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-4 text-center bg-background text-foreground">
      <p className="font-mono text-sm text-muted-foreground">
        403
      </p>
      <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">{copy.title}</h1>
      <p className="text-muted-foreground max-w-md text-sm">{copy.body}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href={copy.actionHref}
          className="inline-flex items-center justify-center rounded-[var(--radius-md)] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          {copy.actionLabel}
        </Link>
        <Link
          href={ROUTES.home}
          className="inline-flex items-center justify-center rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-medium hover:bg-secondary"
        >
          Go home
        </Link>
      </div>
    </main>
  );
}
