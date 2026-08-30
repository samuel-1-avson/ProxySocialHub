/**
 * API Client Configuration
 * Centralized HTTP client with auth, error handling, and type safety
 */

import { fetchWithAuth, getAccessTokenSilently } from '../auth';

// Empty string = relative URL. All /v1/* requests are proxied server-side
// by Next.js rewrites (next.config.ts) to the internal backend. This prevents
// the browser from ever trying to resolve the Docker-internal hostname.
export const API_BASE_URL = '';

/**
 * Custom API error with status code and message
 */
export class ApiError extends Error {
    constructor(
        public status: number,
        message: string,
        public code?: string,
        public orderId?: string
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

/** Turn API error JSON into a user-visible message (spending limits include remaining SOL). */
function formatApiErrorMessage(error: Record<string, unknown>): string {
    const base =
        (typeof error.message === 'string' && error.message) ||
        (typeof error.error === 'string' && error.error) ||
        'Request failed';
    if (typeof error.detail === 'string' && error.detail.trim() && !base.includes(error.detail)) {
        return `${base}: ${error.detail}`;
    }
    if (error.limit_type != null && typeof error.remaining === 'number') {
        const window = String(error.limit_type);
        return `${base} — about ${error.remaining.toFixed(2)} SOL left on your ${window} limit`;
    }
    if (typeof error.reason === 'string' && error.reason.trim()) {
        return `${base} ${error.reason}`;
    }
    return base;
}

function throwApiError(response: Response, error: Record<string, unknown>): never {
    throw new ApiError(
        response.status,
        formatApiErrorMessage(error),
        typeof error.code === 'string' ? error.code : undefined,
        typeof error.order_id === 'string' ? error.order_id : undefined
    );
}

function buildUrl(endpoint: string, params?: Record<string, string>): string {
    let urlStr = endpoint;
    if (params) {
        const qs = Object.entries(params)
            .filter(([, value]) => value !== undefined && value !== null)
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join('&');
        if (qs) urlStr += (urlStr.includes('?') ? '&' : '?') + qs;
    }
    return urlStr;
}

async function readJsonOrThrow<T>(response: Response): Promise<T> {
    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Request failed' }));
        throwApiError(response, error as Record<string, unknown>);
    }

    return response.json();
}

async function readOptionalJsonOrThrow<T>(response: Response): Promise<T> {
    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Request failed' }));
        throwApiError(response, error as Record<string, unknown>);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : ({} as T);
}

export function publicApiFetch(endpoint: string, options: RequestInit = {}) {
    return fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        credentials: options.credentials ?? 'include',
    });
}

export function authApiFetch(endpoint: string, options: RequestInit = {}) {
    return fetchWithAuth(`${API_BASE_URL}${endpoint}`, options);
}

export async function publicApiGet<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const response = await publicApiFetch(buildUrl(endpoint, params));
    return readJsonOrThrow<T>(response);
}

/** GET that sends a token when present and retries without it on 401. */
export async function optionalAuthGet<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = buildUrl(endpoint, params);
    const token = await getAccessTokenSilently();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let response = await publicApiFetch(url, { headers });
    if (response.status === 401 && token) {
        response = await publicApiFetch(url);
    }
    return readJsonOrThrow<T>(response);
}

export async function publicApiPost<T, B = unknown>(endpoint: string, body?: B): Promise<T> {
    const response = await publicApiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    return readJsonOrThrow<T>(response);
}

export async function authApiGet<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const response = await authApiFetch(buildUrl(endpoint, params));
    return readJsonOrThrow<T>(response);
}

export async function authApiPost<T, B = unknown>(
    endpoint: string,
    body?: B,
    init?: RequestInit
): Promise<T> {
    const response = await authApiFetch(endpoint, {
        method: 'POST',
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    return readJsonOrThrow<T>(response);
}

export async function authApiPut<T, B = unknown>(endpoint: string, body?: B): Promise<T> {
    const response = await authApiFetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    return readJsonOrThrow<T>(response);
}

export async function authApiPatch<T, B = unknown>(endpoint: string, body?: B): Promise<T> {
    const response = await authApiFetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    return readJsonOrThrow<T>(response);
}

export async function authApiDelete<T = void>(endpoint: string): Promise<T> {
    const response = await authApiFetch(endpoint, { method: 'DELETE' });
    return readOptionalJsonOrThrow<T>(response);
}

export async function authApiDeleteWithBody<T = void, B = unknown>(endpoint: string, body?: B): Promise<T> {
    const response = await authApiFetch(endpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    return readOptionalJsonOrThrow<T>(response);
}

/**
 * Generic API response type
 */
export interface ApiResponse<T> {
    data: T;
    message?: string;
    meta?: {
        total?: number;
        page?: number;
        limit?: number;
    };
}

/**
 * Type-safe GET request
 */
export async function apiGet<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    return authApiGet<T>(endpoint, params);
}

/**
 * Type-safe POST request
 */
export async function apiPost<T, B = unknown>(
    endpoint: string,
    body?: B,
    init?: RequestInit
): Promise<T> {
    return authApiPost<T, B>(endpoint, body, init);
}

/**
 * Type-safe PUT request
 */
export async function apiPut<T, B = unknown>(endpoint: string, body?: B): Promise<T> {
    return authApiPut<T, B>(endpoint, body);
}

/**
 * Type-safe DELETE request
 */
export async function apiDelete<T = void>(endpoint: string): Promise<T> {
    return authApiDelete<T>(endpoint);
}

/**
 * Type-safe DELETE request with body
 */
export async function apiDeleteWithBody<T = void, B = unknown>(endpoint: string, body?: B): Promise<T> {
    return authApiDeleteWithBody<T, B>(endpoint, body);
}

/**
 * Type-safe PATCH request
 */
export async function apiPatch<T, B = unknown>(endpoint: string, body?: B): Promise<T> {
    return authApiPatch<T, B>(endpoint, body);
}
