// Pure helpers for what the screens say. No React, no Tauri: tested on their own.

import type { PairingEnded, ServerView } from './types';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** 0 -> "0 B", 1536 -> "1.5 KB". Binary units, one decimal from KB up. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${UNITS[unit]}`;
}

/** How long the node has been connected, in the plainest words. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return 'just started';
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${String(minutes % 60).padStart(2, '0')} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

/** Seconds left on a pairing code that was shown `startedAtMs` and lasts `expiresIn` seconds. */
export function secondsLeft(expiresIn: number, startedAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil(expiresIn - (nowMs - startedAtMs) / 1000));
}

/** "9:05" for 545 seconds. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The continue button on the consent screen stays off until the box is ticked. */
export function canAcceptConsent(checked: boolean): boolean {
  return checked === true;
}

export interface Notice {
  tone: 'info' | 'warn';
  title: string;
  body: string;
}

/** What to tell the person when a pairing ended without connecting. `approved` needs no notice. */
export function noticeForPairingEnd(ended: PairingEnded): Notice | null {
  switch (ended.outcome) {
    case 'approved':
      return null;
    case 'denied':
      return {
        tone: 'warn',
        title: 'The request was denied',
        body: 'Nothing was connected. If you did not deny it yourself, start again and approve the code.',
      };
    case 'expired':
      return {
        tone: 'info',
        title: 'The code expired',
        body: 'Codes last 10 minutes and work once. Press Connect to get a new one.',
      };
    case 'failed':
      return {
        tone: 'warn',
        title: 'Could not connect',
        body: ended.message || 'Something went wrong. Please try again.',
      };
  }
}
/** Where a reconnecting node stands in its gateway rotation (mirrors Rust RetryFacts). */
export interface RetryInfo {
  active_gateway: string;
  gateway_index: number;
  gateway_total: number;
  updated_at_unix: number;
}

/** 'just now' under 5s, then '12s ago', '3m ago', '2h ago'. Pure: now passed in. */
export function formatAgo(updatedAtUnix: number, nowMs: number): string {
  const s = Math.max(0, Math.floor(nowMs / 1000 - updatedAtUnix));
  if (s < 5) return 'just now';
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  return Math.floor(m / 60) + 'h ago';
}

/** 'Trying gw (1 of 2). The node retries automatically. Last error 12s ago: <detail>.' */
export function formatRetrySentence(retry: RetryInfo, detail: string | null, nowMs: number): string {
  const where = retry.gateway_total > 1
    ? retry.active_gateway + ' (' + (retry.gateway_index + 1) + ' of ' + retry.gateway_total + ')'
    : retry.active_gateway;
  const base = 'Trying ' + where + '. The node retries automatically.';
  if (!detail) return base;
  return base + ' Last error ' + formatAgo(retry.updated_at_unix, nowMs) + ': ' + detail;
}

/** An amount of SOL: "0 SOL" for none, "<0.0001 SOL" for dust, otherwise up to four decimals
 *  without trailing zeros. Nothing that cannot be a real amount is shown as one. */
export function formatSol(sol: number): string {
  if (!Number.isFinite(sol) || sol <= 0) return '0 SOL';
  if (sol < 0.0001) return '<0.0001 SOL';
  return `${Number(sol.toFixed(4))} SOL`;
}

/** Speed from kilobits per second: "850 kbps", "9.0 Mbps". */
export function formatRate(kbps: number): string {
  if (!Number.isFinite(kbps) || kbps <= 0) return '0 kbps';
  if (kbps < 1000) return `${Math.round(kbps)} kbps`;
  return `${(kbps / 1000).toFixed(1)} Mbps`;
}

/** Round trip to the gateway; 0 means the node has no sample yet. */
export function formatDelay(ms: number): string {
  return Number.isFinite(ms) && ms > 0 ? `${Math.round(ms)} ms` : '—';
}

export interface ServerLine {
  tone: 'good' | 'neutral' | 'bad';
  text: string;
}

/** What ProxyHubb's servers say about this computer, in a sentence. Anything that is not
 *  "online" says what it may mean, and none of it blames the person. */
export function serverLine(server: ServerView): ServerLine {
  switch (server) {
    case 'checking':
      return { tone: 'neutral', text: 'Checking with ProxyHubb…' };
    case 'online':
      return { tone: 'good', text: 'ProxyHubb sees this computer as online.' };
    case 'not_seen':
      return {
        tone: 'neutral',
        text: 'ProxyHubb does not show this computer as online yet. This can take a few minutes after connecting.',
      };
    case 'not_registered':
      return {
        tone: 'neutral',
        text: 'ProxyHubb does not list this computer on your account. If you just connected, wait a few minutes and press Refresh.',
      };
    case 'key_rejected':
      return {
        tone: 'bad',
        text: "ProxyHubb did not accept this computer's key. It may have been revoked in your dashboard, in which case this computer has to be connected again.",
      };
    case 'unreachable':
      return {
        tone: 'neutral',
        text: 'Could not reach ProxyHubb to check. That does not mean sharing has stopped.',
      };
  }
}

/** What this computer offers ProxyHubb, as a sentence. These are announced, not enforced. */
export function offerSentence(connections: number, mbps: number): string {
  const c = Number.isFinite(connections) && connections > 0 ? `${Math.round(connections)} connections` : 'no stated number of connections';
  const s = Number.isFinite(mbps) && mbps > 0 ? `${Math.round(mbps)} Mbps` : 'no stated speed';
  return `Up to ${c} and ${s}`;
}

/** "80, 443, 8080" or the given words when there is nothing to list. */
export function listOrNone(items: readonly (string | number)[], none: string): string {
  return items.length > 0 ? items.join(', ') : none;
}

/** The notice about a newer installer, in a sentence. */
export function updateSentence(latest: string, current: string): string {
  return `A newer version of ProxyHubb Provider is available (${latest}). You have ${current}.`;
}
