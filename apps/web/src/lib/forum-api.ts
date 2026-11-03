// Forum API - Community forum functionality
import { authApiFetch, publicApiFetch } from "./api/client";

const API_BASE = ''; // relative — proxied by Next.js rewrite in next.config.ts

// ============== Types ==============

export interface ForumCategory {
    id: string;
    name: string;
    slug: string;
    description: string;
    is_locked: boolean;
    thread_count: number;
    created_at: string;
}

export interface ForumThread {
    id: string;
    category_id: string;
    author_id: string;
    title: string;
    slug: string;
    content: string;
    replies_count: number;
    views_count: number;
    upvotes: number;
    downvotes: number;
    is_pinned: boolean;
    is_locked: boolean;
    created_at: string;
    updated_at: string;
    category?: ForumCategory;
    author?: {
        id: string;
        username: string;
        display_name?: string;
        avatar_url?: string;
    };
}

export interface ForumPost {
    id: string;
    thread_id: string;
    author_id: string;
    content: string;
    parent_id?: string;
    upvotes: number;
    downvotes: number;
    is_solution: boolean;
    created_at: string;
    updated_at: string;
    author?: {
        id: string;
        username: string;
        display_name?: string;
        avatar_url?: string;
    };
    replies?: ForumPost[];
}

export interface CreateThreadRequest {
    category_slug: string;
    title: string;
    content: string;
}

export interface CreatePostRequest {
    content: string;
    parent_id?: string;
}

export interface VoteRequest {
    vote_type: "up" | "down";
}

// ============== Category API ==============

export async function getForumCategories(): Promise<{ categories: ForumCategory[] }> {
    const res = await publicApiFetch(`${API_BASE}/v1/forum/categories`);
    if (!res.ok) {
        if (res.status === 401 || res.status === 404) return { categories: [] };
        throw new Error("Failed to fetch forum categories");
    }
    return res.json();
}

export async function getCategory(slug: string): Promise<{ category: ForumCategory }> {
    const res = await publicApiFetch(`${API_BASE}/v1/forum/categories/${slug}`);
    if (!res.ok) throw new Error("Category not found");
    return res.json();
}

// ============== Thread API ==============

export async function getCategoryThreads(
    slug: string,
    params: { page?: number; limit?: number } = {}
): Promise<{ threads: ForumThread[]; total: number; page: number; limit: number }> {
    const query = new URLSearchParams();
    if (params.page) query.set("page", String(params.page));
    if (params.limit) query.set("limit", String(params.limit));

    const res = await publicApiFetch(`${API_BASE}/v1/forum/categories/${slug}/threads?${query}`);
    if (!res.ok) {
        if (res.status === 401 || res.status === 404) {
            return { threads: [], total: 0, page: params.page || 1, limit: params.limit || 20 };
        }
        throw new Error("Failed to fetch threads");
    }
    return res.json();
}

export interface ThreadResponse {
    thread: ForumThread;
    posts: ForumPost[];
    total_posts: number;
    page: number;
    limit: number;
    solution_post?: ForumPost | null;
}

export async function getThread(id: string): Promise<ThreadResponse> {
    const res = await publicApiFetch(`${API_BASE}/v1/forum/threads/${id}`);
    if (!res.ok) throw new Error(res.status === 404 ? "Discussion not found" : "Discussion service is unavailable. Try again in a moment.");
    return res.json();
}

export async function getThreadBySlug(slug: string): Promise<ThreadResponse> {
    const res = await publicApiFetch(`${API_BASE}/v1/forum/threads/slug/${slug}`);
    if (!res.ok) throw new Error(res.status === 404 ? "Discussion not found" : "Discussion service is unavailable. Try again in a moment.");
    return res.json();
}

export async function createThread(data: CreateThreadRequest): Promise<ForumThread> {
    const res = await authApiFetch(`${API_BASE}/v1/forum/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create thread");
    }
    return res.json();
}

// ============== Post API ==============

export async function getThreadPosts(
    threadId: string,
    params: { page?: number; limit?: number } = {}
): Promise<{ posts: ForumPost[]; total: number; page: number; limit: number }> {
    const query = new URLSearchParams();
    if (params.page) query.set("page", String(params.page));
    if (params.limit) query.set("limit", String(params.limit));

    const res = await publicApiFetch(`${API_BASE}/v1/forum/threads/${threadId}/posts?${query}`);
    if (!res.ok) throw new Error("Failed to fetch posts");
    return res.json();
}

export async function createPost(threadId: string, data: CreatePostRequest): Promise<ForumPost> {
    const res = await authApiFetch(`${API_BASE}/v1/forum/threads/${threadId}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create post");
    }
    return res.json();
}

