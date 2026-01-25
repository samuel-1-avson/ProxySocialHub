/**
 * Analytics API Module
 * Performance tracking, usage charts and geographic telemetry
 */

import { apiGet } from './client';

export interface AnalyticsOverview {
    total_requests: number;
    total_bandwidth_gb: number;
    success_rate: number;
    avg_latency_ms: number;
    active_sessions: number;
    unique_destinations: number;
    top_country: string;
    top_isp: string;
}

export interface DailyUsagePoint {
    date: string;
    bytes_used: number;
    gb_used: number;
    cost_ghs: number;
}

export interface HourlyUsagePoint {
    hour: number;
    bytes_used: number;
    requests: number;
}

export interface GeoStats {
    country_code: string;
    country_name: string;
    request_count: number;
    bytes_used: number;
    success_rate: number;
    country_flag?: any;
}

export interface DestinationStats {
    domain: string;
    request_count: number;
    bytes_used: number;
    avg_latency_ms: number;
}

export interface ZKPerformanceMetrics {
    total_proofs: number;
    avg_aggregation_time_ms: number;
    max_aggregation_time_ms: number;
    throughput_cps: number;
    compression_ratio: number;
    last_updated: string;
}

export type LatencyDistribution = Record<string, number>;

/**
 * Get high-level performance analytics for the user
 */
export async function getAnalyticsOverview() {
    return apiGet<AnalyticsOverview>('/v1/analytics/overview');
}

/**
 * Get historical daily usage for charts
 */
export async function getDailyUsage(days = 7) {
    return apiGet<{ data: DailyUsagePoint[] }>(`/v1/analytics/usage/daily?days=${days}`);
}

/**
 * Get hourly distribution for the current day
 */
export async function getHourlyUsage() {
    return apiGet<{ data: HourlyUsagePoint[] }>('/v1/analytics/usage/hourly');
}

/**
 * Get geographic traffic distribution
 */
export async function getGeoAnalytics() {
    return apiGet<{ data: GeoStats[] }>('/v1/analytics/geo');
}

/**
 * Get top destination domains
 */
export async function getTopDestinations() {
    return apiGet<{ data: DestinationStats[] }>('/v1/analytics/top-destinations');
}

/**
 * Get industrial performance benchmarks for ZK-Compression
 */
export async function getZKPerformanceBenchmarks() {
    return apiGet<{ metrics: ZKPerformanceMetrics; distribution: LatencyDistribution }>('/v1/analytics/performance/benchmarks');
}
