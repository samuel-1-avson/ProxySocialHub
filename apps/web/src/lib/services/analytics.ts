import { API_BASE_URL, fetchWithAuth } from './client';

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

export type DailyUsagePoint = {
    date: string;
    bytes_used: number;
    gb_used: number;
    cost_ghs: number;
};

export type HourlyUsagePoint = {
    hour: number;
    bytes_used: number;
    requests: number;
};

export type GeoStats = {
    country_code: string;
    country_name: string;
    request_count: number;
    bytes_used: number;
    success_rate: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    country_flag?: any;
};

export type DestinationStats = {
    domain: string;
    request_count: number;
    bytes_used: number;
    avg_latency_ms: number;
};

export async function getAnalyticsOverview(): Promise<AnalyticsOverview> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/analytics/overview`);
    if (!response.ok) throw new Error('Failed to fetch analytics overview');
    return response.json();
}

export async function getDailyUsage(days = 7): Promise<{ data: DailyUsagePoint[] }> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/analytics/usage/daily?days=${days}`);
    if (!response.ok) throw new Error('Failed to fetch daily usage');
    return response.json();
}

export async function getHourlyUsage(): Promise<{ data: HourlyUsagePoint[] }> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/analytics/usage/hourly`);
    if (!response.ok) throw new Error('Failed to fetch hourly usage');
    return response.json();
}

export async function getGeoAnalytics(): Promise<{ data: GeoStats[] }> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/analytics/geo`);
    if (!response.ok) throw new Error('Failed to fetch geo stats');
    return response.json();
}

export async function getTopDestinations(): Promise<{ data: DestinationStats[] }> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/analytics/top-destinations`);
    if (!response.ok) throw new Error('Failed to fetch top destinations');
    return response.json();
}
