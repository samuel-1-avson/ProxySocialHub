import { API_BASE_URL, fetchWithAuth } from './client';

export interface UseCase {
    id: string;
    name: string;
    description: string;
}

export interface UserPreferences {
    preferred_use_case_id?: string;
    preferred_regions: string[];
    max_price_per_gb?: number;
    min_seller_rating?: number;
    prefer_verified_sellers: boolean;
    use_case?: UseCase;
}

export interface Recommendation {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listing: any;
    score: number;
    reasons: string[];
}

export async function getUseCases(): Promise<UseCase[]> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/matching/use-cases`);
    if (!response.ok) throw new Error('Failed to fetch use cases');
    const data = await response.json();
    return Array.isArray(data?.use_cases) ? data.use_cases : [];
}

export async function getPreferences(): Promise<UserPreferences | null> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/matching/preferences`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.preferences || null;
}

export async function updatePreferences(prefs: Partial<UserPreferences>): Promise<UserPreferences> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/matching/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
    });
    if (!response.ok) throw new Error('Failed to update preferences');
    return response.json();
}

export async function getRecommendations(useCaseId?: string, minScore?: number): Promise<{ recommendations: Recommendation[], preferences?: UserPreferences, use_case?: UseCase }> {
    let url = useCaseId
        ? `${API_BASE_URL}/v1/matching/recommend/${useCaseId}`
        : `${API_BASE_URL}/v1/matching/recommend`;

    if (minScore !== undefined) {
        url += `${url.includes('?') ? '&' : '?'}min_score=${minScore}`;
    }

    const response = await fetchWithAuth(url);
    if (!response.ok) throw new Error('Failed to fetch recommendations');
    return response.json();
}
