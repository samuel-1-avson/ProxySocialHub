import { describe, expect, it } from 'vitest';
import { CONSENT_CHECKBOX, CONSENT_POINTS, CONSENT_VERSION } from './consent';
import {
  canAcceptConsent,
  formatAgo,
  formatBytes,
  formatCountdown,
  formatDelay,
  formatDuration,
  formatRate,
  formatRetrySentence,
  formatSol,
  noticeForPairingEnd,
  secondsLeft,
  serverLine,
} from './format';
import type { ServerView } from './types';

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
describe('retry display', () => {
  const retry = { active_gateway: 'gw:3128', gateway_index: 0, gateway_total: 2, updated_at_unix: 1000 };
  it('ages errors in plain words and never goes negative', () => {
    expect(formatAgo(1000, 1000 * 1000)).toBe('just now');
    expect(formatAgo(1000, 1012 * 1000)).toBe('12s ago');
    expect(formatAgo(1000, 1300 * 1000)).toBe('5m ago');
    expect(formatAgo(2000, 1000 * 1000)).toBe('just now');
  });
  it('names the gateway, the rotation slot and the last error', () => {
    expect(formatRetrySentence(retry, 'boom', 1012 * 1000)).toBe(
      'Trying gw:3128 (1 of 2). The node retries automatically. Last error 12s ago: boom',
    );
  });
  it('stays calm without an error and without a rotation', () => {
    expect(formatRetrySentence(retry, null, 1012 * 1000)).toBe(
      'Trying gw:3128 (1 of 2). The node retries automatically.',
    );
    const single = { ...retry, gateway_total: 1 };
    expect(formatRetrySentence(single, null, 0)).toBe('Trying gw:3128. The node retries automatically.');
  });
});

describe('formatSol', () => {
  it('shows none, dust and ordinary amounts without trailing zeros', () => {
    expect(formatSol(0)).toBe('0 SOL');
    expect(formatSol(0.00004)).toBe('<0.0001 SOL');
    expect(formatSol(0.0001)).toBe('0.0001 SOL');
    expect(formatSol(0.25)).toBe('0.25 SOL');
    expect(formatSol(1)).toBe('1 SOL');
    expect(formatSol(1.23456)).toBe('1.2346 SOL');
    expect(formatSol(1234.5)).toBe('1234.5 SOL');
  });

  it('never shows a negative or non-number as an amount', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(formatSol(bad)).toBe('0 SOL');
    }
  });
});

describe('formatRate', () => {
  it('switches from kilobits to megabits at one thousand', () => {
    expect(formatRate(0)).toBe('0 kbps');
    expect(formatRate(850.4)).toBe('850 kbps');
    expect(formatRate(999)).toBe('999 kbps');
    expect(formatRate(1000)).toBe('1.0 Mbps');
    expect(formatRate(9000)).toBe('9.0 Mbps');
    expect(formatRate(12_345)).toBe('12.3 Mbps');
  });

  it('treats a bad number as no traffic', () => {
    expect(formatRate(-5)).toBe('0 kbps');
    expect(formatRate(Number.NaN)).toBe('0 kbps');
  });
});

describe('formatDelay', () => {
  it('shows a dash until the node has a sample', () => {
    expect(formatDelay(0)).toBe('—');
    expect(formatDelay(Number.NaN)).toBe('—');
    expect(formatDelay(34.6)).toBe('35 ms');
  });
});

describe('serverLine', () => {
  const all: ServerView[] = [
    'checking',
    'online',
    'not_seen',
    'not_registered',
    'key_rejected',
    'unreachable',
  ];

  it('has a sentence for every answer and only online is good news', () => {
    for (const view of all) {
      const line = serverLine(view);
      expect(line.text.length).toBeGreaterThan(10);
      expect(line.tone === 'good').toBe(view === 'online');
    }
  });

  it('calls a refused key bad and an unreachable server neither bad nor a stopped node', () => {
    expect(serverLine('key_rejected').tone).toBe('bad');
    expect(serverLine('unreachable').tone).toBe('neutral');
    expect(serverLine('unreachable').text).toContain('does not mean sharing has stopped');
  });

  it('does not use words the window avoids for a person who is not technical', () => {
    for (const view of all) {
      expect(serverLine(view).text).not.toMatch(/api|jwt|token|provider.toml|heartbeat/i);
    }
  });
});
