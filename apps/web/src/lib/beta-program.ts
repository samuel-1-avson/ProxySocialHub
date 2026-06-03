import { apiDelete, apiPost, authApiGet, publicApiGet } from './api/client';
import { getStoredAccessTokenSync } from './auth';

export interface BetaProgramTask {
    slug: string;
    week: number;
    title: string;
    description: string;
    reward_usdc: number;
    path?: string;
    external_url?: string;
    auto_detect?: string;
    completed: boolean;
    completed_at?: string;
    source?: string;
}

export interface BetaProgramResponse {
    program: {
        name: string;
        network: string;
        guide_path: string;
        discord_url: string;
    };
    tasks: BetaProgramTask[];
    stats: {
        total_tasks: number;
        completed_tasks: number;
        potential_usdc: number;
        earned_usdc: number;
        authenticated: boolean;
    };
}

export async function fetchBetaProgram(): Promise<BetaProgramResponse> {
    // Public catalog; optional JWT enriches completion progress (v1 optional-auth middleware).
    if (getStoredAccessTokenSync()) {
        return authApiGet<BetaProgramResponse>('/v1/beta-program');
    }
    return publicApiGet<BetaProgramResponse>('/v1/beta-program');
}

export async function completeBetaTask(slug: string): Promise<void> {
    await apiPost(`/v1/beta-program/tasks/${slug}/complete`, {});
}

export async function uncompleteBetaTask(slug: string): Promise<void> {
    await apiDelete(`/v1/beta-program/tasks/${slug}/complete`);
}

export async function syncBetaProgram(): Promise<{ synced: number }> {
    return apiPost<{ synced: number }>('/v1/beta-program/sync', {});
}
