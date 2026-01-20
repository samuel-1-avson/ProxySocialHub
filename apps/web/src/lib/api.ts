import { fetchWithAuth } from './auth';
export { fetchWithAuth };

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export interface Session {
  id: string;
  type: 'rotating' | 'sticky';
  status: 'active' | 'terminated';
  credentials_user: string;
  credentials_pass: string;
  tx_hash?: string;
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
  tx_hash?: string;
  status?: string;
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
export async function createSession(type: 'rotating' | 'sticky', nodeId?: string): Promise<{ session: Session; proxy_credentials: { username: string; password: string; endpoint: string } }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/sessions/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, preferred_node_id: nodeId }),
  });
  if (!response.ok) throw new Error('Failed to create session');
  return response.json();
}

export async function getSessions(): Promise<Session[]> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/sessions/`);
  if (!response.ok) {
    console.error('getSessions failed:', response.status, response.statusText);
    throw new Error('Failed to fetch sessions');
  }
  const data = await response.json();
  console.log('getSessions API Response:', data);

  // Handle { sessions: [...] } wrapper
  if (data && Array.isArray(data.sessions)) {
    return data.sessions.map((item: { session: Session } | Session) => (item as { session: Session }).session || item);
  }
  // Handle direct array [...]
  if (Array.isArray(data)) {
    return data;
  }

  console.warn('getSessions received unexpected format:', data);
  return [];
}

export async function terminateSession(sessionId: string): Promise<void> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/sessions/${sessionId}/terminate`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to terminate session');
}

// Circles API

export interface Circle {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  visibility: 'public' | 'private';
  member_count: number;
  is_enterprise: boolean;
  bandwidth_pool_gb: number;
  price_per_gb: number;
  priority_level: number;
  created_at: string;
}


export interface CircleStats {
  circle_id: string;
  name: string;
  member_count: number;
  total_bytes_gb: number;
  total_revenue: number;
  avg_uptime: number;
  active_nodes: number;
  last_7_days_gb: number;
  last_30_days_gb: number;
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

export async function createCircle(name: string, description: string, visibility: string): Promise<Circle> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/circles/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, visibility }),
  });
  if (!response.ok) throw new Error('Failed to create circle');
  const data = await response.json();
  return data.circle;
}

export async function joinCircle(id: string, message?: string): Promise<void> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/circles/${id}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!response.ok) throw new Error('Failed to join circle');
}

export async function getCircleStats(id: string): Promise<CircleStats> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/circles/${id}/stats`);
  if (!response.ok) throw new Error('Failed to fetch stats');
  const data = await response.json();
  return data.stats;
}

export interface CircleMember {
  id: string;
  circle_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  status: 'active' | 'pending' | 'banned';
  joined_at: string;
  user?: {
    id: string;
    email: string;
  };
}

export async function getCircleMembers(id: string): Promise<{ circle_id: string; members: CircleMember[]; count: number }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/circles/${id}/members`);
  if (!response.ok) throw new Error('Failed to fetch members');
  return response.json();
}

export async function inviteToCircle(circleId: string, userId: string): Promise<{ message: string; invite_id: string }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/circles/${circleId}/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  });
  if (!response.ok) throw new Error('Failed to invite user');
  return response.json();
}

export async function leaveCircle(id: string): Promise<void> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/circles/${id}/members/me`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to leave circle');
}

export async function deleteCircle(id: string): Promise<void> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/circles/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete circle');
}

export async function updateCircle(id: string, data: { name: string; description: string; visibility: string }): Promise<Circle> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/circles/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to update circle');
  const result = await response.json();
  return result.circle;
}

export interface Friendship {
  id: string;
  user_id: string;
  friend_id: string;
  created_at: string;
  friend: {
    id: string;
    email: string;
    username?: string;
    display_name?: string;
    avatar_url?: string;
  };
}


// Wallet API (requires auth)
export async function getWallet(): Promise<Wallet> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/wallet/`);
  if (!response.ok) throw new Error('Failed to fetch wallet');
  const data = await response.json();
  return data.wallet;
}

export async function depositWallet(amount: number, email: string): Promise<{ status: string; reference: string; message: string; authorization_url: string }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/wallet/deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, email }),
  });
  if (!response.ok) throw new Error('Failed to initiate deposit');
  return response.json();
}

