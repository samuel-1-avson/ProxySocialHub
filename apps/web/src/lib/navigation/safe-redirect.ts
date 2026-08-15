/**
 * Safe internal post-auth redirect helpers.
 */

const BLOCKED_PREFIXES = ['//', '/\\', '/http:', '/https:'];

/** Returns a same-origin relative path or null if unsafe / missing. */
export function resolveSafeInternalPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//')) return null;
  const lower = value.toLowerCase();
  if (BLOCKED_PREFIXES.some((p) => lower.startsWith(p))) return null;
  if (lower.includes('://')) return null;
  // Stay within app paths (no protocol-relative or encoded tricks).
  if (value.includes('\\')) return null;
  return value;
}

export function readAuthRedirectFromSearch(search: string): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return (
    resolveSafeInternalPath(params.get('next')) ||
    resolveSafeInternalPath(params.get('redirect'))
  );
}
