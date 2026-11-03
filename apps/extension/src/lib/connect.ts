import { clearReliabilityAlarms, scheduleReliabilityAlarms } from './alarms';
import { refreshDeviceSession } from './auth';
import {
  egressIsLocalHairpin,
  egressLooksProxied,
  egressProbeSucceeded,
  VERIFY_PROTOCOL,
  type VerifySnapshot,
} from './egress';
import { fetchHmacConnectTarget } from './credentials';
import { getProxyControlLevel, setDirectProxy, setHmacHttpProxy, wipeProxySecrets } from './proxy';
import {
  EXPIRY_CLEAR_ALARM,
  EXPIRY_WARN_ALARM,
  KEEPALIVE_ALARM,
  SESSION_EXPIRED_COPY,
  expiryPopupCopy,
  jwtExpMs,
  shouldRefreshAccessToken,
} from './reliability';
import { probeEgressIp } from './tab-probe';

export type { VerifySnapshot };

export type ConnectStatus = {
  state: 'off' | 'on' | 'lost';
  orderId?: string;
  listingTitle?: string;
  endpoint?: string;
  verify?: VerifySnapshot;
  sessionExpiresAt?: number;
  expiryMessage?: string;
};

const STATUS_KEYS = [
  'connectionState',
  'connectedOrderId',
  'connectedTitle',
  'proxyHost',
  'proxyPort',
  'sessionExpiresAt',
  'expiryMessage',
] as const;

export async function readConnectStatus(): Promise<ConnectStatus> {
  const stored = await chrome.storage.session.get([...STATUS_KEYS, 'verifyResult', 'baselineIp']);
  const state = stored.connectionState === 'on' || stored.connectionState === 'lost' ? stored.connectionState : 'off';
  const verify = isVerifySnapshot(stored.verifyResult) ? stored.verifyResult : undefined;
  const sessionExpiresAt =
    typeof stored.sessionExpiresAt === 'number' && stored.sessionExpiresAt > 1e9
      ? stored.sessionExpiresAt
      : undefined;
  const storedMessage = typeof stored.expiryMessage === 'string' ? stored.expiryMessage : '';
  const liveCopy = expiryPopupCopy(sessionExpiresAt);
  const expiryMessage =
    storedMessage === SESSION_EXPIRED_COPY || liveCopy === SESSION_EXPIRED_COPY
      ? SESSION_EXPIRED_COPY
      : liveCopy || storedMessage;
  return {
    state,
    orderId: typeof stored.connectedOrderId === 'string' ? stored.connectedOrderId : undefined,
    listingTitle: typeof stored.connectedTitle === 'string' ? stored.connectedTitle : undefined,
    endpoint:
      typeof stored.proxyHost === 'string' && typeof stored.proxyPort === 'number'
        ? `${stored.proxyHost}:${stored.proxyPort}`
        : undefined,
    verify,
    sessionExpiresAt,
    expiryMessage,
  };
}

export async function connectOrder(orderId: string, listingTitle = ''): Promise<ConnectStatus> {
  const target = await fetchHmacConnectTarget(orderId);
  const baselineIp = await captureBaselineIp();
  const sessionExpiresAt = target.expiresAtMs;
  await chrome.storage.session.set({
    proxyUser: target.username,
    proxyPass: target.password,
    proxyHost: target.host,
    proxyPort: target.port,
    proxyProtocol: target.protocol,
    connectedOrderId: orderId,
    connectedTitle: listingTitle,
    connectionState: 'on',
    expiryMessage: '',
    ...(typeof sessionExpiresAt === 'number' ? { sessionExpiresAt } : {}),
  });
  if (typeof sessionExpiresAt !== 'number') {
    await chrome.storage.session.remove('sessionExpiresAt');
  }
  try {
    await setHmacHttpProxy(target.host, target.port, target.protocol);
  } catch (err) {
    await rollbackProxy();
    throw err;
  }
  await settleProxy();
  const probe = await probeEgressIp();
  if (!egressProbeSucceeded(probe.ip ?? undefined)) {
    const error = verifyFailureMessage(baselineIp, probe);
    await saveVerify({
      healthy: false,
      ip: probe.ip ?? undefined,
      baselineIp,
      rttMs: probe.rttMs,
      protocol: VERIFY_PROTOCOL,
      error,
      at: Date.now(),
      phase: 'connected',
      source: probe.source,
    });
    await rollbackProxy();
    await chrome.storage.session.set({ connectionState: 'off' });
    throw new Error(error);
  }
  await saveVerify({
    healthy: true,
    ip: probe.ip ?? undefined,
    baselineIp,
    rttMs: probe.rttMs,
    protocol: VERIFY_PROTOCOL,
    hairpin: egressIsLocalHairpin(baselineIp, probe.ip ?? undefined),
    at: Date.now(),
    phase: 'connected',
    source: probe.source,
  });
  await scheduleReliabilityAlarms(sessionExpiresAt);
  await setBadge('on');
  return readConnectStatus();
}

