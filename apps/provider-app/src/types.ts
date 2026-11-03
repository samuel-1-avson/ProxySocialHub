// Mirrors src-tauri/src/state.rs (AppState) and engine.rs (PairingEnded). The `kind` and
// `outcome` tags are what the Rust side serializes; keep the two in step.

export type AppState =
  | { kind: 'needs_consent' }
  | { kind: 'needs_pairing' }
  | { kind: 'pairing'; user_code: string; link: string; expires_in: number }
  | {
      kind: 'connecting';
      detail: string | null;
      retry: {
        active_gateway: string;
        gateway_index: number;
        gateway_total: number;
        updated_at_unix: number;
      } | null;
      /** Started outside the app: Stop asks first and only then stops it. */
      managed_externally: boolean;
    }
  | {
      kind: 'sharing';
      uptime_seconds: number;
      bytes_up: number;
      bytes_down: number;
      active_connections: number;
      managed_externally: boolean;
      details: SharingDetails;
    }
  | { kind: 'paused' }
  | { kind: 'problem'; reason: string };

export type PairingEnded =
  | { outcome: 'approved' }
  | { outcome: 'denied' }
  | { outcome: 'expired' }
  | { outcome: 'failed'; message: string };

// Mirrors src-tauri/src/account.rs (ServerView, RemoteView) and state.rs (SharingDetails).

/** What ProxyHubb's servers say about this computer. */
export type ServerView =
  | 'checking'
  | 'online'
  | 'not_seen'
  | 'not_registered'
  | 'key_rejected'
  | 'unreachable';

export interface EarningsView {
  last_7_days_sol: number;
  last_30_days_sol: number;
  /** Earned and waiting to be paid out. */
  pending_sol: number;
  paid_sol: number;
}

export interface RemoteView {
  server: ServerView;
  /** `null` when the servers could not be asked or gave no earnings. */
  earnings: EarningsView | null;
  /** Seconds since the epoch; `null` until the first answer. */
  updated_at_unix: number | null;
}

export interface SharingDetails {
  /** Current speed in kilobits per second. */
  rate_up_kbps: number;
  rate_down_kbps: number;
  total_connections: number;
  failed_connections: number;
  /** Round trip to the gateway; 0 means no sample yet. */
  latency_ms: number;
  remote: RemoteView;
}

// Mirrors src-tauri/src/diagnosis.rs.
export interface Finding {
  level: 'problem' | 'note';
  text: string;
}

export interface Diagnosis {
  findings: Finding[];
}

// Mirrors src-tauri/src/node_settings.rs, disconnect.rs and app_update.rs.

/** This computer's node settings, for reading. Only `blocked_hosts` can be changed, via `saveBlockedSites`. */
export interface NodeSettings {
  config_path: string;
  gateways: string[];
  /** "yamux" or "quic". */
  transport: string;
  use_tls: boolean;
  /** Gateway certificate checks are off. Only ever for development. */
  tls_skip_verify: boolean;
  /** What this computer OFFERS ProxyHubb. The node does not use these to slow anything down. */
  max_connections: number;
  bandwidth_limit_mbps: number;
  allowed_ports: number[];
  blocked_hosts: string[];
  connection_type: string;
}

export interface DisconnectResult {
  /** Where the settings file was kept (it still holds the key); `null` when there was none. */
  archived_config: string | null;
}

/** One site added to or removed from the blocked sites. `source` is `named` or `category:<id>`. */
export interface RuleChange {
  host: string;
  source: string;
}

/** A change to the blocked sites, drafted from the provider's words and checked by ProxyHubb. */
export interface RulesPlan {
  /** The whole list to save. */
  blocked: string[];
  added: RuleChange[];
  removed: RuleChange[];
  categories: { id: string; label: string; sites: number; action: 'block' | 'unblock' }[];
  rejected: string[];
  notes: { level: 'info' | 'warning' | 'blocked'; message: string }[];
  /** What the assistant guessed; the provider should check these. */
  assumptions: string[];
  cannotDo: string[];
  unchanged: boolean;
  refused: boolean;
}

export interface RulesDraft {
  plan: RulesPlan;
  model: string;
  /** `standard`: the words are not used for training. */
  dataMode: string;
}

export interface BlockedSitesSaved {
  blockedHosts: string[];
  rejected: string[];
  changed: boolean;
  /** The node was running under this app and was restarted: the list is in force now. */
  restarted: boolean;
  /** The node is running but was started elsewhere: it applies after a restart. */
  needsRestart: boolean;
}

/** A newer installer than this app exists. */
export interface UpdateNotice {
  latest: string;
  current: string;
}
