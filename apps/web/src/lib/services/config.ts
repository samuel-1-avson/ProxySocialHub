import { API_BASE_URL, fetchWithAuth } from './client';

export interface ServiceConfiguration {
    id: string;
    node_id: string;
    enable_http: boolean;
    enable_socks5: boolean;
    max_bandwidth_mbps: number;
    allowed_countries: string[];
    price_multiplier_http: number;
    dynamic_pricing_enabled: boolean;
    target_utilization: number;
    // others...
}

export interface SharedTemplate {
    id: string;
    user_id: string;
    name: string;
    description: string;
    price: number;
    downloads: number;
    rating: number;
    config_snapshot: string;
    created_at: string;
    author?: { display_name: string; username: string; avatar_url: string };
}

export async function getTemplates(): Promise<SharedTemplate[]> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/provider/services/templates/community`);
    if (!response.ok) throw new Error('Failed to fetch templates');
    const data = await response.json();
    return data.templates || [];
}

export async function shareTemplate(nodeId: string, name: string, description: string, price: number): Promise<SharedTemplate> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/provider/services/templates/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: nodeId, name, description, price }),
    });
    if (!response.ok) throw new Error('Failed to share template');
    return response.json();
}
