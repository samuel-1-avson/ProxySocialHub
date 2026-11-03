// Development only (see loadIpc): a scripted stand-in for the Rust side, so every screen can be
// opened in an ordinary browser. `?state=sharing` (or any kind) starts on that screen;
// without it the first-run flow plays out: consent, pairing, connecting, sharing.
// `?diag=clean|problems|slow|fail` picks what "Check my connection" finds. `?update=1` shows the
// "newer version" notice, `?disconnect=fail` makes Disconnect fail, `?tls=off` turns the
// certificate-checks warning on in the settings, `?rules=fail` makes the rules assistant fail.

import type { Ipc } from './ipc';
import type {
  AppState,
  Diagnosis,
  NodeSettings,
  PairingEnded,
  RemoteView,
  SharingDetails,
  UpdateNotice,
} from './types';

const NOW = Math.floor(Date.now() / 1000);

const NOT_ASKED: RemoteView = { server: 'checking', earnings: null, updated_at_unix: null };

const ONLINE: RemoteView = {
  server: 'online',
  updated_at_unix: NOW - 150,
  earnings: { last_7_days_sol: 0.0412, last_30_days_sol: 0.1873, pending_sol: 0.0125, paid_sol: 0.9 },
};

const details = (remote: RemoteView): SharingDetails => ({
  rate_up_kbps: 410,
  rate_down_kbps: 9_200,
  total_connections: 1_204,
  failed_connections: 17,
  latency_ms: 38,
  remote,
});

const SAMPLES: Record<string, AppState> = {
  needs_consent: { kind: 'needs_consent' },
  needs_pairing: { kind: 'needs_pairing' },
  pairing: {
    kind: 'pairing',
    user_code: 'BCDF-GHJK',
    link: 'https://proxyhubb.com/dashboard/provider/pair?code=BCDF-GHJK',
    expires_in: 600,
  },
  connecting: { kind: 'connecting', detail: null, retry: null, managed_externally: false },
  connecting_error: {
    kind: 'connecting',
    detail: 'The gateway could not be reached.',
    retry: null,
    managed_externally: false,
  },
  connecting_retry: {
    kind: 'connecting',
    detail: 'TCP dial to proxy.proxyhubb.com:8443 failed',
    retry: {
      active_gateway: 'proxy.proxyhubb.com:8443',
      gateway_index: 1,
      gateway_total: 2,
      updated_at_unix: NOW - 12,
    },
    managed_externally: false,
  },
  connecting_external: {
    kind: 'connecting',
    detail: null,
    retry: null,
    managed_externally: true,
  },
  sharing: {
    kind: 'sharing',
    uptime_seconds: 3 * 3600 + 25 * 60,
    bytes_up: 48_200_000,
    bytes_down: 612_000_000,
    active_connections: 3,
    managed_externally: false,
    details: details(ONLINE),
  },
  // The first minutes: the servers have not been asked yet.
  sharing_checking: {
    kind: 'sharing',
    uptime_seconds: 20,
    bytes_up: 0,
    bytes_down: 0,
    active_connections: 0,
    managed_externally: false,
    details: { ...details(NOT_ASKED), rate_up_kbps: 0, rate_down_kbps: 0, latency_ms: 0, total_connections: 0, failed_connections: 0 },
  },
  sharing_not_seen: {
    kind: 'sharing',
    uptime_seconds: 90,
    bytes_up: 1000,
    bytes_down: 2000,
    active_connections: 0,
    managed_externally: false,
    details: details({ ...ONLINE, server: 'not_seen', earnings: ONLINE.earnings }),
  },
  sharing_rejected: {
    kind: 'sharing',
    uptime_seconds: 600,
    bytes_up: 1000,
    bytes_down: 2000,
    active_connections: 0,
    managed_externally: false,
    details: details({ server: 'key_rejected', earnings: null, updated_at_unix: NOW - 30 }),
  },
  sharing_unreachable: {
    kind: 'sharing',
    uptime_seconds: 600,
    bytes_up: 1000,
    bytes_down: 2000,
    active_connections: 1,
    managed_externally: false,
    details: details({ server: 'unreachable', earnings: null, updated_at_unix: NOW - 30 }),
  },
  sharing_external: {
    kind: 'sharing',
    uptime_seconds: 600,
    bytes_up: 1000,
    bytes_down: 2000,
    active_connections: 0,
    managed_externally: true,
    details: details(ONLINE),
  },
  paused: { kind: 'paused' },
  problem: { kind: 'problem', reason: 'The node did not start. Please try again.' },
};

const DIAGNOSES: Record<string, Diagnosis> = {
  clean: { findings: [] },
  problems: {
    findings: [
      {
        level: 'problem',
        text: "This computer could not open a connection to ProxyHubb's gateway. A firewall, VPN or network filter may be blocking it.",
      },
      {
        level: 'note',
        text: 'The node is not answering on this computer. Pausing and then resuming sharing usually fixes it.',
      },
    ],
  },
};

