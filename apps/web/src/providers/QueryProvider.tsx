'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState, ReactNode } from 'react';

interface QueryProviderProps {
    children: ReactNode;
}

/**
 * React Query provider with optimized defaults
 * - 5 minute stale time for most data
 * - 30 minute cache time
 * - Auto refetch on window focus
 * - 3 retry attempts with exponential backoff
 */
export function QueryProvider({ children }: QueryProviderProps) {
    const [queryClient] = useState(() => new QueryClient({
        defaultOptions: {
            queries: {
                // Data is considered fresh for 5 minutes
                staleTime: 5 * 60 * 1000,
                // Keep inactive data in cache for 30 minutes
                gcTime: 30 * 60 * 1000,
                // Refetch on window focus
                refetchOnWindowFocus: true,
                // Don't refetch on mount if data is fresh
                refetchOnMount: true,
                // Retry failed requests, but never on 4xx errors (auth failures, not found, etc.)
                retry: (failureCount, error: any) => {
                    const status = error?.status ?? error?.response?.status;
                    if (status >= 400 && status < 500) return false;
                    return failureCount < 3;
                },
                // Exponential backoff for retries
                retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
            },
            mutations: {
                // Retry mutations once
                retry: 1,
            },
        },
    }));

    return (
        <QueryClientProvider client={queryClient}>
            {children}
            {process.env.NODE_ENV === 'development' && (
                <ReactQueryDevtools
                    initialIsOpen={false}
                    buttonPosition="bottom-left"
                />
            )}
        </QueryClientProvider>
    );
}

export default QueryProvider;
