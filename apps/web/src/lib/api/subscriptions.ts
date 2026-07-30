/**
 * Subscriptions API Module
 * Managing recurring plans and member access levels
 */

import { apiDeleteWithBody, apiGet, apiPost, apiPut } from './client';

export interface SubscriptionPlanFeatures {
    api_access?: boolean;
    analytics?: boolean;
    custom_pricing?: boolean;
    team_members?: number;
    dedicated_support?: boolean;
}

export interface SubscriptionPlan {
    id: string;
    name: string;
    description?: string;
    price_monthly: number;
    price_yearly?: number;
    features: SubscriptionPlanFeatures | string[];
    listing_limit: number;
    bandwidth_limit_gb: number | null;
    priority_support?: boolean;
    is_active?: boolean;
}

export interface UserSubscription {
    id: string;
    plan_id: string;
    status: string;
    billing_cycle?: string;
    current_period_start?: string;
    current_period_end: string | null;
    cancelled_at?: string | null;
    plan?: SubscriptionPlan;
}

export interface MySubscriptionResponse {
    subscription: UserSubscription | null;
    current_plan: SubscriptionPlan | null;
}

/**
 * List all available membership plans
 */
export async function getSubscriptionPlans() {
    const data = await apiGet<{ plans: SubscriptionPlan[] }>('/v1/subscriptions/plans');
    return data.plans;
}

/**
 * Get active subscription + entitled plan for the authenticated user
 */
export async function getMySubscription(): Promise<MySubscriptionResponse> {
    const data = await apiGet<MySubscriptionResponse>('/v1/subscriptions/my');
    return {
        subscription: data.subscription || null,
        current_plan: data.current_plan || null,
    };
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
 * Change plan with prorated charge/credit
 */
export async function changePlan(newPlanId: string) {
    return apiPut<{
        message: string;
        new_plan: SubscriptionPlan;
        prorated_charge: number;
        remaining_days: number;
    }>('/v1/subscriptions', { new_plan_id: newPlanId });
}

/**
 * Cancel the current active subscription (access until period end; stops auto-renew)
 */
export async function cancelSubscription(reason?: string) {
    return apiDeleteWithBody<{ message: string; access_until?: string }, { reason?: string }>(
        '/v1/subscriptions',
        reason ? { reason } : undefined
    );
}
