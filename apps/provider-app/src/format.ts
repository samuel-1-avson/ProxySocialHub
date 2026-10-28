// Pure helpers for what the screens say. No React, no Tauri: tested on their own.

import type { PairingEnded } from './types';

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
