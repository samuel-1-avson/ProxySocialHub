import client from './client';

export interface Proposal {
    id: string;
    title: string;
    description: string;
    proposer: string;
    start_date: string;
    end_date: string;
    status: 'active' | 'closed' | 'pending';
    votes_for: number;
    votes_against: number;
    total_votes: number;
    user_vote?: 'for' | 'against';
}

export async function getProposals(): Promise<{ proposals: Proposal[] }> {
    // Mock data for now as backend might not have this yet
    // const res = await client.get('/governance/proposals');
    // return res.data;
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve({
                proposals: [
                    {
                        id: '1',
                        title: 'Proposal #1: Increase Proxy Bandwidth Limits',
                        description: 'This proposal aims to increase the default bandwidth limit for basic tier providers to 50GB/month to encourage more participation from home users.',
                        proposer: '0x123...abc',
                        start_date: new Date().toISOString(),
                        end_date: new Date(Date.now() + 86400000 * 3).toISOString(), // 3 days left
                        status: 'active',
                        votes_for: 1250,
                        votes_against: 450,
                        total_votes: 1700
                    },
                    {
                        id: '2',
                        title: 'Proposal #2: Add Support for Polygon',
                        description: 'Integrate Polygon network for lower gas fees on settlements.',
                        proposer: '0xabc...123',
                        start_date: new Date(Date.now() - 86400000 * 5).toISOString(),
                        end_date: new Date(Date.now() - 86400000 * 2).toISOString(),
                        status: 'closed',
                        votes_for: 3000,
                        votes_against: 100,
                        total_votes: 3100
                    }
                ]
            });
        }, 500);
    });
}

export async function voteProposal(proposalId: string, vote: 'for' | 'against'): Promise<{ status: string; message: string }> {
    // const res = await client.post(`/governance/proposals/${proposalId}/vote`, { vote });
    // return res.data;
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve({ status: 'success', message: 'Vote recorded' });
        }, 1000);
    });
}