const SETTINGS: NodeSettings = {
  config_path: 'C:\\Users\\you\\AppData\\Roaming\\proxyhubb\\provider.toml',
  gateways: ['proxy.proxyhubb.com:3128', 'proxy.proxyhubb.com:8443'],
  transport: 'yamux',
  use_tls: true,
  tls_skip_verify: false,
  max_connections: 500,
  bandwidth_limit_mbps: 100,
  allowed_ports: [80, 443, 8080, 8443],
  blocked_hosts: ['old.example'],
  connection_type: 'residential',
};

export function createMockIpc(): Ipc {
  const params = new URLSearchParams(window.location.search);
  const initial = params.get('state');
  const diag = params.get('diag') ?? 'problems';
  const notice: UpdateNotice | null = params.get('update') ? { latest: '0.1.3', current: '0.1.2' } : null;
  let state: AppState = (initial && SAMPLES[initial]) || SAMPLES.needs_consent;
  let autostart = false;
  let blockedHosts = [...SETTINGS.blocked_hosts];
  const stateListeners = new Set<(s: AppState) => void>();
  const endedListeners = new Set<(e: PairingEnded) => void>();
  const updateListeners = new Set<(n: UpdateNotice | null) => void>();
  const set = (s: AppState) => {
    state = s;
    stateListeners.forEach((l) => l(s));
  };
  const later = (ms: number, fn: () => void) => window.setTimeout(fn, ms);
  const wait = (ms: number) => new Promise<void>((resolve) => later(ms, resolve));

  return {
    appState: async () => state,
    acceptConsent: async () => set(SAMPLES.needs_pairing),
    beginPairing: async () => {
      later(800, () => set(SAMPLES.pairing));
      later(6000, () => set(SAMPLES.connecting));
      later(8000, () => set(SAMPLES.sharing_checking));
      later(11000, () => set(SAMPLES.sharing));
    },
    cancelPairing: async () => set(SAMPLES.needs_pairing),
    setSharing: async (on) => set(on ? SAMPLES.sharing : SAMPLES.paused),
    stopOutsideNode: async () => set(SAMPLES.paused),
    restartNode: async () => {
      set(SAMPLES.connecting);
      later(1500, () => set(SAMPLES.sharing));
    },
    disconnect: async () => {
      await wait(800);
      if (params.get('disconnect') === 'fail') {
        throw 'The node did not stop in time, so nothing was disconnected. Please try again.';
      }
      set(SAMPLES.needs_pairing);
      return {
        archived_config: 'C:\\Users\\you\\AppData\\Roaming\\proxyhubb\\provider.toml.disconnected-1700000000',
      };
    },
    getNodeSettings: async () => {
      await wait(200);
      return { ...SETTINGS, tls_skip_verify: params.get('tls') === 'off', blocked_hosts: [...blockedHosts] };
    },
    draftRules: async () => {
      await wait(1200);
      if (params.get('rules') === 'fail') {
        throw 'The rules assistant did not answer. You can still edit the list yourself.';
      }
      const added = [
        { host: 'facebook.com', source: 'named' },
        { host: 'bet365.com', source: 'category:gambling' },
      ].filter((c) => !blockedHosts.includes(c.host));
      const removed = blockedHosts.includes('old.example') ? [{ host: 'old.example', source: 'named' }] : [];
      const blocked = [...blockedHosts.filter((h) => !removed.some((r) => r.host === h)), ...added.map((c) => c.host)];
      return {
        plan: {
          blocked,
          added,
          removed,
          categories: [{ id: 'gambling', label: 'Gambling and betting', sites: 30, action: 'block' as const }],
          rejected: [],
          notes: [{ level: 'info' as const, message: 'Categories cover a short, fixed list of well-known sites.' }],
          assumptions: ['Gambling includes betting sites.'],
          cannotDo: ['Blocking only in the evenings is not possible.'],
          unchanged: added.length === 0 && removed.length === 0,
          refused: false,
        },
        model: 'muse-spark-1.3',
        dataMode: 'standard',
      };
    },
    saveBlockedSites: async (sites) => {
      await wait(600);
      const changed = JSON.stringify(sites) !== JSON.stringify(blockedHosts);
      blockedHosts = [...sites];
      return {
        blockedHosts: [...blockedHosts],
        rejected: [],
        changed,
        restarted: state.kind === 'sharing',
        needsRestart: false,
      };
    },
    getUpdateNotice: async () => notice,
    openTokensPage: async () => undefined,
    openDownloadPage: async () => undefined,
    refreshAccount: async () => {
      await wait(600);
      if (state.kind === 'sharing') {
        set({ ...state, details: { ...state.details, remote: { ...ONLINE, updated_at_unix: Math.floor(Date.now() / 1000) } } });
      }
    },
    runDiagnosis: async () => {
      await wait(diag === 'slow' ? 6000 : 1500);
      if (diag === 'fail') throw 'The check took too long and was stopped. Please try again.';
      return DIAGNOSES[diag === 'slow' ? 'problems' : diag] ?? DIAGNOSES.problems;
    },
    saveSupportDetails: async () => {
      await wait(900);
      return 'C:\\Users\\you\\AppData\\Roaming\\com.proxyhubb.provider\\support\\support-details-1700000000.json';
    },
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
    onUpdate: async (cb) => {
      updateListeners.add(cb);
      return () => updateListeners.delete(cb);
    },
  };
}
