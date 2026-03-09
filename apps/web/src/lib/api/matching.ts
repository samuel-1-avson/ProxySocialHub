/**
 * Matching & Smart Connect API Module
 * Intelligent node discovery and recommendations
 */

import { apiGet, apiPost } from './client';
import { Listing } from './marketplace';

export interface UseCase {
    id: string;
    name: string;
    description: string;
}

export interface Recommendation {
    listing: Listing;
    score: number;
    reasons: string[];
}

/**
 * List supported AI/Proxy use cases
 */
export async function getUseCases() {
    const data = await apiGet<{ use_cases: UseCase[] }>('/v1/matching/use-cases');
    return data.use_cases || [];
}

/**
 * Get intelligent node recommendations for a vector
 */
export async function getRecommendations(useCaseId: string, minScore = 0) {
    return apiGet<{ recommendations: Recommendation[] }>('/v1/matching/recommend', {
        use_case: useCaseId,
        min_score: minScore.toString()
    });
}

// ── Phase 7: Smart Match ──────────────────────────────────────────────────────

export interface SmartMatchRequest {
    use_case?: string;
    preferred_geo?: string;
    preferred_isp?: string;
    max_price_per_gb?: number;
    min_uptime_percent?: number;
    max_latency_ms?: number;
    session_type?: string;  // 'rotating' | 'sticky'
    required_tier?: string; // 'basic' | 'verified' | 'premium' | 'enterprise'
    bandwidth_gb?: number;
}

export interface SmartMatchResult {
    listing_id: string;
    seller_id: string;
    title: string;
    price_per_gb: number;
    match_score: number;
    provider_tier: string;
    uptime_percent: number;
    avg_latency_ms: number;
    country: string;
    isp: string;
    session_type: string;
}

export interface SmartMatchResponse {
    match_request_id: string;
    recommended: SmartMatchResult[];
    count: number;
    explanation: string;
}

/**
 * POST /v1/smart-match — AI-powered provider selection
 * Returns scored, ranked providers matching the caller's requirements.
 */
export async function smartMatch(req: SmartMatchRequest): Promise<SmartMatchResponse> {
    return apiPost<SmartMatchResponse, SmartMatchRequest>('/v1/smart-match', req);
}
