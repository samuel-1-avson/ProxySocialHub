import { API_BASE_URL, fetchWithAuth } from './client';

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

export async function getOperationalMetrics(): Promise<OperationalMetrics> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/monitoring/operational`);
    if (!response.ok) {
        throw new Error('Failed to fetch operational metrics');
    }
    return response.json();
}
