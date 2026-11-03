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
