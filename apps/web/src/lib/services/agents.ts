import { API_BASE_URL, fetchWithAuth } from './client';

export interface MarketAgent {
    id: string;
    name: string;
    description: string;
    version: string;
    price_per_run: number;
    categories: string[];
    parameters: Record<string, any>;
}

export interface AgentInstance {
    id: string;
    user_id: string;
    market_agent_id: string;
    name: string;
    config: Record<string, any>;
    status: 'active' | 'paused';
    market_agent?: MarketAgent;
    last_run_at?: string;
    expires_at?: string;
}

export interface AgentJob {
    id: string;
    agent_instance_id: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    result: Record<string, any>;
    logs: string;
    duration_sec: number;
    cost: number;
    created_at: string;
}

export async function getMarketAgents(): Promise<MarketAgent[]> {
    const res = await fetchWithAuth(`${API_BASE_URL}/v1/agents`);
    if (!res.ok) throw new Error('Failed to fetch market agents');
    return res.json();
}

export async function getMyAgents(): Promise<AgentInstance[]> {
    const res = await fetchWithAuth(`${API_BASE_URL}/v1/agents/instances`);
    if (!res.ok) throw new Error('Failed to fetch my agents');
    return res.json();
}

export async function rentAgent(agentId: string, name: string, config: any): Promise<AgentInstance> {
    const res = await fetchWithAuth(`${API_BASE_URL}/v1/agents/rent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ market_agent_id: agentId, name, config }),
    });
    if (!res.ok) throw new Error('Failed to rent agent');
    return res.json();
}

export async function executeAgentJob(instanceId: string): Promise<{ message: string, job_id: string }> {
    const res = await fetchWithAuth(`${API_BASE_URL}/v1/agents/instances/${instanceId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error('Failed to execute agent job');
    return res.json();
}
