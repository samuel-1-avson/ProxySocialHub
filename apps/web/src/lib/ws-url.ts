function toWsBase(raw: string): string {
    const trimmed = raw.trim().replace(/\/$/, '');
    if (!trimmed) return '';

    if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
        return trimmed;
    }

    if (trimmed.startsWith('http://')) {
        return `ws://${trimmed.slice('http://'.length)}`;
    }

    if (trimmed.startsWith('https://')) {
        return `wss://${trimmed.slice('https://'.length)}`;
    }

    return trimmed;
}

function getWsBaseFromEnv(): string {
    const explicitWs = toWsBase(process.env.NEXT_PUBLIC_WS_URL || '');
    if (explicitWs) return explicitWs;

    const apiAsWs = toWsBase(process.env.NEXT_PUBLIC_API_URL || '');
    if (apiAsWs) return apiAsWs;

    return '';
}

function getWsUrl(path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const envBase = getWsBaseFromEnv();
    if (envBase) {
        return `${envBase}${normalizedPath}`;
    }

    if (typeof window !== 'undefined') {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${window.location.host}${normalizedPath}`;
    }

    return normalizedPath;
}

export function getExplorerWsUrl(): string {
    return getWsUrl('/v1/explorer/ws');
}

export function getRealtimeWsUrl(): string {
    return getWsUrl('/v1/ws');
}

/**
 * Appends the access token as a query parameter. Browsers cannot set
 * Authorization headers on WebSocket handshakes; the control-api accepts
 * ?token= only on genuine upgrade requests (see authTokenFromRequest).
 */
export function withWsToken(url: string, token: string): string {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}token=${encodeURIComponent(token)}`;
}

/**
 * Appends a short-lived single-use WS ticket (?ticket=). Preferred over
 * ?token= because the ticket keeps the JWT out of the URL (and server logs).
 */
export function withWsTicket(url: string, ticket: string): string {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}ticket=${encodeURIComponent(ticket)}`;
}

/**
 * Prefer POST /v1/ws/ticket then fall back to ?token=.
 * Keeps JWT out of URLs when the ticket endpoint is available.
 */
export async function resolveAuthedWsUrl(wsUrl: string, accessToken: string): Promise<string> {
    const apiBase = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
    try {
        const res = await fetch(`${apiBase}/v1/ws/ticket`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (res.ok) {
            const data = (await res.json()) as { ticket?: string };
            if (data?.ticket) {
                return withWsTicket(wsUrl, data.ticket);
            }
        }
    } catch {
        // ticket endpoint unavailable — use token fallback
    }
    return withWsToken(wsUrl, accessToken);
}
