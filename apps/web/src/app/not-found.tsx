import Link from 'next/link';
import { ROUTES } from '@/lib/navigation/routes';

/**
 * Global 404 — reconstruction plan §15.26
 */
export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-4 text-center bg-background text-foreground">
      <p className="font-mono text-sm text-muted-foreground">
        404
      </p>
      <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
        Page not found
      </h1>
      <p className="text-muted-foreground max-w-md text-sm">
        The page you requested does not exist or has moved. Check the URL or
        return to a known destination.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href={ROUTES.home}
          className="inline-flex items-center justify-center rounded-[var(--radius-md)] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Go home
        </Link>
        <Link
          href={ROUTES.marketplace}
          className="inline-flex items-center justify-center rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-medium hover:bg-secondary"
        >
          Browse marketplace
        </Link>
        <Link
          href={ROUTES.help}
          className="inline-flex items-center justify-center rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-medium hover:bg-secondary"
        >
          Help center
        </Link>
      </div>
    </main>
  );
}
