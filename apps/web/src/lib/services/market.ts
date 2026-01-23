import { API_BASE_URL, fetchWithAuth } from './client';

export interface Session {
    id: string;
    type: 'rotating' | 'sticky';
    status: 'active' | 'terminated';
    credentials_user: string;
    credentials_pass: string;
    created_at: string;
}

export async function createSession(type: 'rotating' | 'sticky', nodeId?: string): Promise<{ session: Session; proxy_credentials: { username: string; password: string; endpoint: string } }> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/sessions/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, preferred_node_id: nodeId }),
    });
    if (!response.ok) throw new Error('Failed to create session');
    return response.json();
}

export async function getSessions(): Promise<Session[]> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/sessions/`);
    if (!response.ok) throw new Error('Failed to fetch sessions');
    const data = await response.json();
    if (data && Array.isArray(data.sessions)) {
        return data.sessions.map((item: any) => item.session || item);
    }
    return [];
}

export async function terminateSession(sessionId: string): Promise<void> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/sessions/${sessionId}/terminate`, {
        method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to terminate session');
}

export interface ProviderNode {
    id: string;
    name: string;
    ip_address: string;
    country: string;
    city: string;
    status: string;
    quality_score: number;
}

export async function getProviderNodes(): Promise<{ nodes: ProviderNode[] }> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/provider/nodes`);
    if (!response.ok) return { nodes: [] };
    return response.json();
}
