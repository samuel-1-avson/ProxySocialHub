// Development only (see loadIpc): a scripted stand-in for the Rust side, so every screen can be
// opened in an ordinary browser. `?state=sharing` (or any kind) starts on that screen;
// without it the first-run flow plays out: consent, pairing, connecting, sharing.

import type { Ipc } from './ipc';
import type { AppState, PairingEnded } from './types';

const SAMPLES: Record<string, AppState> = {
  needs_consent: { kind: 'needs_consent' },
  needs_pairing: { kind: 'needs_pairing' },
  pairing: {
    kind: 'pairing',
    user_code: 'BCDF-GHJK',
    link: 'https://proxyhubb.com/dashboard/provider/pair?code=BCDF-GHJK',
    expires_in: 600,
  },
  connecting: { kind: 'connecting', detail: null },
  connecting_error: { kind: 'connecting', detail: 'The gateway could not be reached.' },
  sharing: {
    kind: 'sharing',
    uptime_seconds: 3 * 3600 + 25 * 60,
    bytes_up: 48_200_000,
    bytes_down: 612_000_000,
    active_connections: 3,
  },
  paused: { kind: 'paused' },
  problem: { kind: 'problem', reason: 'The node did not start. Please try again.' },
};

export function createMockIpc(): Ipc {
  const initial = new URLSearchParams(window.location.search).get('state');
  let state: AppState = (initial && SAMPLES[initial]) || SAMPLES.needs_consent;
  let autostart = false;
  const stateListeners = new Set<(s: AppState) => void>();
  const endedListeners = new Set<(e: PairingEnded) => void>();
  const set = (s: AppState) => {
    state = s;
    stateListeners.forEach((l) => l(s));
  };
  const later = (ms: number, fn: () => void) => window.setTimeout(fn, ms);

  return {
    appState: async () => state,
    acceptConsent: async () => set(SAMPLES.needs_pairing),
    beginPairing: async () => {
      later(800, () => set(SAMPLES.pairing));
      later(6000, () => set(SAMPLES.connecting));
      later(8000, () => set(SAMPLES.sharing));
    },
    cancelPairing: async () => set(SAMPLES.needs_pairing),
    setSharing: async (on) => set(on ? SAMPLES.sharing : SAMPLES.paused),
    openPairingLink: async () => undefined,
    openDashboard: async () => undefined,
    getAutostart: async () => autostart,
    setAutostart: async (on) => {
      autostart = on;
    },
    onState: async (cb) => {
      stateListeners.add(cb);
      return () => stateListeners.delete(cb);
    },
    onPairingEnded: async (cb) => {
      endedListeners.add(cb);
      return () => endedListeners.delete(cb);
    },
  };
}
