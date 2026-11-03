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

/**
 * When the SPA is served from the apex (proxyhubb.com) but Next cannot
 * upgrade WebSockets, prefer the API host which Caddy terminates onto
 * control-api with upgrade support.
 */
function deriveProductionApiWsBase(): string {
    if (typeof window === 'undefined') return '';
    const host = window.location.hostname.toLowerCase();
    if (!host || host === 'localhost' || host === '127.0.0.1') return '';
    if (host.startsWith('api.')) {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${proto}//${host}`;
    }
    // Apex / app / www → api.<registrable>
    if (
        host === 'proxyhubb.com' ||
        host === 'www.proxyhubb.com' ||
        host === 'app.proxyhubb.com'
    ) {
        return 'wss://api.proxyhubb.com';
    }
    return '';
}

function getWsBaseFromEnv(): string {
    const explicitWs = toWsBase(process.env.NEXT_PUBLIC_WS_URL || '');
    if (explicitWs) return explicitWs;

    const apiAsWs = toWsBase(process.env.NEXT_PUBLIC_API_URL || '');
    if (apiAsWs) return apiAsWs;

    return deriveProductionApiWsBase();
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
 * Appends a short-lived single-use WS ticket (?ticket=). Preferred over
 * ?token= because the ticket keeps the JWT out of the URL (and server logs).
 */
export function withWsTicket(url: string, ticket: string): string {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}ticket=${encodeURIComponent(ticket)}`;
}

function ticketApiBase(): string {
    const fromEnv = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
    if (fromEnv) return fromEnv;
    // Same-origin /v1 rewrite works for HTTP ticket mint even when WS uses api.*
    return '';
}

/**
 * Use a short-lived single-use ticket. Failure keeps the connection closed.
 */
export async function resolveAuthedWsUrl(wsUrl: string, accessToken: string): Promise<string> {
    const apiBase = ticketApiBase();
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
        // Keep the connection closed until a ticket can be issued.
    }
    throw new Error("Realtime authentication unavailable. Try again shortly.");
}
