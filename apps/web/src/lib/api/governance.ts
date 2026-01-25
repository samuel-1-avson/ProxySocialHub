/**
 * Governance API Module
 * Proposal creation, voting and DAO parameters
 */

import { apiGet, apiPost } from './client';

export interface Proposal {
    id: string;
    title: string;
    description: string;
    proposer_id: string;
    type: string;
    status: 'active' | 'passed' | 'rejected' | 'executed' | 'failed';
    start_time: string;
    end_time: string;
    execution_data?: string;
    votes_for: number;
    votes_against: number;
    votes_abstain: number;
    total_votes: number;
    actions?: any[];
}

export interface Vote {
    id: string;
    proposal_id: string;
    voter_id: string;
    choice: 'yes' | 'no' | 'abstain';
    voting_power: number;
    signature?: string;
}

/**
 * List governance proposals with optional status filter
 */
export async function getProposals(status?: string) {
    const params = status ? { status } : undefined;
    const data = await apiGet<{ proposals: Proposal[] }>('/v1/governance/proposals', params);
    return data.proposals || [];
}

/**
 * Fetch detailed data for a specific proposal
 */
export async function getProposal(id: string) {
    return apiGet<Proposal>(`/v1/governance/proposals/${id}`);
}

/**
 * Create a new governance proposal
 */
export async function createProposal(title: string, description: string, type: string, executionData: object) {
    return apiPost<Proposal>('/v1/governance/proposals', { title, description, type, execution_data: executionData });
}

/**
 * Cast a vote on an active proposal
 */
export async function castVote(proposalId: string, choice: 'yes' | 'no' | 'abstain', signature: string, walletAddress: string) {
    return apiPost<Vote>(`/v1/governance/proposals/${proposalId}/vote`, { choice, signature, wallet_address: walletAddress });
}