export async function withdrawWallet(amount: number, phone: string, network: string): Promise<{ status: string; reference: string; new_balance: number }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/wallet/withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, phone, network }),
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

export async function signUsageClaim(buyerAddress: string): Promise<{ signature: string; buyer: string; provider: string; bytes_used: number; nonce: number; token_address: string }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/usage/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buyer_address: buyerAddress }),
  });
  if (!response.ok) throw new Error('Failed to sign usage claim');
  return response.json();
}


// ========== Subscriptions ==========
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

export interface ReferralReward {
  id: string;
  referrer_id: string;
  referred_id: string;
  referral_code: string;
  reward_amount: number;
  reward_type: string;
  status: string;
  created_at: string;
  referred?: {
    email: string;
  };
}

export async function getMyRewards(): Promise<{ rewards: ReferralReward[] }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/referral/rewards`);
  if (!response.ok) throw new Error('Failed to fetch rewards');
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// Escrow API
export interface Order {
  id: string;
  buyer_id: string;
  seller_id: string;
  amount: number;
  status: string;
  tx_hash?: string;
  created_at: string;
  listing?: {
    title: string;
  };
  escrow_status?: string; // augmented from escrow endpoint
}

export interface EscrowTransaction {
  id: string;
  order_id: string;
  buyer_id: string;
  seller_id: string;
  amount: number;
  status: 'held' | 'released' | 'disputed' | 'refunded';
  held_at: string;
  released_at?: string;
  auto_release_at?: string;
}

export async function createOrder(listingId: string, bandwidthGb: number): Promise<Order> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listing_id: listingId, bandwidth_gb: bandwidthGb }),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to create order');
  }
  const data = await response.json();
  return data.order;
}

export async function getMyOrders(): Promise<Order[]> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/orders`);
  if (!response.ok) {
    console.error('Failed to fetch orders:', response.status);
    return [];
  }
  const data = await response.json();
  return data.orders || [];
}

export async function getEscrowStatus(orderId: string): Promise<EscrowTransaction> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/escrow/${orderId}`);
  if (!response.ok) throw new Error('Failed to fetch escrow status');
  return response.json();
}

export async function releaseEscrow(orderId: string): Promise<void> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/escrow/${orderId}/release`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to release escrow');
}

export async function createDispute(orderId: string, reason: string, description: string): Promise<void> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/escrow/${orderId}/dispute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_id: orderId, reason, description }),
  });
  if (!response.ok) throw new Error('Failed to create dispute');
}

// Provider Nodes API
export interface ProviderNode {
  id: string;
  name: string;
  ip_address: string;
  country: string;
  city: string;
  status: string;
  latency_ms?: number;
  uptime_percent?: number;
  quality_score: number;
  is_registered_on_chain: boolean;
  active_connections?: number;
}

export async function getProviderNodes(): Promise<{ nodes: ProviderNode[] }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/provider/nodes`);
  if (!response.ok) {
    console.error('getProviderNodes failed:', response.status);
    return { nodes: [] };
  }
  return response.json();
}


// Analytics API
export interface AnalyticsOverview {
  total_requests: number;
  total_bandwidth_gb: number;
  success_rate: number;
  avg_latency_ms: number;
  active_sessions: number;
  unique_destinations: number;
  top_country: string;
  top_isp: string;
}

export type DailyUsagePoint = {
  date: string;
  bytes_used: number;
  gb_used: number;
  cost_ghs: number;
};

export type HourlyUsagePoint = {
  hour: number;
  bytes_used: number;
  requests: number;
};

export type GeoStats = {
  country_code: string;
  country_name: string;
  request_count: number;
  bytes_used: number;
  success_rate: number;
};

export type DestinationStats = {
  domain: string;
  request_count: number;
  bytes_used: number;
  avg_latency_ms: number;
};


export async function getAnalyticsOverview(): Promise<AnalyticsOverview> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/analytics/overview`);
  if (!response.ok) throw new Error('Failed to fetch analytics overview');
  return response.json();
}