/** Clears Chrome proxy locally. Must not call the API. */
export async function disconnectProxy(options?: { verify?: boolean }): Promise<void> {
  try {
    await setDirectProxy();
  } finally {
    await wipeProxySecrets();
    await clearReliabilityAlarms();
    await chrome.storage.session.set({ connectionState: 'off' });
    await chrome.storage.session.remove(['proxyHost', 'proxyPort', 'sessionExpiresAt', 'expiryMessage']);
    await setBadge('off');
  }
  if (options?.verify === false) {
    return;
  }
  await settleProxy();
  const baselineIp = await readBaselineIp();
  try {
    const probe = await probeEgressIp();
    const stillAway = Boolean(baselineIp && probe.ip && egressLooksProxied(baselineIp, probe.ip));
    await saveVerify({
      healthy: false,
      ip: probe.ip ?? undefined,
      baselineIp,
      rttMs: probe.rttMs,
      protocol: VERIFY_PROTOCOL,
      error: stillAway ? 'off but IP still differs from home' : undefined,
      at: Date.now(),
      phase: 'disconnected',
      source: probe.source,
    });
  } catch {
    // Disconnect already happened; verify is best-effort.
  }
}

/** Re-check egress from a tab. Same public IP as home is a local provider, not a drop. */
export async function verifyNow(): Promise<ConnectStatus> {
  const status = await readConnectStatus();
  const baselineIp = await readBaselineIp();
  const probe = await probeEgressIp();
  if (status.state === 'on' || status.state === 'lost') {
    if (!egressProbeSucceeded(probe.ip ?? undefined)) {
      const error = verifyFailureMessage(baselineIp, probe);
      await saveVerify({
        healthy: false,
        ip: probe.ip ?? undefined,
        baselineIp,
        rttMs: probe.rttMs,
        protocol: VERIFY_PROTOCOL,
        error,
        at: Date.now(),
        phase: 'connected',
        source: probe.source,
      });
      throw new Error(error);
    }
    if (status.state === 'lost') {
      await chrome.storage.session.set({ connectionState: 'on' });
      await setBadge('on');
    }
    await saveVerify({
      healthy: true,
      ip: probe.ip ?? undefined,
      baselineIp,
      rttMs: probe.rttMs,
      protocol: VERIFY_PROTOCOL,
      hairpin: egressIsLocalHairpin(baselineIp, probe.ip ?? undefined),
      at: Date.now(),
      phase: 'connected',
      source: probe.source,
    });
    return readConnectStatus();
  }
  await saveVerify({
    healthy: false,
    ip: probe.ip ?? undefined,
    baselineIp,
    rttMs: probe.rttMs,
    protocol: VERIFY_PROTOCOL,
    at: Date.now(),
    phase: 'disconnected',
    source: probe.source,
  });
  return readConnectStatus();
}

export async function markConnectionLost(fatal: boolean): Promise<void> {
  const status = await readConnectStatus();
  if (status.state !== 'on' && status.state !== 'lost') {
    return;
  }
  await chrome.storage.session.set({ connectionState: 'lost' });
  await setBadge('lost');
  if (fatal) {
    await disconnectProxy({ verify: false });
    await chrome.storage.session.set({ connectionState: 'lost' });
    await setBadge('lost');
  }
}

/** After browser restart, session HMAC is gone but chrome.proxy can persist. Clear if we have no secrets. */
export async function ensureProxyMatchesSession(): Promise<void> {
  const stored = await chrome.storage.session.get(['proxyUser', 'proxyPass', 'proxyProtocol', 'sessionExpiresAt']);
  const user = typeof stored.proxyUser === 'string' ? stored.proxyUser : '';
  const pass = typeof stored.proxyPass === 'string' ? stored.proxyPass : '';
  if (user && pass && stored.proxyProtocol === "https") {
    const exp = stored.sessionExpiresAt;
    if (typeof exp === 'number' && exp > 1e9 && exp <= Date.now()) {
      await applySessionExpired();
      return;
    }
    await scheduleReliabilityAlarms(typeof exp === 'number' && exp > 1e9 ? exp : undefined);
    return;
  }
  await clearReliabilityAlarms();
  const level = await getProxyControlLevel();
  if (level === 'controlled_by_this_extension') {
    await setDirectProxy();
  }
  await chrome.storage.session.set({ connectionState: 'off' });
  await setBadge('off');
}

export async function handleReliabilityAlarm(name: string): Promise<void> {
  if (name === KEEPALIVE_ALARM) {
    await onKeepAlive();
    return;
  }
  if (name === EXPIRY_WARN_ALARM) {
    await warnSessionExpiring();
    return;
  }
  if (name === EXPIRY_CLEAR_ALARM) {
    await applySessionExpired();
  }
}

