import { apiRequest } from './api';
import { jwtExpMs, parseExpiresAtMs } from './reliability';

const SESSION_KEYS = [
  'accessToken',
  'refreshToken',
  'userEmail',
  'userLabel',
  'userId',
  'deviceId',
  'accessExpiresAtMs',
] as const;

export type DeviceSession = {
  token: string;
  refresh_token: string;
  device_id: string;
  access_token_expires_at?: string;
  user: { id: string; email: string; label?: string; role?: string };
};

export type Bootstrap = {
  user: { id: string; email: string; label: string; role: string };
  orders: Array<{
    id: string;
    status: string;
    listing_title: string;
    credentials_ready: boolean;
  }>;
  connect_ready: boolean;
  proxy: { endpoint: string; auth_for_endpoint: string; protocol: string };
  note?: string;
};

export async function getAccessToken(): Promise<string | null> {
  const stored = await chrome.storage.session.get('accessToken');
  return typeof stored.accessToken === 'string' && stored.accessToken ? stored.accessToken : null;
}

export async function getSignedInLabel(): Promise<string | null> {
  const stored = await chrome.storage.session.get(['userLabel', 'userEmail']);
  const label = typeof stored.userLabel === 'string' ? stored.userLabel : '';
  const email = typeof stored.userEmail === 'string' ? stored.userEmail : '';
  return label || email || null;
}

export async function saveSession(session: DeviceSession): Promise<void> {
  const accessExpiresAtMs =
    parseExpiresAtMs(session.access_token_expires_at) ?? jwtExpMs(session.token);
  await chrome.storage.session.set({
    accessToken: session.token,
    refreshToken: session.refresh_token,
    userEmail: session.user.email,
    userLabel: session.user.label || session.user.email,
    userId: session.user.id,
    deviceId: session.device_id,
    ...(typeof accessExpiresAtMs === 'number' ? { accessExpiresAtMs } : {}),
  });
}

/** Rotate the device JWT. Failure must not drop HMAC proxy secrets. */
export async function refreshDeviceSession(): Promise<boolean> {
  const stored = await chrome.storage.session.get('refreshToken');
  const refresh = typeof stored.refreshToken === 'string' ? stored.refreshToken : '';
  if (!refresh) {
    return false;
  }
  try {
    const session = await apiRequest<DeviceSession>(
      'POST',
      '/v1/extension/refresh',
      { refresh_token: refresh },
      { anonymous: true },
    );
    await saveSession(session);
    return true;
  } catch {
    return false;
  }
}

export async function clearSession(): Promise<void> {
  await chrome.storage.session.remove([...SESSION_KEYS]);
}

export async function pairFinish(code: string): Promise<DeviceSession> {
  const extensionId = chrome.runtime.id;
  const session = await apiRequest<DeviceSession>('POST', '/v1/extension/pair/finish', {
    code: code.trim(),
    extension_id: extensionId,
    name: 'Chrome',
  }, { anonymous: true });
  await saveSession(session);
  return session;
}

export async function loadBootstrap(): Promise<Bootstrap> {
  return apiRequest<Bootstrap>('GET', '/v1/extension/bootstrap');
}
