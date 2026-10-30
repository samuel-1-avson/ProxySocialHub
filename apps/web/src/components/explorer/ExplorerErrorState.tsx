'use client';

import Link from 'next/link';
import { AlertTriangle, SearchX, ServerCrash, WifiOff } from 'lucide-react';
import {
    ExplorerApiError,
    isExplorerNotFound,
    isExplorerNetworkError,
} from '@/lib/services/explorer-errors';

type ExplorerErrorStateProps = {
    error: unknown;
    entity: string;
    backHref: string;
    backLabel: string;
};

export function ExplorerErrorState({ error, entity, backHref, backLabel }: ExplorerErrorStateProps) {
    const apiError = error instanceof ExplorerApiError ? error : null;
    const notFound = isExplorerNotFound(error);
    const network = isExplorerNetworkError(error);
    const server = apiError?.kind === 'server' || (!notFound && !network && !!error);

    const Icon = notFound ? SearchX : network ? WifiOff : server ? ServerCrash : AlertTriangle;
    const title = notFound
        ? `${entity} not found`
        : network
          ? 'Connection problem'
          : server
            ? 'Server error'
            : 'Something went wrong';

    const description = notFound
        ? `We could not find this ${entity.toLowerCase()} in the index. It may be invalid, not yet synced, or outside the public explorer.`
        : network
          ? 'Could not reach the explorer API. Check your connection and try again.'
          : apiError?.message ||
            `Failed to load ${entity.toLowerCase()} details. Try again in a moment.`;

    const iconClass = notFound
        ? 'text-muted-foreground'
        : network
          ? 'text-warning'
          : 'text-destructive';

    return (
        <div className="min-h-[50vh] flex items-center justify-center font-mono px-4">
            <div className="text-center space-y-5 max-w-md">
                <Icon size={40} className={`mx-auto ${iconClass}`} />
                <h1 className="text-2xl font-semibold text-foreground tracking-tight">{title}</h1>
                <p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
                {apiError?.status && apiError.status >= 500 && (
                    <p className="text-xs font-semibold text-muted-foreground">
                        Reference: HTTP {apiError.status}
                    </p>
                )}
                <Link
                    href={backHref}
                    className="inline-block text-primary hover:text-primary/80 text-xs font-semibold"
                >
                    {backLabel}
                </Link>
            </div>
        </div>
    );
}
