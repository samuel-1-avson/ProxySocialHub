/**
 * Circles API Module
 * All circle-related API calls and types
 */

import { apiGet, apiPost, apiPut, apiDelete } from './client';

// ============ Types ============

export interface Circle {
    id: string;
    name: string;
    description: string;
    owner_id: string;
    visibility: 'public' | 'private';
    member_count: number;
    is_enterprise: boolean;
    bandwidth_pool_gb: number;
    price_per_gb: number;
    priority_level: number;
    avatar_url?: string;
    created_at: string;
}

export interface CircleMember {
    id: string;
    circle_id: string;
    user_id: string;
    role: 'owner' | 'admin' | 'member';
    status: 'active' | 'pending' | 'banned';
    joined_at: string;
    user?: {
        id: string;
        email: string;
        username?: string;
        display_name?: string;
        avatar_url?: string;
    };
}

export interface CircleStats {
    circle_id: string;
    name: string;
    member_count: number;
    total_bytes_gb: number;
    total_revenue: number;
    avg_uptime: number;
    active_nodes: number;
    last_7_days_gb: number;
    last_30_days_gb: number;
}

export interface CreateCircleRequest {
    name: string;
    description: string;
    visibility: 'public' | 'private';
}

export interface UpdateCircleRequest {
    name?: string;
    description?: string;
    visibility?: 'public' | 'private';
}

// ============ API Functions ============

/**
 * Get all circles
 */
export function getCircles() {
    return apiGet<Circle[]>('/v1/circles');
}

/**
 * Get a specific circle
 */
export function getCircle(id: string) {
    return apiGet<Circle>(`/v1/circles/${id}`);
}

/**
 * Create a new circle
 */
export function createCircle(data: CreateCircleRequest) {
    return apiPost<Circle>('/v1/circles', data);
}

/**
 * Update a circle
 */
export function updateCircle(id: string, data: UpdateCircleRequest) {
    return apiPut<Circle>(`/v1/circles/${id}`, data);
}

/**
 * Delete a circle
 */
export function deleteCircle(id: string) {
    return apiDelete(`/v1/circles/${id}`);
}

/**
 * Join a circle
 */
export function joinCircle(id: string, message?: string) {
    return apiPost<{ message: string }>(`/v1/circles/${id}/join`, { message });
}

/**
 * Leave a circle
 */
export function leaveCircle(id: string) {
    return apiDelete<{ message: string }>(`/v1/circles/${id}/members/me`);
}

/**
 * Get circle members
 */
export function getCircleMembers(id: string) {
    return apiGet<{ circle_id: string; members: CircleMember[]; count: number }>(
        `/v1/circles/${id}/members`
    );
}

/**
 * Invite user to circle
 */
export function inviteToCircle(circleId: string, userId: string) {
    return apiPost<{ message: string; invite_id: string }>(
        `/v1/circles/${circleId}/invite`,
        { user_id: userId }
    );
}

/**
 * Get circle stats
 */
export function getCircleStats(id: string) {
    return apiGet<CircleStats>(`/v1/circles/${id}/stats`);
}

// ============ Query Keys ============

export const circleKeys = {
    all: ['circles'] as const,
    lists: () => [...circleKeys.all, 'list'] as const,
    detail: (id: string) => [...circleKeys.all, 'detail', id] as const,
    members: (id: string) => [...circleKeys.all, 'members', id] as const,
    stats: (id: string) => [...circleKeys.all, 'stats', id] as const,
};
