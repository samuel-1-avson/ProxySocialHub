export const DEFAULT_BASE_URL = "https://api.proxyhubb.com";
export const DEFAULT_PROXY_ENDPOINT = "proxy.proxyhubb.com:8090";

export function defaultProxyEndpoint(): string;
export function proxyUrl(username: string, password: string, host?: string): string;
export function sessionIntentProxyUrl(token: string, host?: string): string;

export interface ClientOptions {
  apiKey?: string;
  /** Dashboard JWT or provider token (Bearer). */
  accessToken?: string;
  /** Alias of accessToken — provider tokens use the same Bearer header. */
  providerToken?: string;
  baseUrl?: string;
  proxyEndpoint?: string;
}

export interface PoolCreateOptions {
  size?: number;
  sessionType?: "rotating" | "sticky" | string;
  description?: string;
  bytesLimit?: number;
}

export interface SessionIntentOptions {
  listingId?: string;
  listing_id?: string;
  bandwidthLimit?: number;
  bandwidth_limit?: number;
  targetGeo?: string;
  target_geo?: string;
  targetIsp?: string;
  target_isp?: string;
  routingProfile?: string;
  routing_profile?: string;
  allowedDomains?: string[];
  allowed_domains?: string[];
  blockedDomains?: string[];
  blocked_domains?: string[];
  rotationType?: string;
  rotation_type?: string;
  rotationIntervalSeconds?: number;
  rotation_interval_seconds?: number;
  timeLimitMinutes?: number;
  time_limit_minutes?: number;
  preferredTier?: string;
  preferred_tier?: string;
  maxPricePerGb?: number;
  max_price_per_gb?: number;
}

export interface ProviderTokenCreateOptions {
  name?: string;
  expiresIn?: number;
  expires_in?: number;
  nodeId?: string;
  node_id?: string;
}

export interface ProviderNodeOptions {
  name?: string;
  ipAddress?: string;
  ip_address?: string;
  country?: string;
  city?: string;
  connectionType?: string;
  connection_type?: string;
}

export interface ListingCreateOptions {
  title?: string;
  description?: string;
  providerNodeId?: string;
  provider_node_id?: string;
  proxyType?: string;
  proxy_type?: string;
  protocol?: string;
  rotationType?: string;
  rotation_type?: string;
  country?: string;
  isp?: string;
  pricePerGb?: number;
  price_per_gb?: number;
  minPurchaseGb?: number;
  min_purchase_gb?: number;
  availableBandwidthGb?: number;
  available_bandwidth_gb?: number;
  maxConcurrency?: number;
  max_concurrency?: number;
  bulkDiscounts?: unknown[];
  bulk_discounts?: unknown[];
  listingOfferExpiresAt?: number;
  listing_offer_expires_at?: number;
  proof?: Record<string, unknown>;
}

export interface ListingUpdateOptions {
  title?: string;
  description?: string;
  pricePerGb?: number;
  price_per_gb?: number;
  minPurchaseGb?: number;
  min_purchase_gb?: number;
  availableBandwidthGb?: number;
  available_bandwidth_gb?: number;
  maxConcurrency?: number;
  max_concurrency?: number;
  bulkDiscounts?: unknown[];
  bulk_discounts?: unknown[];
  /** Pause or activate: "active" | "paused" */
  status?: "active" | "paused" | string;
  listingOfferExpiresAt?: number;
  listing_offer_expires_at?: number;
  proof?: Record<string, unknown>;
}

export interface PageOptions {
  page?: number;
  limit?: number;
}

export interface ProxyEndpoint {
  host: string;
  port: number;
  username: string;
  password: string;
  session_type: string;
}

export interface ProxyCredentials {
  username: string;
  password: string;
  /** Alias of HMAC password (same as password for public :8090). */
  legacy_password?: string;
  /** CONNECT auth for endpoint. Public :8090 is "hmac". */
  auth_for_endpoint?: "hmac" | "capability";
  host?: string;
  port?: number;
  protocol?: string;
  endpoint?: string;
}

