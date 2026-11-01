/**
 * Usage & Analytics API Module
 * Tracking bandwidth and session consumption metrics
 */

import { apiGet } from './client';

export interface UsageMetric {
    date: string;
    bandwidth_gb: number;
    cost_sol: number;
    sessions_count: number;
}

/**
 * Get daily bandwidth consumption for the user (Account level)
 */
export async function getAccountDailyUsage() {
    return apiGet<UsageMetric[]>('/v1/analytics/usage/daily');
}

/**
 * Get aggregate usage metrics for a specific user
 */
export async function getUserUsage() {
    return apiGet<{
        total_bandwidth?: number;
        total_sessions?: number;
        total_bytes?: number;
        total_gb?: number;
        total_cost_sol?: number;
        sessions?: import("./sessions").Session[];
    }>('/v1/usage/me');
}

/**
 * Get real-time usage for a specific session
 */
export async function getSessionUsage(sessionId: string) {
    return apiGet<{
        current_bandwidth: number;
        elapsed_time: number;
        bytes_used?: number;
        bytes_limit?: number;
        percent_used?: number;
        gb_used?: number;
        cost_sol?: number;
    }>(`/v1/usage/session/${sessionId}`);
}