export async function updatePost(postId: string, content: string): Promise<ForumPost> {
    const res = await authApiFetch(`${API_BASE}/v1/forum/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error("Failed to update post");
    return res.json();
}

export async function deletePost(postId: string): Promise<{ message: string }> {
    const res = await authApiFetch(`${API_BASE}/v1/forum/posts/${postId}`, {
        method: "DELETE",
    });
    if (!res.ok) throw new Error("Failed to delete post");
    return res.json();
}

// ============== Voting API ==============

export async function votePost(postId: string, voteType: "up" | "down"): Promise<{ upvotes: number; downvotes: number }> {
    const res = await authApiFetch(`${API_BASE}/v1/forum/posts/${postId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote_type: voteType === "up" ? 1 : -1 }),
    });
    if (!res.ok) throw new Error("Failed to vote");
    return res.json();
}

export async function voteThread(threadId: string, voteType: "up" | "down"): Promise<{ upvotes: number; downvotes: number }> {
    const res = await authApiFetch(`${API_BASE}/v1/forum/threads/${threadId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote_type: voteType === "up" ? 1 : -1 }),
    });
    if (!res.ok) throw new Error("Failed to vote");
    return res.json();
}

// ============== Search & Discovery ==============

export interface ThreadListPage {
    threads: ForumThread[];
    total: number;
    page: number;
    limit: number;
    has_more: boolean;
}

function emptyThreadPage(page: number, limit: number): ThreadListPage {
    return { threads: [], total: 0, page, limit, has_more: false };
}

export async function searchForum(query: string, page = 1): Promise<ThreadListPage> {
    const res = await publicApiFetch(`${API_BASE}/v1/forum/search?q=${encodeURIComponent(query)}&page=${page}`);
    if (!res.ok) {
        if (res.status === 401 || res.status === 404) return emptyThreadPage(page, 20);
        throw new Error("Search failed");
    }
    const data = await res.json();
    return {
        threads: data.threads ?? [],
        total: data.total ?? 0,
        page: data.page ?? page,
        limit: data.limit ?? 20,
        has_more: (data.page ?? page) * (data.limit ?? 20) < (data.total ?? 0),
    };
}

async function getThreadCollection(path: string, limit: number, page: number, label: string): Promise<ThreadListPage> {
    const res = await publicApiFetch(`${API_BASE}${path}?limit=${limit}&page=${page}`);
    if (!res.ok) {
        if (res.status === 401 || res.status === 404) return emptyThreadPage(page, limit);
        throw new Error("Failed to fetch " + label + " threads");
    }
    const data = await res.json();
    return {
        threads: data.threads ?? [],
        total: data.total ?? 0,
        page: data.page ?? page,
        limit: data.limit ?? limit,
        has_more: Boolean(data.has_more),
    };
}

export async function getRecentThreads(limit = 20, page = 1): Promise<ThreadListPage> {
    return getThreadCollection("/v1/forum/recent", limit, page, "recent");
}

export async function getPopularThreads(limit = 20, page = 1): Promise<ThreadListPage> {
    return getThreadCollection("/v1/forum/popular", limit, page, "popular");
}

export async function getUnansweredThreads(limit = 20, page = 1): Promise<ThreadListPage> {
    return getThreadCollection("/v1/forum/unanswered", limit, page, "unanswered");
}

// ============== User Threads ==============

export async function getMyThreads(params: { page?: number; limit?: number } = {}): Promise<{
    threads: ForumThread[];
    total: number;
    page: number;
    limit: number;
}> {
    const query = new URLSearchParams();
    if (params.page) query.set("page", String(params.page));
    if (params.limit) query.set("limit", String(params.limit));

    const res = await authApiFetch(`${API_BASE}/v1/forum/my-threads?${query}`);
    if (!res.ok) throw new Error("Failed to fetch my threads");
    return res.json();
}

export async function getMyPosts(params: { page?: number; limit?: number } = {}): Promise<{
    posts: ForumPost[];
    total: number;
    page: number;
    limit: number;
}> {
    const query = new URLSearchParams();
    if (params.page) query.set("page", String(params.page));
    if (params.limit) query.set("limit", String(params.limit));

    const res = await authApiFetch(`${API_BASE}/v1/forum/my-posts?${query}`);
    if (!res.ok) throw new Error("Failed to fetch my posts");
    return res.json();
}

// ============== Report API ==============

export async function reportThread(threadId: string, reason: string, details?: string): Promise<{ message: string }> {
    const res = await authApiFetch(`${API_BASE}/v1/forum/threads/${threadId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, details }),
    });
    if (!res.ok) throw new Error("Failed to submit report");
    return res.json();
}

export async function reportPost(postId: string, reason: string, details?: string): Promise<{ message: string }> {
    const res = await authApiFetch(`${API_BASE}/v1/forum/posts/${postId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, details }),
    });
    if (!res.ok) throw new Error("Failed to submit report");
    return res.json();
}

export async function markPostSolution(postId: string, isSolution = true): Promise<ForumPost> {
    const res = await authApiFetch(`${API_BASE}/v1/forum/posts/${postId}/solution`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_solution: isSolution }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update solution");
    }
    return res.json();
}
