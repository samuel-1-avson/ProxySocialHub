/**
 * Referral API Module
 * Tracking rewards and inviting new operators
 */

import { apiGet, apiPost } from './client';

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

/**
 * Get unified referral statistics for the operator
 */
export async function getReferralStats() {
    return apiGet<ReferralStats>('/v1/referral/stats');
}

/**
 * Generate a new unique referral code
 */
export async function generateReferralCode() {
    return apiPost<{ code: string }>('/v1/referral/code');
}

/**
 * List all earned referral rewards
 */
export async function getMyRewards() {
    const data = await apiGet<{ rewards: ReferralReward[] }>('/v1/referral/rewards');
    return data.rewards;
}
