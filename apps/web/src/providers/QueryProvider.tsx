"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState, ReactNode } from "react";

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
  const [queryClient] = useState(
    () =>
      new QueryClient({
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
            retry: (failureCount, error) => {
              const detail = error as Error & {
                status?: number;
                response?: { status?: number };
              };
              const status = detail.status ?? detail.response?.status;
              if (status != null && status >= 400 && status < 500) return false;
              return failureCount < 3;
            },
            // Exponential backoff for retries
            retryDelay: (attemptIndex) =>
              Math.min(1000 * 2 ** attemptIndex, 30000),
          },
          mutations: {
            // Do not repeat writes after an ambiguous response. Individual idempotent operations may opt in.
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools
          initialIsOpen={false}
          buttonPosition="bottom-left"
        />
      )}
    </QueryClientProvider>
  );
}

export default QueryProvider;
