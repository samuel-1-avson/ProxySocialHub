// Provider Showcase API - Portfolio and metrics
import { fetchWithAuth } from "./auth";

const API_BASE = ''; // relative — proxied by Next.js rewrite in next.config.ts

// ============== Types ==============

export interface ProviderShowcase {
    id: string;
    provider_id: string;
    title: string;
    description: string;
    type: "speed_test" | "testimonial" | "metric" | "media" | "network";
    media_urls: string[];
    thumbnail_url?: string;
    metrics: Record<string, number | string>;
    display_order: number;
    is_featured: boolean;
    is_public: boolean;
    created_at: string;
}

export interface SpeedTest {
    id: string;
    provider_id: string;
    download_speed: number; // Mbps
    upload_speed: number; // Mbps
    latency_ms: number;
    jitter_ms: number;
    packet_loss_percent: number;
    server_location: string;
    proxy_location: string;
    test_type: "automated" | "manual" | "customer";
    test_method: string;
    is_public: boolean;
    tested_at: string;
}

export interface Testimonial {
    id: string;
    provider_id: string;
    customer_id?: string;
    content: string;
    rating: number;
    is_verified: boolean;
    order_id?: string;
    is_approved: boolean;
    is_featured: boolean;
    created_at: string;
    customer?: {
        id: string;
        username: string;
        display_name?: string;
        avatar_url?: string;
    };
}

export interface ProviderStats {
    provider_id: string;
    avg_download_speed: number;
    avg_upload_speed: number;
    avg_latency_ms: number;
    uptime_percent: number;
    total_sessions: number;
    total_bandwidth_tb: number;
    active_customers: number;
    avg_rating: number;
    total_reviews: number;
    last_calculated_at: string;
}

// ============== Showcase Items ==============

export async function getProviderShowcases(providerId: string): Promise<{
    showcases: ProviderShowcase[];
}> {
    const res = await fetchWithAuth(`${API_BASE}/v1/showcases/providers/${providerId}`);
    if (!res.ok) {
        if (res.status === 404) return { showcases: [] };
        throw new Error("Failed to fetch showcases");
    }
    return res.json();
}

export async function createShowcase(data: {
    title: string;
    description: string;
    type: string;
    media_urls?: string[];
    metrics?: Record<string, number | string>;
    is_featured?: boolean;
}): Promise<ProviderShowcase> {
    const res = await fetchWithAuth(`${API_BASE}/v1/provider/showcase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create showcase");
    }
    return res.json();
}

export async function updateShowcase(
    showcaseId: string,
    data: Partial<ProviderShowcase>
): Promise<ProviderShowcase> {
    const res = await fetchWithAuth(`${API_BASE}/v1/provider/showcase/${showcaseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to update showcase");
    return res.json();
}

export async function deleteShowcase(showcaseId: string): Promise<{ message: string }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/provider/showcase/${showcaseId}`, {
        method: "DELETE",
    });
    if (!res.ok) throw new Error("Failed to delete showcase");
    return res.json();
}

// ============== Speed Tests ==============

export async function getProviderSpeedTests(providerId: string): Promise<{
    speed_tests: SpeedTest[];
}> {
    const res = await fetchWithAuth(`${API_BASE}/v1/showcases/providers/${providerId}/speed-tests`);
    if (!res.ok) {
        if (res.status === 404) return { speed_tests: [] };
        throw new Error("Failed to fetch speed tests");
    }
    return res.json();
}

export async function submitSpeedTest(data: {
    download_speed: number;
    upload_speed: number;
    latency_ms: number;
    server_location: string;
    proxy_location: string;
}): Promise<SpeedTest> {
    const res = await fetchWithAuth(`${API_BASE}/v1/provider/speed-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to submit speed test");
    }
    return res.json();
}

// ============== Testimonials ==============

export async function getProviderTestimonials(providerId: string): Promise<{
    testimonials: Testimonial[];
}> {
    const res = await fetchWithAuth(`${API_BASE}/v1/showcases/providers/${providerId}/testimonials`);
    if (!res.ok) {
        if (res.status === 404) return { testimonials: [] };
        throw new Error("Failed to fetch testimonials");
    }
    return res.json();
}

export async function submitTestimonial(data: {
    provider_id: string;
    content: string;
    rating: number;
    order_id?: string;
}): Promise<Testimonial> {
    const res = await fetchWithAuth(`${API_BASE}/v1/testimonials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to submit testimonial");
    }
    return res.json();
}

// ============== Provider Stats ==============

export async function getProviderStats(providerId: string): Promise<{
    stats: ProviderStats;
}> {
    const res = await fetchWithAuth(`${API_BASE}/v1/showcases/providers/${providerId}/stats`);
    if (!res.ok) throw new Error("Failed to fetch provider stats");
    return res.json();
}

// ============== My Showcase (Provider Only) ==============

export async function getMyShowcases(): Promise<{
    showcases: ProviderShowcase[];
}> {
    const res = await fetchWithAuth(`${API_BASE}/v1/provider/showcase`);
    if (!res.ok) {
        if (res.status === 404) return { showcases: [] };
        throw new Error("Failed to fetch my showcases");
    }
    return res.json();
}

export async function reorderShowcases(showcaseIds: string[]): Promise<{ message: string }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/provider/showcase/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showcase_ids: showcaseIds }),
    });
    if (!res.ok) throw new Error("Failed to reorder showcases");
    return res.json();
}