export async function getDailyUsage(days = 7): Promise<{ data: DailyUsagePoint[] }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/analytics/usage/daily?days=${days}`);
  if (!response.ok) throw new Error('Failed to fetch daily usage');
  return response.json();
}

export async function getHourlyUsage(): Promise<{ data: HourlyUsagePoint[] }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/analytics/usage/hourly`);
  if (!response.ok) throw new Error('Failed to fetch hourly usage');
  return response.json();
}

export async function getGeoAnalytics(): Promise<{ data: GeoStats[] }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/analytics/geo`);
  if (!response.ok) throw new Error('Failed to fetch geo stats');
  return response.json();
}

export async function getTopDestinations(): Promise<{ data: DestinationStats[] }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/analytics/top-destinations`);
  if (!response.ok) throw new Error('Failed to fetch top destinations');
  return response.json();
  return response.json();
}

// ==========================================
// Agents API
// ==========================================

export interface MarketAgent {
  id: string;
  name: string;
  description: string;
  version: string;
  price_per_run: number;
  categories: string[];
  parameters: Record<string, any>;
}

export interface AgentInstance {
  id: string;
  user_id: string;
  market_agent_id: string;
  name: string;
  config: Record<string, any>;
  status: 'active' | 'paused';
  market_agent?: MarketAgent;
  last_run_at?: string;
  expires_at?: string;
}

export interface AgentJob {
  id: string;
  agent_instance_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result: Record<string, any>;
  logs: string;
  duration_sec: number;
  cost: number;
  created_at: string;
}

export async function getMarketAgents(): Promise<MarketAgent[]> {
  const res = await fetchWithAuth(`${API_BASE_URL}/v1/agents`);
  if (!res.ok) throw new Error('Failed to fetch market agents');
  return res.json();
}

export async function getMyAgents(): Promise<AgentInstance[]> {
  const res = await fetchWithAuth(`${API_BASE_URL}/v1/agents/instances`);
  if (!res.ok) throw new Error('Failed to fetch my agents');
  return res.json();
}

