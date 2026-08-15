import { apiGet, apiPost, apiPut } from './client';

export type OnboardingIntent = 'buyer' | 'provider' | 'both';

export type OnboardingStep =
  | 'intent'
  | 'wallet'
  | 'kyc'
  | 'apply'
  | 'token'
  | 'node'
  | 'online'
  | 'profile'
  | 'fund'
  | 'browse'
  | 'session';

export type KycStatus = 'none' | 'not_started' | 'pending' | 'approved' | 'rejected' | 'insufficient_funds';

export interface OnboardingStepMeta {
  completed_at?: string;
  meta?: Record<string, unknown>;
}

export interface OnboardingState {
  user_id: string;
  intent?: OnboardingIntent | null;
  current_step: OnboardingStep | string;
  steps: Record<string, OnboardingStepMeta>;
  step_catalog: string[];
  completed_at?: string | null;
  dismissed_at?: string | null;
  needs_onboarding: boolean;
  kyc_status: KycStatus;
  role: string;
  wallet_address?: string | null;
  updated_at: string;
}

export interface PutOnboardingBody {
  intent?: OnboardingIntent;
  current_step?: OnboardingStep | string;
  complete_step?: OnboardingStep | string;
  step_meta?: Record<string, unknown>;
  dismiss?: boolean;
  resume?: boolean;
  complete?: boolean;
}

export type OnboardingEventName =
  | 'onboarding_started'
  | 'intent_selected'
  | 'wallet_confirmed'
  | 'kyc_viewed'
  | 'kyc_status_changed'
  | 'provider_apply_submitted'
  | 'provider_apply_result'
  | 'token_created'
  | 'node_registered'
  | 'node_online'
  | 'buyer_marketplace_opened'
  | 'onboarding_completed'
  | 'onboarding_dismissed'
  | 'onboarding_resumed'
  | 'onboarding_banner_shown'
  | 'onboarding_nudge_clicked'
  | 'step_completed'
  | 'step_viewed';

export async function getOnboardingState(): Promise<OnboardingState> {
  return apiGet<OnboardingState>('/v1/onboarding');
}

export async function updateOnboarding(body: PutOnboardingBody): Promise<OnboardingState> {
  return apiPut<OnboardingState, PutOnboardingBody>('/v1/onboarding', body);
}

export async function postOnboardingEvent(
  eventName: OnboardingEventName,
  surface = 'onboarding',
  meta?: Record<string, string | number | boolean>,
): Promise<void> {
  await apiPost<{ ok: boolean }>('/v1/onboarding/events', {
    event_name: eventName,
    surface,
    meta,
  });
}
