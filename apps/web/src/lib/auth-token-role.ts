// The access token carries the account role it was issued with. When the role changes
// (a provider application is approved, for example) the token keeps the old one until it is
// reissued, and the page guard in middleware.ts reads the role from that token's cookie.
// No path aliases here: scripts/auth-token-role.test.mjs imports this file directly.

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) {
            return null;
        }

        const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
        const payload: unknown = JSON.parse(atob(padded));
        return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

function normalizeRole(role: unknown): string {
    return typeof role === 'string' ? role.trim().toLowerCase() : '';
}

/**
 * True when the token says one role and the account now has another, so the token must be
 * reissued. Unknown on either side (no token, no role claim, no role from the API) is not
 * stale: reissuing could not fix it, and refreshing on every check would loop.
 */
export function isTokenRoleStale(token: string | null | undefined, currentRole: unknown): boolean {
    if (!token) {
        return false;
    }

    const tokenRole = normalizeRole(decodeJwtPayload(token)?.role);
    const accountRole = normalizeRole(currentRole);
    return tokenRole !== '' && accountRole !== '' && tokenRole !== accountRole;
}
