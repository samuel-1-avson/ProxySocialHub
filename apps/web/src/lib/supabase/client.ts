// Supabase has been removed. Authentication is handled entirely by the
// self-hosted backend (JWT issued on login, stored in localStorage as
// 'proxyhubb_token'). This file is kept as a stub so that any remaining
// import paths resolve without error while they are migrated.

/** @deprecated Use the local auth context from @/lib/auth instead. */
export function createClient() {
  return null as any;
}

/** Always returns false — Supabase is no longer configured. */
export function isSupabaseConfigured(): boolean {
  return false;
}
