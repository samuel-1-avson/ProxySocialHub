'use client';

import { useQuery } from '@tanstack/react-query';

// Share the deployment's runtime configuration across the page and button.
export function useGoogleSignInConfig() {
  return useQuery({
    queryKey: ['google-sign-in-config'],
    queryFn: async () => {
      const response = await fetch('/api/auth/google-config', { cache: 'no-store' });
      if (!response.ok) throw new Error('Google sign-in configuration unavailable');
      const data: { clientId?: unknown } = await response.json();
      if (typeof data.clientId !== 'string') throw new Error('Invalid Google sign-in configuration');
      return data.clientId.trim();
    },
    staleTime: 60_000,
    retry: 1,
  });
}
