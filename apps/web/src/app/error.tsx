'use client';

import { useEffect } from 'react';

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Log the error to an error reporting service
        console.error('Application error:', error);
    }, [error]);

    return (
        <div className="flex h-[calc(100vh-4rem)] flex-col items-center justify-center gap-4 text-center">
            <h2 className="text-2xl font-bold tracking-tight">Something went wrong!</h2>
            <p className="text-muted-foreground max-w-[500px]">
                {error.message || 'An unexpected error occurred. Please try again later.'}
            </p>
            <div className="flex gap-2">
                <button
                    onClick={() => window.location.href = '/'}
                    className="rounded-md bg-secondary px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary/90"
                >
                    Go Home
                </button>
                <button
                    onClick={() => reset()}
                    className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                    Try again
                </button>
            </div>
        </div>
    );
}