export declare class ProxyHubClient {
  constructor(apiKey: string, baseUrl?: string);
  constructor(options: ClientOptions);

  readonly baseUrl: string;
  readonly proxyEndpoint: string;
  setAccessToken(token: string): void;
  setProviderToken(token: string): void;

  createSessionIntent(
    type?: "rotating" | "sticky" | string,
    options?: SessionIntentOptions
  ): Promise<Record<string, unknown>>;
  sessionIntentProxyUrl(token: string): string;

  getOrderCredentials(orderId: string): Promise<{
    proxy_credentials: ProxyCredentials;
    session_capability?: string;
    session_capability_note?: string;
  }>;
  proxyUrlFromCredentials(
    credentials: ProxyCredentials | { proxy_credentials: ProxyCredentials }
  ): string;
  createHttpsProxyAgent(proxyUrlString: string): unknown;

  createPool(name: string, options?: PoolCreateOptions): Promise<Record<string, unknown>>;
  listPools(): Promise<{ pools: unknown[]; total: number }>;
  getPool(poolId: string): Promise<{ pool_id: string; endpoints: ProxyEndpoint[]; count: number }>;
  getProxies(poolId: string): Promise<ProxyEndpoint[]>;
  revokePool(poolId: string): Promise<null>;
  proxyUrlForPool(poolId: string, index?: number): Promise<string>;

  // Provider tokens
  listProviderTokens(): Promise<Record<string, unknown>>;
  createProviderToken(options?: ProviderTokenCreateOptions): Promise<Record<string, unknown>>;
  rotateProviderToken(tokenId: string): Promise<Record<string, unknown>>;
  revokeProviderToken(tokenId: string): Promise<Record<string, unknown>>;

  // Provider nodes
  getProviderReadiness(): Promise<Record<string, unknown>>;
  listProviderNodes(): Promise<Record<string, unknown>>;
  createProviderNode(options: ProviderNodeOptions & { name: string }): Promise<Record<string, unknown>>;
  updateProviderNode(nodeId: string, options?: ProviderNodeOptions): Promise<Record<string, unknown>>;
  deleteProviderNode(nodeId: string): Promise<Record<string, unknown>>;
  getNodeConnect(nodeId: string): Promise<Record<string, unknown>>;

  // Listings (seller)
  listMyListings(options?: PageOptions): Promise<Record<string, unknown>>;
  getListing(listingId: string): Promise<Record<string, unknown>>;
  createListing(options: ListingCreateOptions): Promise<Record<string, unknown>>;
  updateListing(listingId: string, options?: ListingUpdateOptions): Promise<Record<string, unknown>>;
  deleteListing(listingId: string): Promise<Record<string, unknown>>;

  // Earnings
  getEarningsSummary(): Promise<Record<string, unknown>>;
  listEarnings(options?: PageOptions): Promise<Record<string, unknown>>;
  listEarningsHistory(): Promise<Record<string, unknown>>;

  // DePIN & P2P Direct Mesh
  createP2PSignalOffer(
    sessionId: string,
    buyerPubkey: string,
    providerHotkey: string,
    offerSdp: string,
    iceCandidates?: string[]
  ): Promise<Record<string, unknown>>;
  createP2PSignalAnswer(
    sessionId: string,
    providerHotkey: string,
    answerSdp: string,
    iceCandidates?: string[]
  ): Promise<Record<string, unknown>>;
  getP2PSignals(sessionId: string): Promise<{
    session_id: string;
    buyer_pubkey: string;
    provider_hotkey: string;
    offer_sdp?: string;
    answer_sdp?: string;
    buyer_ice?: string[];
    provider_ice?: string[];
    direct_available: boolean;
  }>;
  getGatewayOperators(): Promise<{ operators: unknown[]; bond_enforce: boolean }>;
  getDePINMiningStats(): Promise<Record<string, unknown>>;
}
