import { fetchWithAuth } from '../auth';

// Empty string = relative URL. All /v1/* requests are proxied server-side
// by Next.js rewrites (next.config.ts) to the internal backend.
export const API_BASE_URL = '';

export { fetchWithAuth };
