/**
 * API Client Configuration
 * Centralized HTTP client with auth, error handling, and type safety
 */

import { fetchWithAuth } from '../auth';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

/**
 * Custom API error with status code and message
 */
export class ApiError extends Error {
    constructor(
        public status: number,
        message: string,
        public code?: string
    ) {
        super(message);
        this.name = 'ApiError';
    }
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
    const url = new URL(`${API_BASE_URL}${endpoint}`);
    if (params) {
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                url.searchParams.append(key, value);
            }
        });
    }

    const response = await fetchWithAuth(url.toString());

    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Request failed' }));
        throw new ApiError(response.status, error.message || error.error || 'Request failed', error.code);
    }

    return response.json();
}

/**
 * Type-safe POST request
 */
export async function apiPost<T, B = unknown>(endpoint: string, body?: B): Promise<T> {
    const response = await fetchWithAuth(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Request failed' }));
        throw new ApiError(response.status, error.message || error.error || 'Request failed', error.code);
    }

    return response.json();
}

/**
 * Type-safe PUT request
 */
export async function apiPut<T, B = unknown>(endpoint: string, body?: B): Promise<T> {
    const response = await fetchWithAuth(`${API_BASE_URL}${endpoint}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Request failed' }));
        throw new ApiError(response.status, error.message || error.error || 'Request failed', error.code);
    }

    return response.json();
}

/**
 * Type-safe DELETE request
 */
export async function apiDelete<T = void>(endpoint: string): Promise<T> {
    const response = await fetchWithAuth(`${API_BASE_URL}${endpoint}`, {
        method: 'DELETE',
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Request failed' }));
        throw new ApiError(response.status, error.message || error.error || 'Request failed', error.code);
    }

    // Some delete endpoints return empty body
    const text = await response.text();
    return text ? JSON.parse(text) : ({} as T);
}

/**
 * Type-safe PATCH request
 */
export async function apiPatch<T, B = unknown>(endpoint: string, body?: B): Promise<T> {
    const response = await fetchWithAuth(`${API_BASE_URL}${endpoint}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Request failed' }));
        throw new ApiError(response.status, error.message || error.error || 'Request failed', error.code);
    }

    return response.json();
}
