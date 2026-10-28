import { describe, expect, it } from 'vitest';
import { CONSENT_CHECKBOX, CONSENT_POINTS, CONSENT_VERSION } from './consent';
import {
  canAcceptConsent,
  formatBytes,
  formatCountdown,
  formatDuration,
  noticeForPairingEnd,
  secondsLeft,
} from './format';

describe('formatBytes', () => {
  it('uses plain units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
  });
  it('never shows nonsense for bad input', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(formatBytes(bad)).toBe('0 B');
  });
  it('stops at TB instead of inventing units', () => {
    expect(formatBytes(2 * 1024 ** 5)).toBe('2048.0 TB');
  });
});

describe('formatDuration', () => {
  it('reads as words a person would say', () => {
    expect(formatDuration(0)).toBe('just started');
    expect(formatDuration(59)).toBe('just started');
    expect(formatDuration(60)).toBe('1 min');
    expect(formatDuration(45 * 60)).toBe('45 min');
    expect(formatDuration(3 * 3600 + 5 * 60)).toBe('3 h 05 min');
    expect(formatDuration(2 * 86400 + 4 * 3600)).toBe('2 d 4 h');
    expect(formatDuration(-5)).toBe('just started');
  });
});

describe('pairing countdown', () => {
  it('counts down from when the code was shown and never goes negative', () => {
    expect(secondsLeft(600, 1_000, 1_000)).toBe(600);
    expect(secondsLeft(600, 1_000, 61_000)).toBe(540);
    expect(secondsLeft(600, 1_000, 1_000_000)).toBe(0);
  });
  it('formats as m:ss', () => {
    expect(formatCountdown(545)).toBe('9:05');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-3)).toBe('0:00');
  });
});

describe('consent gate', () => {
  it('only an explicit tick lets the person continue', () => {
    expect(canAcceptConsent(false)).toBe(false);
    expect(canAcceptConsent(true)).toBe(true);
    // Anything that is not literally true (e.g. an event object) must not count.
    expect(canAcceptConsent({} as unknown as boolean)).toBe(false);
    expect(canAcceptConsent(undefined as unknown as boolean)).toBe(false);
  });
  it('says what the draft promises, and the version is the one Rust enforces', () => {
    expect(CONSENT_VERSION).toBe(1);
    expect(CONSENT_POINTS).toHaveLength(4);
    expect(CONSENT_POINTS[0]).toMatch(/home internet address/);
    expect(CONSENT_POINTS[2]).toMatch(/80, 443, 8080 and 8443/);
    expect(CONSENT_CHECKBOX).toMatch(/own this internet connection/);
  });
});

describe('noticeForPairingEnd', () => {
  it('has nothing to say about a success', () => {
    expect(noticeForPairingEnd({ outcome: 'approved' })).toBeNull();
  });
  it('explains denied, expired and failed in plain words', () => {
    expect(noticeForPairingEnd({ outcome: 'denied' })?.title).toBe('The request was denied');
    expect(noticeForPairingEnd({ outcome: 'expired' })?.body).toMatch(/10 minutes/);
    expect(noticeForPairingEnd({ outcome: 'failed', message: 'no network' })?.body).toBe('no network');
    expect(noticeForPairingEnd({ outcome: 'failed', message: '' })?.body).toMatch(/try again/);
  });
});
