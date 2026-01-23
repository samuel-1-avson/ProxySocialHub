import { API_BASE_URL, fetchWithAuth } from './client';

// Circles
export interface Circle {
    id: string;
    name: string;
    description: string;
    visibility: 'public' | 'private';
    member_count: number;
}

export async function getCircles(): Promise<Circle[]> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/circles/`);
    if (!response.ok) throw new Error('Failed to fetch circles');
    const data = await response.json();
    return data.circles;
}

export async function getCircle(id: string): Promise<Circle> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/circles/${id}`);
    if (!response.ok) throw new Error('Failed to fetch circle');
    const data = await response.json();
    return data.circle;
}

// Forum
export interface ForumThread {
    id: string;
    title: string;
    content: string;
    created_at: string;
    author: any;
}

export async function getForumCategories(): Promise<any> {
    const response = await fetchWithAuth(`${API_BASE_URL}/v1/forum/categories`);
    if (!response.ok) throw new Error('Failed to fetch categories');
    return response.json();
}
