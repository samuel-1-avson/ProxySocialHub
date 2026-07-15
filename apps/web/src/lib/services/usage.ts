import { API_BASE_URL, fetchWithAuth } from './client';

export interface UsageStats {
    session_id: string;
    bytes_used: number;
    bytes_limit: number;
    percent_used: number;
    gb_used: number;
    cost_sol: number;
}

export async function getSessionUsage(sessionId: string): Promise<UsageStats> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/usage/session/${sessionId}`);
    if (!response.ok) throw new Error('Failed to fetch usage');
    return response.json();
}

export async function getUserUsage(): Promise<{ total_bytes: number; total_gb: number; total_cost_sol: number; sessions: UsageStats[] }> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/usage/me`);
    if (!response.ok) throw new Error('Failed to fetch user usage');
    return response.json();
}

export async function signUsageClaim(buyerAddress: string): Promise<{ signature: string; buyer: string; provider: string; bytes_used: number; nonce: number; token_address: string }> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/usage/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyer_address: buyerAddress }),
    });
    if (!response.ok) throw new Error('Failed to sign usage claim');
    return response.json();
}
