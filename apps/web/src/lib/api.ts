export * from './services/client';
// export * from './services/auth'; 
export * from './services/wallet';
export * from './services/market';
export * from './services/governance';
export * from './services/profile';
export * from './services/config';
export * from './services/social';
export * from './services/analytics';
export * from './services/agents';
export * from './services/usage';
export * from './services/referral';
export * from './services/matching';
export * from './services/subscriptions';
export * from './services/feed';

// Fallback for types that might still be used from "Order" which was just in api.ts
// I'll create `services/escrow.ts` for Orders to be comprehensive.
import { API_BASE_URL, fetchWithAuth } from './services/client';

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
  escrow_status?: string;
}

// createOrder moved to services/market.ts

export async function getMyOrders(): Promise<Order[]> {
  const response = await fetchWithAuth(`${API_BASE_URL}/v1/orders`);
  if (!response.ok) return [];
  const data = await response.json();
  return data.orders || [];
}
