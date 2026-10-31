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
    }
  | {
      kind: 'sharing';
      uptime_seconds: number;
      bytes_up: number;
      bytes_down: number;
      active_connections: number;
      managed_externally: boolean;
    }
  | { kind: 'paused' }
  | { kind: 'problem'; reason: string };

export type PairingEnded =
  | { outcome: 'approved' }
  | { outcome: 'denied' }
  | { outcome: 'expired' }
  | { outcome: 'failed'; message: string };