export async function setBadge(kind: 'on' | 'off' | 'lost'): Promise<void> {
  if (kind === 'off') {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  await chrome.action.setBadgeBackgroundColor({ color: kind === 'on' ? '#7c3aed' : '#b91c1c' });
  await chrome.action.setBadgeText({ text: kind === 'on' ? 'ON' : '!' });
}

async function onKeepAlive(): Promise<void> {
  const status = await readConnectStatus();
  if (status.state !== 'on' && status.state !== 'lost') {
    await clearReliabilityAlarms();
    return;
  }
  const stored = await chrome.storage.session.get(['proxyUser', 'proxyPass', 'accessToken', 'accessExpiresAtMs']);
  const user = typeof stored.proxyUser === 'string' ? stored.proxyUser : '';
  const pass = typeof stored.proxyPass === 'string' ? stored.proxyPass : '';
  if (!user || !pass) {
    await ensureProxyMatchesSession();
    return;
  }
  let accessExp =
    typeof stored.accessExpiresAtMs === 'number' && Number.isFinite(stored.accessExpiresAtMs)
      ? stored.accessExpiresAtMs
      : undefined;
  if (accessExp === undefined && typeof stored.accessToken === 'string') {
    accessExp = jwtExpMs(stored.accessToken);
  }
  if (shouldRefreshAccessToken(accessExp)) {
    await refreshDeviceSession();
  }
  await expireConnectedSessionIfPast();
}

async function expireConnectedSessionIfPast(): Promise<void> {
  const stored = await chrome.storage.session.get(['sessionExpiresAt', 'connectionState']);
  const state = stored.connectionState;
  if (state !== 'on' && state !== 'lost') {
    return;
  }
  const exp = stored.sessionExpiresAt;
  if (typeof exp === 'number' && exp > 1e9 && exp <= Date.now()) {
    await applySessionExpired();
  }
}

async function warnSessionExpiring(): Promise<void> {
  const stored = await chrome.storage.session.get(['sessionExpiresAt', 'connectionState']);
  const state = stored.connectionState;
  if (state !== 'on' && state !== 'lost') {
    return;
  }
  const exp = stored.sessionExpiresAt;
  if (typeof exp === 'number' && exp > 1e9 && exp <= Date.now()) {
    await applySessionExpired();
    return;
  }
  const msg =
    expiryPopupCopy(typeof exp === 'number' ? exp : undefined) ||
    'Session expires soon. Turn on to reconnect after it drops.';
  await chrome.storage.session.set({ expiryMessage: msg });
}

async function applySessionExpired(): Promise<void> {
  await disconnectProxy({ verify: false });
  await chrome.storage.session.set({
    connectionState: 'lost',
    expiryMessage: SESSION_EXPIRED_COPY,
  });
  await setBadge('lost');
}

async function captureBaselineIp(): Promise<string | undefined> {
  const level = await getProxyControlLevel();
  if (level === 'controlled_by_this_extension') {
    return readBaselineIp();
  }
  const probe = await probeEgressIp();
  if (probe.ip) {
    await chrome.storage.session.set({ baselineIp: probe.ip });
    await saveVerify({
      healthy: false,
      ip: probe.ip,
      baselineIp: probe.ip,
      rttMs: probe.rttMs,
      protocol: VERIFY_PROTOCOL,
      at: Date.now(),
      phase: 'baseline',
      source: probe.source,
    });
    return probe.ip;
  }
  return readBaselineIp();
}

async function readBaselineIp(): Promise<string | undefined> {
  const stored = await chrome.storage.session.get('baselineIp');
  return typeof stored.baselineIp === 'string' && stored.baselineIp ? stored.baselineIp : undefined;
}

async function saveVerify(snapshot: VerifySnapshot): Promise<void> {
  await chrome.storage.session.set({ verifyResult: snapshot });
}

async function rollbackProxy(): Promise<void> {
  try {
    await setDirectProxy();
  } catch {
    // still clear secrets so we never auth against a proxy we do not control
  }
  await wipeProxySecrets();
  await clearReliabilityAlarms();
  await chrome.storage.session.set({ connectionState: 'off' });
  await chrome.storage.session.remove(['proxyHost', 'proxyPort', 'sessionExpiresAt', 'expiryMessage']);
  await setBadge('off');
}

function settleProxy(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 250);
  });
}

function verifyFailureMessage(_baselineIp: string | undefined, probe: { ip: string | null; error?: string }): string {
  if (!probe.ip) {
    return probe.error || 'verify failed: no egress IP from tab';
  }
  return 'verify failed';
}

function isVerifySnapshot(value: unknown): value is VerifySnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const snap = value as VerifySnapshot;
  return snap.protocol === VERIFY_PROTOCOL && typeof snap.healthy === 'boolean';
}