export async function rentAgent(agentId: string, name: string, config: any): Promise<AgentInstance> {
  const res = await fetchWithAuth(`${API_BASE_URL}/v1/agents/rent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ market_agent_id: agentId, name, config }),
  });
  if (!res.ok) throw new Error('Failed to rent agent');
  return res.json();
}

export async function executeAgentJob(instanceId: string): Promise<{ message: string, job_id: string }> {
  const res = await fetchWithAuth(`${API_BASE_URL}/v1/agents/instances/${instanceId}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error('Failed to execute agent job');
  return res.json();
}

// ==========================================
// Social & Profile API
// ==========================================

export interface UserPublicProfile {
  id: string;
  username?: string;
  display_name?: string;
  bio?: string;
  avatar_url?: string;
  cover_image_url?: string;
  location?: string;
  website?: string;
  role: string;
  verified: boolean;
  followers_count: number;
  following_count: number;
  reviews_count: number;
  avg_rating: number;
  provider_since?: string;
  total_bandwidth_sold: number;
  created_at: string;
  is_following?: boolean;
}

export interface FeedEvent {
  id: string;
  actor_id?: string;
  event_type: string;
  target_type?: string;
  target_id?: string;
  content: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: any;
  created_at: string;
  actor?: {
    display_name?: string;
    username?: string;
    avatar_url?: string;
  };
}

export async function getMyProfile(): Promise<UserPublicProfile> {
  const res = await fetchWithAuth(`${API_BASE_URL}/v1/profile`);
  if (!res.ok) throw new Error('Failed to fetch profile');
  return res.json();
}

export async function getPublicProfile(idOrUsername: string): Promise<UserPublicProfile> {
  const res = await fetchWithAuth(`${API_BASE_URL}/v1/users/${idOrUsername}`);
  if (!res.ok) throw new Error('Failed to fetch user profile');
  return res.json();
}

export async function updateProfile(data: Partial<UserPublicProfile>): Promise<UserPublicProfile> {
  const res = await fetchWithAuth(`${API_BASE_URL}/v1/profile`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update profile');
  return res.json();
}

export async function followUser(userId: string): Promise<void> {
  const res = await fetchWithAuth(`${API_BASE_URL}/v1/users/${userId}/follow`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to follow user');
}

export async function unfollowUser(userId: string): Promise<void> {
  const res = await fetchWithAuth(`${API_BASE_URL}/v1/users/${userId}/follow`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to unfollow user');
}

export async function getFeed(params?: { event_types?: string[], page?: number, limit?: number }): Promise<FeedEvent[]> {
  const query = new URLSearchParams();
  if (params?.page) query.append('page', params.page.toString());
  if (params?.limit) query.append('limit', params.limit.toString());
  if (params?.event_types) params.event_types.forEach(t => query.append('event_types', t));

  const res = await fetchWithAuth(`${API_BASE_URL}/v1/feed?${query.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch feed');
  const data = await res.json();
  return data.events || [];
}

export async function createFeedPost(content: string): Promise<FeedEvent> {
  const res = await fetchWithAuth(`${API_BASE_URL}/v1/feed/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error('Failed to create post');
  return res.json();
}

// ==========================================
// Messaging API
// ==========================================

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  read_at?: string;
  created_at: string;
  sender?: {
    display_name?: string;
    username?: string;
    avatar_url?: string;
  };
}

export interface Conversation {
  id: string;
  participant1: string;
  participant2: string;
  last_message_at: string;
  user1?: {
    id: string;
    display_name?: string;
    username?: string;
    avatar_url?: string;
  };
  user2?: {
    id: string;
    display_name?: string;
    username?: string;
    avatar_url?: string;
  };
}

export interface ConversationWithPreview {
  conversation: Conversation;
  last_message?: Message;
  unread_count: number;
  other_participant?: {
    id: string;
    display_name?: string;
    username?: string;
    avatar_url?: string;
  };
}

export async function getConversations(): Promise<ConversationWithPreview[]> {
  const res = await fetchWithAuth(`${API_BASE_URL}/v1/conversations`);
  if (!res.ok) throw new Error('Failed to fetch conversations');
  const data = await res.json();
  return data.conversations || [];
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  const res = await fetchWithAuth(`${API_BASE_URL}/v1/conversations/${conversationId}/messages`);
  if (!res.ok) throw new Error('Failed to fetch messages');
  const data = await res.json();
  return data.messages || [];
}

export async function sendMessage(conversationId: string, content: string): Promise<Message> {
  const res = await fetchWithAuth(`${API_BASE_URL}/v1/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error('Failed to send message');
  return res.json();
}

export async function startConversation(recipientId: string, message?: string): Promise<Conversation> {
  const res = await fetchWithAuth(`${API_BASE_URL}/v1/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient_id: recipientId, message: message || 'Hello!' }),
  });
  if (!res.ok) throw new Error('Failed to start conversation');
  return res.json();
}

// ==========================================
// Friend API
// ==========================================

export interface FriendRequest {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  sender?: UserPublicProfile;
  receiver?: UserPublicProfile;
}

export async function getFriendRequests(type: 'incoming' | 'outgoing' = 'incoming'): Promise<FriendRequest[]> {
  const res = await fetchWithAuth(`${API_BASE_URL}/v1/friends/requests?type=${type}`);
  if (!res.ok) throw new Error('Failed to fetch friend requests');
  return res.json();
}

export async function sendFriendRequest(userId: string): Promise<void> {
  const res = await fetchWithAuth(`${API_BASE_URL}/v1/friends/request/${userId}`, {
    method: 'POST',
  });
  // 409 Conflict is expected if already pending/friends, we treat as success or specific error
  if (!res.ok && res.status !== 409) throw new Error('Failed to send friend request');
}

export async function acceptFriendRequest(requestId: string): Promise<void> {
  const res = await fetchWithAuth(`${API_BASE_URL}/v1/friends/request/${requestId}/accept`, {
    method: 'PUT',
  });
  if (!res.ok) throw new Error('Failed to accept friend request');
}

export async function rejectFriendRequest(requestId: string): Promise<void> {
  const res = await fetchWithAuth(`${API_BASE_URL}/v1/friends/request/${requestId}/reject`, {
    method: 'PUT',
  });
  if (!res.ok) throw new Error('Failed to reject friend request');
}


export async function listFriends(): Promise<Friendship[]> {
  const res = await fetchWithAuth(`${API_BASE_URL}/v1/friends`);
  if (!res.ok) throw new Error('Failed to fetch friends');
  return res.json();
}
