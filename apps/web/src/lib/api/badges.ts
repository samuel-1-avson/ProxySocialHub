import { apiGet, publicApiGet } from './client';

export interface Badge {
    id: string;
    name: string;
    description: string;
    icon: string;
    criteria?: Record<string, unknown>;
}

export interface UserBadge {
    user_id: string;
    badge_id: string;
    earned_at: string;
    badge?: Badge;
}

export function getAllBadges() {
    return apiGet<{ badges: Badge[] }>('/v1/badges');
}

export function getMyBadges() {
    return apiGet<{ badges: UserBadge[] }>('/v1/badges/my');
}

export function getUserBadges(userId: string) {
    return publicApiGet<{ badges: UserBadge[] }>(`/v1/users/${encodeURIComponent(userId)}/badges`);
}

export const badgeKeys = {
    all: ['badges'] as const,
    mine: ['badges', 'my'] as const,
    user: (id: string) => ['badges', 'user', id] as const,
};
