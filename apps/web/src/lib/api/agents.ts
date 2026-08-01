/**
 * AI Agents API Module
 * Renting and managing decentralized AI worker instances
 */

import { apiGet, apiPost, publicApiGet } from './client';

export interface MarketAgent {
    id: string;
    name: string;
    description: string;
    category: string;
    capabilities: string[];
    price_per_hour: number;
    /** Backend field — cost in credits/SOL per job when billing ships. */
    price_per_run?: number;
    hourly_rate?: number; // Legacy
    rating: number;
    author_id: string;
    created_at: string;
}

export interface AgentInstance {
    id: string;
    agent_id: string;
    user_id: string;
    status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped' | 'pending';
    created_at: string;
    completed_at?: string;
    agent?: MarketAgent;
    market_agent?: MarketAgent;
    expires_at?: string;
}

/**
 * List available agents in the marketplace
 */
export async function getMarketAgents() {
    const data = await publicApiGet<MarketAgent[]>('/v1/agents');
    return Array.isArray(data) ? data : (data as any).agents || [];
}

/**
 * List user's rented agent instances
 */
export async function getMyAgents() {
    const data = await apiGet<AgentInstance[]>('/v1/agents/instances');
    return Array.isArray(data) ? data : (data as any).instances || [];
}

/**
 * Rent a new agent instance
 */
export async function rentAgent(agentId: string) {
    return apiPost<AgentInstance>('/v1/agents/rent', { market_agent_id: agentId });
}

/**
 * Execute a job on an agent instance.
 * Backend queues the job then fails until Docker runtime is implemented — not for production UX.
 */
export async function executeAgentJob(instanceId: string, payload: any) {
    return apiPost<{ job_id: string }>(`/v1/agents/instances/${instanceId}/execute`, { payload });
}
