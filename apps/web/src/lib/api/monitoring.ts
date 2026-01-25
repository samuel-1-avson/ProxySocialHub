/**
 * Monitoring API Module
 * Operational metrics and system health tracking
 */

import { apiGet } from './client';

export interface AlertEvent {
    type: string;
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    message: string;
    resource: string;
    timestamp: string;
}

export interface OperationalMetrics {
    nats: {
        stream_name: string;
        message_count: number;
        byte_count: number;
        consumer_count: number;
    };
    treasury: {
        sol_balance: number;
        network: string;
    };
    watchtower: {
        is_paused: boolean;
    };
    timestamp: string;
}

/**
 * Get system-wide operational metrics (Admin/Observer only)
 */
export async function getOperationalMetrics() {
    return apiGet<OperationalMetrics>('/v1/monitoring/operational');
}

/**
 * Get historical Watchtower alerts
 */
export async function getWatchtowerAlerts() {
    return apiGet<AlertEvent[]>('/v1/monitoring/alerts');
}
