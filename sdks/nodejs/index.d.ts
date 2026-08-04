export const DEFAULT_BASE_URL = "https://api.proxyhubb.com";
export const DEFAULT_PROXY_ENDPOINT = "proxy.proxyhubb.com:8090";

export function defaultProxyEndpoint(): string;
export function proxyUrl(username: string, password: string, host?: string): string;
export function sessionIntentProxyUrl(token: string, host?: string): string;

export interface ClientOptions {
  apiKey?: string;
  accessToken?: string;
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
  host?: string;
  port?: number;
  protocol?: string;
  endpoint?: string;
}

export declare class ProxyHubClient {
  constructor(apiKey: string, baseUrl?: string);
  constructor(options: ClientOptions);

  readonly proxyEndpoint: string;
  setAccessToken(token: string): void;

  createSessionIntent(
    type?: "rotating" | "sticky" | string,
    options?: SessionIntentOptions
  ): Promise<Record<string, unknown>>;
  sessionIntentProxyUrl(token: string): string;

  getOrderCredentials(orderId: string): Promise<{ proxy_credentials: ProxyCredentials }>;
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
}
