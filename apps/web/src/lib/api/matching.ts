/**
 * Matching & Smart Connect API Module
 * Intelligent node discovery and recommendations
 */

import { apiGet } from './client';
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
    return apiGet<UseCase[]>('/v1/matching/use-cases');
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
