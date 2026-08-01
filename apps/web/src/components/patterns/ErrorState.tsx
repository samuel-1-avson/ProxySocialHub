import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}

/**
 * Canonical error-state panel — reconstruction plan §14.2 / §5 C-11
 */
export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--destructive)_35%,var(--border))] bg-[color-mix(in_srgb,var(--destructive)_6%,transparent)] px-6 py-10 text-center',
        className
      )}
      role="alert"
    >
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <Button type="button" variant="outline" className="mt-2" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export type { ErrorStateProps };
