import { API_BASE_URL, fetchWithAuth } from './client';

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
    actions?: any[]; // For future detailed actions
}

export interface Vote {
    id: string;
    proposal_id: string;
    voter_id: string;
    choice: 'yes' | 'no' | 'abstain';
    voting_power: number;
    signature?: string;
}

export async function getProposals(status?: string): Promise<Proposal[]> {
    const url = status ? `${API_BASE_URL}/v1/governance/proposals?status=${status}` : `${API_BASE_URL}/v1/governance/proposals`;
    const response = await fetchWithAuth(url);
    if (!response.ok) throw new Error('Failed to fetch proposals');
    const data = await response.json();
    return data.proposals || [];
}

export async function getProposal(id: string): Promise<Proposal> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/governance/proposals/${id}`);
    if (!response.ok) throw new Error('Failed to fetch proposal');
    return response.json();
}

export async function createProposal(title: string, description: string, type: string, executionData: object): Promise<Proposal> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/governance/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, type, execution_data: executionData }),
    });
    if (!response.ok) throw new Error('Failed to create proposal');
    return response.json();
}

export async function castVote(proposalId: string, choice: 'yes' | 'no' | 'abstain', signature: string, walletAddress: string): Promise<Vote> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/governance/proposals/${proposalId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice, signature, wallet_address: walletAddress }),
    });
    if (!response.ok) throw new Error('Failed to cast vote');
    return response.json();
}
