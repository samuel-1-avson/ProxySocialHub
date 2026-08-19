import {
  EXPIRY_CLEAR_ALARM,
  EXPIRY_WARN_ALARM,
  KEEPALIVE_ALARM,
  KEEPALIVE_PERIOD_MINUTES,
  expiryAlarmWhen,
} from './reliability';

export async function scheduleReliabilityAlarms(sessionExpiresAtMs?: number): Promise<void> {
  await chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: KEEPALIVE_PERIOD_MINUTES });
  await chrome.alarms.clear(EXPIRY_WARN_ALARM);
  await chrome.alarms.clear(EXPIRY_CLEAR_ALARM);
  if (typeof sessionExpiresAtMs !== 'number' || !Number.isFinite(sessionExpiresAtMs)) {
    return;
  }
  const now = Date.now();
  if (sessionExpiresAtMs > now) {
    await chrome.alarms.create(EXPIRY_CLEAR_ALARM, { when: sessionExpiresAtMs });
  }
  const warnAt = expiryAlarmWhen(sessionExpiresAtMs, now);
  if (warnAt !== null) {
    await chrome.alarms.create(EXPIRY_WARN_ALARM, { when: warnAt });
  }
}

export async function clearReliabilityAlarms(): Promise<void> {
  await chrome.alarms.clear(KEEPALIVE_ALARM);
  await chrome.alarms.clear(EXPIRY_WARN_ALARM);
  await chrome.alarms.clear(EXPIRY_CLEAR_ALARM);
}
