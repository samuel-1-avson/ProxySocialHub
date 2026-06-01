/**
 * Unified explorer search routing (dashboard, search page, deep links).
 * Solana tx signatures are typically 87–88 base58 characters; we accept 64–90 for variance.
 */

export type ExplorerSearchKind =
    | 'transaction'
    | 'wallet'
    | 'block'
    | 'contract'
    | 'node'
    | 'nodes_query';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** Detect search target from query text (auto mode). */
export function detectExplorerSearchType(query: string): ExplorerSearchKind {
    const q = query.trim();
    if (!q) return 'nodes_query';
    if (/^\d+$/.test(q)) return 'block';
    if (BASE58.test(q) && q.length >= 64 && q.length <= 90) return 'transaction';
    if (BASE58.test(q) && q.length >= 32 && q.length <= 44) return 'wallet';
    return 'nodes_query';
}

/** Build a client route for the resolved search kind. */
export function buildExplorerSearchPath(query: string, kind?: ExplorerSearchKind): string {
    const q = query.trim();
    if (!q) return '/explorer/search';
    const resolved = kind ?? detectExplorerSearchType(q);
    switch (resolved) {
        case 'transaction':
            return `/explorer/transactions/${q}`;
        case 'wallet':
            return `/explorer/wallets/${q}`;
        case 'block':
            return `/explorer/blocks/${q}`;
        case 'contract':
            return `/explorer/contracts/${q}`;
        case 'node':
            return `/explorer/nodes/${q}`;
        case 'nodes_query':
        default:
            return `/explorer/nodes?q=${encodeURIComponent(q)}`;
    }
}
