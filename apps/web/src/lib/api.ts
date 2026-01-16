import { fetchWithAuth } from './auth';
export { fetchWithAuth };

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export interface Session {
  id: string;
  type: 'rotating' | 'sticky';
  status: 'active' | 'terminated';
  credentials_user: string;
  credentials_pass: string;
  created_at: string;
}

export interface Wallet {
  wallet_id: string;
  balance: number;
  currency: string;
  transactions: WalletTransaction[];
}

export interface WalletTransaction {
  id: string;
  amount: number;
  balance_after: number;
  type: string;
  description: string;
  created_at: string;
}

export interface UsageStats {
  session_id: string;
  bytes_used: number;
  bytes_limit: number;
  percent_used: number;
  gb_used: number;
  cost_ghs: number;
}

// Sessions API (requires auth)
export async function createSession(type: 'rotating' | 'sticky'): Promise<{ session: Session; proxy_credentials: { username: string; password: string; endpoint: string } }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/sessions/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type }),
  });
  if (!response.ok) throw new Error('Failed to create session');
  return response.json();
}

export async function getSessions(): Promise<Session[]> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/sessions/`);
  if (!response.ok) throw new Error('Failed to fetch sessions');
  return response.json();
}

export async function terminateSession(sessionId: string): Promise<void> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/sessions/${sessionId}/terminate`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to terminate session');
}

// Wallet API (requires auth)
export async function getWallet(): Promise<Wallet> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/wallet/`);
  if (!response.ok) throw new Error('Failed to fetch wallet');
  return response.json();
}

export async function depositWallet(amount: number, phone: string): Promise<{ status: string; reference: string; message: string }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/wallet/deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, phone }),
  });
  if (!response.ok) throw new Error('Failed to initiate deposit');
  return response.json();
}

export async function withdrawWallet(amount: number, phone: string): Promise<{ status: string; reference: string; new_balance: number }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/wallet/withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, phone }),
  });
  if (!response.ok) throw new Error('Failed to initiate withdrawal');
  return response.json();
}

// Usage API (requires auth)
export async function getSessionUsage(sessionId: string): Promise<UsageStats> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/usage/session/${sessionId}`);
  if (!response.ok) throw new Error('Failed to fetch usage');
  return response.json();
}

export async function getUserUsage(): Promise<{ total_bytes: number; total_gb: number; total_cost_ghs: number; sessions: UsageStats[] }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/usage/me`);
  if (!response.ok) throw new Error('Failed to fetch user usage');
  return response.json();
}

// Subscriptions API
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

// Referrals API
export interface ReferralStats {
  referral_code: string;
  total_referrals: number;
  total_earnings: number;
  pending_rewards: number;
  credited_rewards: number;
}

export async function getReferralStats(): Promise<ReferralStats> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/referral/stats`);
  if (!response.ok) throw new Error('Failed to fetch referral stats');
  return response.json();
}

export async function generateReferralCode(): Promise<{ code: string }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/referral/code`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to generate code');
  return response.json();
}

// Smart Matching API
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
  listing: any; // Using any for brevity, ideal to use ProxyListing interface if available
  score: number;
  reasons: string[];
}

export async function getUseCases(): Promise<UseCase[]> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/matching/use-cases`);
  if (!response.ok) throw new Error('Failed to fetch use cases');
  const data = await response.json();
  return data.use_cases;
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

export async function getRecommendations(useCaseId?: string): Promise<{ recommendations: Recommendation[], preferences?: UserPreferences, use_case?: UseCase }> {
  const url = useCaseId
    ? `${API_BASE_URL}/v1/matching/recommend/${useCaseId}`
    : `${API_BASE_URL}/v1/matching/recommend`;

  const response = await fetchWithAuth(url);
  if (!response.ok) throw new Error('Failed to fetch recommendations');
  return response.json();
}

// Forum API
export interface ForumCategory {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  thread_count?: number;
}

export interface ForumThread {
  id: string;
  title: string;
  slug: string;
  content: string;
  author: any;
  created_at: string;
  views_count: number;
  replies_count: number;
  last_reply_at?: string;
  is_pinned: boolean;
  is_locked: boolean;
}

export interface ForumPost {
  id: string;
  content: string;
  author: any;
  created_at: string;
  upvotes: number;
  downvotes: number;
  is_solution: boolean;
}

export async function getForumCategories(): Promise<{ categories: ForumCategory[] }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/forum/categories`);
  if (!response.ok) throw new Error('Failed to fetch categories');
  return response.json();
}

export async function getCategoryThreads(slug: string): Promise<{ category: ForumCategory, threads: ForumThread[] }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/forum/categories/${slug}`);
  if (!response.ok) throw new Error('Failed to fetch threads');
  return response.json();
}

export async function getThread(id: string): Promise<{ thread: ForumThread, posts: ForumPost[] }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/forum/threads/${id}`);
  if (!response.ok) throw new Error('Failed to fetch thread');
  return response.json();
}

export async function createThread(categorySlug: string, title: string, content: string): Promise<ForumThread> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/forum/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category_slug: categorySlug, title, content }),
  });
  if (!response.ok) throw new Error('Failed to create thread');
  return response.json();
}

export async function createPost(threadId: string, content: string): Promise<ForumPost> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/forum/threads/${threadId}/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) throw new Error('Failed to create post');
  return response.json();
}

export async function votePost(postId: string, voteType: 1 | -1): Promise<{ upvotes: number, downvotes: number }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/forum/posts/${postId}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vote_type: voteType }),
  });
  if (!response.ok) throw new Error('Failed to vote');
  return response.json();
}
