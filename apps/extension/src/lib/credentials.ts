import { apiRequest } from './api';
import type { CredentialsEnvelope, HmacConnectTarget } from './hmac';
import { hmacConnectTarget } from './hmac';
import { sessionExpiresAtMs } from './reliability';

export type ConnectTarget = HmacConnectTarget & { expiresAtMs?: number };

export async function fetchHmacConnectTarget(orderId: string): Promise<ConnectTarget> {
  const envelope = await apiRequest<CredentialsEnvelope>('GET', `/v1/orders/${orderId}/credentials`);
  return { ...hmacConnectTarget(envelope), expiresAtMs: sessionExpiresAtMs(envelope) };
}
