/**
 * Subscriptions API Module
 * Managing recurring plans and member access levels
 */

import { apiDeleteWithBody, apiGet, apiPost } from './client';

export interface SubscriptionPlan {
    id: string;
    name: string;
    price_monthly: number;
    features: string[];
    listing_limit: number;
    bandwidth_limit_gb: number;
}

export interface UserSubscription {
    id: string;
    plan_id: string;
    status: string;
    current_period_end: string;
    plan: SubscriptionPlan;
}

/**
 * List all available membership plans
 */
export async function getSubscriptionPlans() {
    const data = await apiGet<{ plans: SubscriptionPlan[] }>('/v1/subscriptions/plans');
    return data.plans;
}

/**
 * Get active subscription for the authenticated user
 */
export async function getMySubscription() {
    const data = await apiGet<{ subscription: UserSubscription }>('/v1/subscriptions/my');
    return data.subscription || null;
}

/**
 * Subscribe the user to a specific plan
 */
export async function subscribeToPlan(planId: string, billingCycle: 'monthly' | 'yearly' = 'monthly') {
    const data = await apiPost<{ subscription: UserSubscription; message: string }>(
        '/v1/subscriptions',
        { plan_id: planId, billing_cycle: billingCycle }
    );
    return data.subscription;
}

/**
 * Cancel the current active subscription
 */
export async function cancelSubscription(reason?: string) {
    return apiDeleteWithBody<{ message: string; access_until?: string }, { reason?: string }>(
        '/v1/subscriptions',
        reason ? { reason } : undefined
    );
}
