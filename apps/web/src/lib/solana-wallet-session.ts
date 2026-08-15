/**
 * Clear Solana wallet-adapter session so autoConnect cannot resurrect
 * the previous account after logout / user switch / manual disconnect.
 */
export function clearSolanaWalletAdapterSession(): void {
  if (typeof window === 'undefined') return;
  try {
    // Default key used by @solana/wallet-adapter-react WalletProvider.
    window.localStorage.removeItem('walletName');
    // Defensive: older/alternate keys seen in the wild.
    window.localStorage.removeItem('walletAdapter');
    window.localStorage.removeItem('SolanaWalletAdapter');
  } catch {
    // ignore quota / private mode
  }
  try {
    window.dispatchEvent(new CustomEvent('proxyhubb:wallet-session-clear'));
  } catch {
    // ignore
  }
}

const MANUAL_DISCONNECT_KEY = 'proxyhubb:wallet-manual-disconnect';
const MANUAL_DISCONNECT_TTL_MS = 15 * 60 * 1000;

/** Block LinkedWalletAutoReconnect / autoConnect resurrection after user disconnect. */
export function markManualSolanaWalletDisconnect(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(MANUAL_DISCONNECT_KEY, String(Date.now()));
  } catch {
    // ignore
  }
  clearSolanaWalletAdapterSession();
}

export function isManualSolanaWalletDisconnectActive(
  ttlMs: number = MANUAL_DISCONNECT_TTL_MS,
): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.sessionStorage.getItem(MANUAL_DISCONNECT_KEY);
    const ts = Number(raw || 0);
    if (!Number.isFinite(ts) || ts <= 0) return false;
    return Date.now() - ts < ttlMs;
  } catch {
    return false;
  }
}

export function clearManualSolanaWalletDisconnect(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(MANUAL_DISCONNECT_KEY);
  } catch {
    // ignore
  }
}

type ForceDisconnectArgs = {
  disconnect: () => Promise<void>;
  select: (name: null) => void;
};

/**
 * Hard disconnect: clear adapter storage, deselect wallet, disconnect.
 * Prevents WalletProvider autoConnect from immediately reconnecting.
 */
export async function forceDisconnectSolanaWallet({
  disconnect,
  select,
}: ForceDisconnectArgs): Promise<void> {
  markManualSolanaWalletDisconnect();
  try {
    select(null);
  } catch {
    // ignore
  }
  try {
    await disconnect();
  } catch {
    // ignore
  }
}
