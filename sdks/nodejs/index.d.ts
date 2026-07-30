export interface PoolCreateOptions {
  size?: number;
  sessionType?: "rotating" | "sticky" | string;
  description?: string;
  bytesLimit?: number;
}

export interface ProxyEndpoint {
  host: string;
  port: number;
  username: string;
  password: string;
  session_type: string;
}

export declare class ProxyHubClient {
  constructor(apiKey: string, baseUrl?: string);
  createPool(name: string, options?: PoolCreateOptions): Promise<Record<string, unknown>>;
  listPools(): Promise<{ pools: unknown[]; total: number }>;
  getPool(poolId: string): Promise<{ pool_id: string; endpoints: ProxyEndpoint[]; count: number }>;
  getProxies(poolId: string): Promise<ProxyEndpoint[]>;
  revokePool(poolId: string): Promise<null>;
}
