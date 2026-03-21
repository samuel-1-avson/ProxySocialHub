/**
 * Milestones API Module
 * User bandwidth milestones and rewards management
 */

import { apiGet, apiPost } from './client';

// ============ Types ============

export interface Milestone {
    id: string;
    user_id: string;
    provider_id?: string;
    milestone_type: string;
    threshold_gb: number;
    badge_name: string;
    reward_amount: number;
    claimed: boolean;
    claimed_at?: string;
    achieved_at: string;
    // Provider info when milestone was with a specific provider
    provider?: {
        id: string;
        username: string;
        display_name: string;
        avatar_url?: string;
    };
}

export interface NextMilestone {
    type: string;
    threshold_gb: number;
    current_gb: number;
    progress_percent: number;
    badge_name: string;
    reward_amount: number;
}

export interface MilestoneStats {
    total_milestones: number;
    total_rewards_claimed: number;
    total_rewards_pending: number;
    current_tier: string;
    next_tier?: string;
    progress_to_next: number;
}

export interface ClaimRewardResponse {
    milestone_id: string;
    reward_amount: number;
    new_balance: number;
    message: string;
}

// ============ API Functions ============

/**
 * Get all milestones for the current user
 */
export async function getMyMilestones(): Promise<Milestone[]> {
    const data = await apiGet<{ milestones: Milestone[] }>('/v1/milestones');
    return data.milestones || [];
}

/**
 * Get next milestone target and progress
 */
export async function getNextMilestone(): Promise<NextMilestone | null> {
    try {
        return await apiGet<NextMilestone>('/v1/milestones/next');
    } catch {
        return null;
    }
}

/**
 * Claim reward for an unclaimed milestone
 */
export async function claimMilestoneReward(milestoneId: string): Promise<ClaimRewardResponse> {
    return apiPost<ClaimRewardResponse>(`/v1/milestones/${milestoneId}/claim`, {});
}

/**
 * Get milestones for a specific user (public profile)
 */
export async function getUserMilestones(userId: string): Promise<Milestone[]> {
    const data = await apiGet<{ milestones: Milestone[] }>(`/v1/users/${userId}/milestones`);
    return data.milestones || [];
}

/**
 * Get milestone statistics for current user
 */
export async function getMilestoneStats(): Promise<MilestoneStats> {
    const data = await apiGet<{ stats: MilestoneStats }>('/v1/milestones/stats');
    return data.stats;
}

/**
 * Check for newly achieved milestones (call after session ends)
 */
export async function checkNewMilestones(): Promise<{ new_milestones: Milestone[] }> {
    return apiGet<{ new_milestones: Milestone[] }>('/v1/milestones/check');
}

// ============ Query Keys for React Query ============

export const milestoneKeys = {
    all: ['milestones'] as const,
    lists: () => [...milestoneKeys.all, 'list'] as const,
    details: () => [...milestoneKeys.all, 'detail'] as const,
    next: () => [...milestoneKeys.all, 'next'] as const,
    stats: () => [...milestoneKeys.all, 'stats'] as const,
    user: (userId: string) => [...milestoneKeys.all, 'user', userId] as const,
};

// ============ Milestone Type Helpers ============

export const MILESTONE_TYPES = {
    FIRST_STEPS: 'first_steps',
    POWER_USER: 'power_user',
    BANDWIDTH_CHAMPION: 'bandwidth_champion',
    HEAVY_HITTER: 'heavy_hitter',
    TB_CLUB: 'tb_club',
} as const;

export const MILESTONE_THRESHOLDS = [1, 10, 100, 500, 1000] as const;

export function getMilestoneIcon(type: string): string {
    const icons: Record<string, string> = {
        [MILESTONE_TYPES.FIRST_STEPS]: '🌱',
        [MILESTONE_TYPES.POWER_USER]: '⚡',
        [MILESTONE_TYPES.BANDWIDTH_CHAMPION]: '🏆',
        [MILESTONE_TYPES.HEAVY_HITTER]: '🔨',
        [MILESTONE_TYPES.TB_CLUB]: '👑',
    };
    return icons[type] || '🎯';
}

export function getMilestoneColor(type: string): string {
    const colors: Record<string, string> = {
        [MILESTONE_TYPES.FIRST_STEPS]: 'text-emerald-400',
        [MILESTONE_TYPES.POWER_USER]: 'text-yellow-400',
        [MILESTONE_TYPES.BANDWIDTH_CHAMPION]: 'text-orange-400',
        [MILESTONE_TYPES.HEAVY_HITTER]: 'text-purple-400',
        [MILESTONE_TYPES.TB_CLUB]: 'text-amber-400',
    };
    return colors[type] || 'text-blue-400';
}
