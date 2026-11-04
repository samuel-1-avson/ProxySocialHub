// Forum API - Community forum functionality
import { authApiFetch, publicApiFetch } from "./api/client";
import { getAccessTokenSilently } from "./auth";

const API_BASE = ''; // relative — proxied by Next.js rewrite in next.config.ts

// Discussions work like a timeline: text is required, a title and a topic
// are optional. The server enforces the same limits (moderators may post
// longer announcements).
export const FORUM_POST_MAX = 500;
export const FORUM_TITLE_MAX = 200;
/** Posts without a chosen topic land here. */
export const FORUM_DEFAULT_TOPIC = "general";
/** "Ask a question" posts go to this topic, which shows them in the Questions tab. */
export const FORUM_QUESTION_TOPIC = "support";

/** Short name for a post: its title, or the start of its first line. */
export function forumPostLabel(thread: Pick<ForumThread, "title" | "content">, max = 80): string {
    const title = thread.title?.trim();
    if (title) return title;
    const line = (thread.content || "").trim().split(/\r?\n/)[0]?.trim() || "";
    const chars = Array.from(line);
    return chars.length > max ? chars.slice(0, max).join("") + "…" : line || "Post";
}

/** Characters as people count them (an emoji is one), matching the server. */
export function forumCharCount(text: string): number {
    return Array.from(text.trim()).length;
}

async function readError(res: Response, fallback: string): Promise<Error> {
    const body = await res.json().catch(() => ({}));
    return new Error((body && typeof body.error === "string" && body.error) || fallback);
}

/**
 * GET a public forum route as the signed-in viewer when there is one, so the
 * server can say which posts you liked. Falls back to an anonymous request
 * if the token is refused.
 */
async function viewerFetch(path: string): Promise<Response> {
    const token = await getAccessTokenSilently().catch(() => null);
    if (!token) return publicApiFetch(path);
    const res = await publicApiFetch(path, { headers: { Authorization: `Bearer ${token}` } });
    return res.status === 401 ? publicApiFetch(path) : res;
}

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
    is_hidden?: boolean;
    created_at: string;
    updated_at: string;
    /** Your own vote when signed in: 1 = liked. */
    viewer_vote?: number;
    /** A reply has been accepted as the answer. */
    has_solution?: boolean;
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
    is_hidden?: boolean;
    created_at: string;
    updated_at: string;
    /** Your own vote when signed in: 1 = liked. */
    viewer_vote?: number;
    author?: {
        id: string;
        username: string;
        display_name?: string;
        avatar_url?: string;
    };
    replies?: ForumPost[];
}

export interface CreateThreadRequest {
    /** Optional: posts without a topic go to General. */
    category_slug?: string;
    /** Optional headline shown above the text. */
    title?: string;
    content: string;
}

export interface VoteResult {
    upvotes: number;
    downvotes: number;
    /** Your vote after the toggle: 1, -1, or 0 when it was removed. */
    viewer_vote?: number;
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
): Promise<{ threads: ForumThread[]; total: number; page: number; limit: number; has_more?: boolean }> {
    const query = new URLSearchParams();
    if (params.page) query.set("page", String(params.page));
    if (params.limit) query.set("limit", String(params.limit));

    const res = await viewerFetch(`${API_BASE}/v1/forum/categories/${encodeURIComponent(slug)}/threads?${query}`);
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
    const res = await viewerFetch(`${API_BASE}/v1/forum/threads/${encodeURIComponent(id)}`);
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
    if (!res.ok) throw await readError(res, "Your post was not published");
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

    const res = await viewerFetch(`${API_BASE}/v1/forum/threads/${encodeURIComponent(threadId)}/posts?${query}`);
    if (!res.ok) throw new Error("Failed to fetch posts");
    return res.json();
}

export async function createPost(threadId: string, data: CreatePostRequest): Promise<ForumPost> {
    const res = await authApiFetch(`${API_BASE}/v1/forum/threads/${threadId}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw await readError(res, "Your reply was not posted");
    return res.json();
}

export async function updatePost(postId: string, content: string): Promise<ForumPost> {
    const res = await authApiFetch(`${API_BASE}/v1/forum/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
    });
    if (!res.ok) throw await readError(res, "Your reply was not updated");
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

export async function votePost(postId: string, voteType: "up" | "down"): Promise<VoteResult> {
    const res = await authApiFetch(`${API_BASE}/v1/forum/posts/${postId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote_type: voteType === "up" ? 1 : -1 }),
    });
    if (!res.ok) throw await readError(res, "Your like was not saved");
    return res.json();
}

export async function voteThread(threadId: string, voteType: "up" | "down"): Promise<VoteResult> {
    const res = await authApiFetch(`${API_BASE}/v1/forum/threads/${threadId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote_type: voteType === "up" ? 1 : -1 }),
    });
    if (!res.ok) throw await readError(res, "Your like was not saved");
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
    const res = await viewerFetch(`${API_BASE}/v1/forum/search?q=${encodeURIComponent(query)}&page=${page}`);
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
    const res = await viewerFetch(`${API_BASE}${path}?limit=${limit}&page=${page}`);
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

/** Questions tab: posts asked with "Ask a question". */
export async function getQuestionThreads(limit = 20, page = 1): Promise<ThreadListPage> {
    const data = await getCategoryThreads(FORUM_QUESTION_TOPIC, { limit, page });
    return {
        threads: data.threads ?? [],
        total: data.total ?? 0,
        page: data.page ?? page,
        limit: data.limit ?? limit,
        has_more: data.has_more ?? (data.page ?? page) * (data.limit ?? limit) < (data.total ?? 0),
    };
}

/** Following tab: posts from people you follow. Needs a session. */
export async function getFollowingThreads(limit = 20, page = 1): Promise<ThreadListPage> {
    const res = await authApiFetch(`${API_BASE}/v1/forum/following?limit=${limit}&page=${page}`);
    if (!res.ok) throw await readError(res, "Posts from people you follow could not be loaded");
    const data = await res.json();
    return {
        threads: data.threads ?? [],
        total: data.total ?? 0,
        page: data.page ?? page,
        limit: data.limit ?? limit,
        has_more: Boolean(data.has_more),
    };
}

/** Your posts: the posts you started, newest first. */
export async function getMyThreadPage(limit = 20, page = 1): Promise<ThreadListPage> {
    const data = await getMyThreads({ limit, page });
    return {
        threads: data.threads ?? [],
        total: data.total ?? 0,
        page: data.page ?? page,
        limit: data.limit ?? limit,
        has_more: (data.page ?? page) * (data.limit ?? limit) < (data.total ?? 0),
    };
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
