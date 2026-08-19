/** Pure scheduling / copy helpers. No chrome APIs — keep this testable in Node. */

export const KEEPALIVE_ALARM = 'phubb-keepalive';
export const EXPIRY_WARN_ALARM = 'phubb-expiry-warn';
export const EXPIRY_CLEAR_ALARM = 'phubb-expiry';

export const KEEPALIVE_PERIOD_MINUTES = 1;
export const EXPIRY_WARN_LEAD_MS = 5 * 60 * 1000;
export const ACCESS_REFRESH_LEAD_MS = 30 * 60 * 1000;

export type ConnectUiState = 'off' | 'on' | 'lost';
export type SwitchAction = 'on' | 'switch' | 'same';

export function parseExpiresAtMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1e12) {
      return value;
    }
    if (value > 1e9) {
      return value * 1000;
    }
    return undefined;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return undefined;
  }
  return ms;
}

export function sessionExpiresAtMs(envelope: {
  expires_at?: unknown;
  proxy_credentials?: { expires_at?: unknown };
}): number | undefined {
  return parseExpiresAtMs(envelope.expires_at) ?? parseExpiresAtMs(envelope.proxy_credentials?.expires_at);
}

/** chrome.alarms `when`. Null = skip (already expired or invalid). */
export function expiryAlarmWhen(
  expiresAtMs: number,
  nowMs = Date.now(),
  leadMs = EXPIRY_WARN_LEAD_MS,
): number | null {
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    return null;
  }
  const when = expiresAtMs - leadMs;
  if (when <= nowMs) {
    return nowMs + 1000;
  }
  return when;
}

export function shouldRefreshAccessToken(
  expiresAtMs: number | undefined,
  nowMs = Date.now(),
  leadMs = ACCESS_REFRESH_LEAD_MS,
): boolean {
  if (typeof expiresAtMs !== 'number' || !Number.isFinite(expiresAtMs)) {
    return false;
  }
  return expiresAtMs - nowMs <= leadMs;
}

export function minutesUntilExpiry(expiresAtMs: number, nowMs = Date.now()): number | null {
  if (!Number.isFinite(expiresAtMs)) {
    return null;
  }
  return Math.max(0, Math.round((expiresAtMs - nowMs) / 60_000));
}

export function expiryPopupCopy(
  expiresAtMs: number | undefined,
  nowMs = Date.now(),
  warnLeadMs = EXPIRY_WARN_LEAD_MS,
): string {
  if (typeof expiresAtMs !== 'number' || !Number.isFinite(expiresAtMs)) {
    return '';
  }
  if (expiresAtMs <= nowMs) {
    return 'Session expired. Turn on to reconnect.';
  }
  const mins = minutesUntilExpiry(expiresAtMs, nowMs) ?? 0;
  if (expiresAtMs - nowMs <= warnLeadMs) {
    return `Expires in about ${mins} min. Turn on again after it drops.`;
  }
  return `Session expires in about ${mins} min.`;
}

export const SESSION_EXPIRED_COPY = 'Session expired. Turn on to reconnect.';

export function jwtExpMs(token: string): number | undefined {
  const parts = token.split('.');
  if (parts.length < 2) {
    return undefined;
  }
  try {
    const payload = decodeBase64UrlJson(parts[1]) as { exp?: unknown };
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      return undefined;
    }
    return payload.exp * 1000;
  } catch {
    return undefined;
  }
}

function decodeBase64UrlJson(segment: string): unknown {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const json = atob(`${b64}${pad}`);
  return JSON.parse(json);
}

/**
 * One Chrome profile = one proxy. Switching is a new singleProxy + HMAC.
 * Lost on the same order is Turn on (reconnect), not "already on".
 */
export function switchAction(
  state: ConnectUiState,
  currentOrderId: string | undefined,
  selectedOrderId: string,
): SwitchAction {
  const selected = selectedOrderId.trim();
  if (!selected) {
    return 'on';
  }
  if (state === 'on' && currentOrderId && currentOrderId === selected) {
    return 'same';
  }
  if ((state === 'on' || state === 'lost') && currentOrderId && currentOrderId !== selected) {
    return 'switch';
  }
  return 'on';
}

export function switchButtonLabel(action: SwitchAction): string {
  if (action === 'switch') {
    return 'Switch';
  }
  if (action === 'same') {
    return 'On this order';
  }
  return 'Turn on';
}
