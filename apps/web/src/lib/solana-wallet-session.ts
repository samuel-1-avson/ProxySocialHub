/** Raised by clearSolanaWalletAdapterSession() once storage is cleared. */
export const WALLET_SESSION_CLEAR_EVENT = 'proxyhubb:wallet-session-clear';
/** Raised by logout() after it has cleared the wallet session. */
export const AUTH_LOGOUT_EVENT = 'proxyhubb:auth-logout';

/**
 * Disconnect the wallet when a session-clear or logout event fires.
 *
 * The handler must ONLY disconnect. It used to call clearSolanaWalletAdapterSession() first,
 * which dispatches WALLET_SESSION_CLEAR_EVENT, the event this handler listens for, so every
 * logout re-entered it until the call stack overflowed (RangeError) in the middle of the wallet
 * adapter's disconnect, leaving the adapter and Phantom disagreeing about the connection.
 * Whoever raises either event has already cleared storage.
 */
export function bindWalletSessionClear(opts: {
  isConnected: () => boolean;
  disconnect: () => Promise<void>;
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}): () => void {
  const target = opts.target ?? window;
  const onClear = () => {
    if (opts.isConnected()) {
      void opts.disconnect().catch(() => undefined);
    }
  };
  target.addEventListener(WALLET_SESSION_CLEAR_EVENT, onClear);
  target.addEventListener(AUTH_LOGOUT_EVENT, onClear);
  return () => {
    target.removeEventListener(WALLET_SESSION_CLEAR_EVENT, onClear);
    target.removeEventListener(AUTH_LOGOUT_EVENT, onClear);
  };
}

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
    window.dispatchEvent(new CustomEvent(WALLET_SESSION_CLEAR_EVENT));
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

/**
 * Turn a failure from the wallet's sign step into a message and a recovery decision.
 *
 * Phantom answers a sign request with the bare text "Unexpected error" when the app and the
 * extension disagree about the connection (the app still shows the wallet as connected, the
 * extension has dropped the app: after a disconnect, a switched account, a revoked permission).
 * Retrying the same click cannot fix that, so the caller should disconnect the wallet and ask
 * the user to connect it again. A user declining the request is not a fault and needs no reset.
 */
export function classifySignInError(
  err: unknown,
  fallback: string,
): { message: string; resetWallet: boolean } {
  const name = err instanceof Error ? err.name : '';
  const msg = (err instanceof Error ? err.message : typeof err === 'string' ? err : '').trim();

  if (/reject|denied|declin|cancel/i.test(msg)) {
    return { message: 'You cancelled the request in your wallet. Click sign in to try again.', resetWallet: false };
  }
  if (name === 'WalletSignMessageError' && (msg === '' || /^unexpected error\.?$/i.test(msg))) {
    return {
      message:
        'Your wallet could not sign the sign-in message (it reported "Unexpected error"). ' +
        'It has been disconnected so the connection can be set up again: connect it, then sign in.',
      resetWallet: true,
    };
  }
  return { message: msg || fallback, resetWallet: false };
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
