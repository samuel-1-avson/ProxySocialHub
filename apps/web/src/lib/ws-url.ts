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
