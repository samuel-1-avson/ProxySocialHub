export type ExplorerErrorKind =
    | 'not_found'
    | 'client'
    | 'server'
    | 'network'
    | 'unavailable'
    | 'decentralization';

export class ExplorerApiError extends Error {
    readonly kind: ExplorerErrorKind;
    readonly status?: number;
    readonly code?: string;

    constructor(kind: ExplorerErrorKind, message: string, status?: number, code?: string) {
        super(message);
        this.name = 'ExplorerApiError';
        this.kind = kind;
        this.status = status;
        this.code = code;
    }

    static async fromResponse(response: Response, fallback: string): Promise<ExplorerApiError> {
        let code = '';
        let message = '';

        try {
            const payload = await response.json();
            if (payload && typeof payload === 'object') {
                const rec = payload as Record<string, unknown>;
                code = String(rec.error || rec.code || '').trim();
                message = String(rec.message || rec.error || '').trim();
            }
        } catch {
            try {
                message = (await response.text()).trim();
            } catch {
                message = '';
            }
        }

        const kind = classifyExplorerError(response.status, code);
        const display =
            message && message !== code
                ? message
                : code
                  ? humanizeExplorerCode(code, fallback)
                  : `${fallback} (HTTP ${response.status})`;

        return new ExplorerApiError(kind, display, response.status, code || undefined);
    }
}

function classifyExplorerError(status: number, code: string): ExplorerErrorKind {
    const normalized = code.toLowerCase();
    if (status === 404 || normalized === 'not_found') return 'not_found';
    if (status === 503 && (normalized === 'metrics_unavailable' || normalized === 'explorer_unavailable')) {
        return 'unavailable';
    }
    if (status === 503 && normalized.includes('decentralization')) return 'decentralization';
    if (status >= 500) return 'server';
    if (status >= 400) return 'client';
    return 'server';
}

function humanizeExplorerCode(code: string, fallback: string): string {
    switch (code.toLowerCase()) {
        case 'not_found':
            return 'Not found';
        case 'metrics_unavailable':
            return 'Time-series metrics are not available yet';
        case 'explorer_unavailable':
            return 'Explorer is temporarily unavailable';
        default:
            return fallback;
    }
}

export function isExplorerNotFound(error: unknown): boolean {
    return error instanceof ExplorerApiError && error.kind === 'not_found';
}

export function isExplorerNetworkError(error: unknown): boolean {
    if (error instanceof ExplorerApiError) return error.kind === 'network';
    if (error instanceof TypeError) return true;
    return false;
}

export function toExplorerApiError(error: unknown, fallback: string): ExplorerApiError {
    if (error instanceof ExplorerApiError) return error;
    if (error instanceof Error) {
        const kind: ExplorerErrorKind =
            error.name === 'AbortError' ? 'network' : 'network';
        return new ExplorerApiError(kind, error.message || fallback);
    }
    return new ExplorerApiError('server', fallback);
}
