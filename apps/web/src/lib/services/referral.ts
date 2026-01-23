import { API_BASE_URL, fetchWithAuth } from './client';

export interface ReferralStats {
    referral_code: string;
    total_referrals: number;
    total_earnings: number;
    pending_rewards: number;
    credited_rewards: number;
}

export interface ReferralReward {
    id: string;
    referrer_id: string;
    referred_id: string;
    referral_code: string;
    reward_amount: number;
    reward_type: string;
    status: string;
    created_at: string;
    referred?: {
        email: string;
    };
}

export async function getReferralStats(): Promise<ReferralStats> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/referral/stats`);
    if (!response.ok) throw new Error('Failed to fetch referral stats');
    return response.json();
}

export async function generateReferralCode(): Promise<{ code: string }> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/referral/code`, {
        method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to generate code');
    return response.json();
}

export async function getMyRewards(): Promise<{ rewards: ReferralReward[] }> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/referral/rewards`);
    if (!response.ok) throw new Error('Failed to fetch rewards');
    return response.json();
}
