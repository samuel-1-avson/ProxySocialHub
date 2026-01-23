import { API_BASE_URL, fetchWithAuth } from './client';

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

export async function getSubscriptionPlans(): Promise<SubscriptionPlan[]> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/subscriptions/plans`);
    if (!response.ok) throw new Error('Failed to fetch plans');
    const data = await response.json();
    return data.plans;
}

export async function getMySubscription(): Promise<UserSubscription | null> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/subscriptions/my`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.subscription || null;
}

export async function subscribeToPlan(planId: string): Promise<UserSubscription> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/subscriptions/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: planId }),
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to subscribe');
    }
    return response.json();
}

export async function cancelSubscription(): Promise<void> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/subscriptions/cancel`, {
        method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to cancel subscription');
}
