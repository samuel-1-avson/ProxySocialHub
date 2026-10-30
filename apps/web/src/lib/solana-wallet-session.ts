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

const LAST_WALLET_NAME_KEY = 'proxyhubb:wallet-name';

/**
 * Remember the wallet the user actually connected with (sign-in, linking, or
 * any successful connection) under our own storage key.
 *
 * The adapter library keeps its own `walletName` key and deletes it whenever
 * a silent reconnect fails, which used to strand the workspace with no
 * selected wallet even though the user had just signed in with one. This
 * record survives that, so the workspace can restore the same wallet.
 */
export function rememberConnectedWalletName(name: string | null | undefined): void {
  if (typeof window === 'undefined' || !name) return;
  try {
    window.localStorage.setItem(LAST_WALLET_NAME_KEY, name);
  } catch {
    // ignore
  }
}

export function readRememberedWalletName(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(LAST_WALLET_NAME_KEY);
  } catch {
    return null;
  }
}

export function forgetRememberedWalletName(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LAST_WALLET_NAME_KEY);
  } catch {
    // ignore
  }
}

/**
 * Decide which wallet auto-reconnect may pick when none is selected.
 *
 * The wallet used at sign-in wins whenever it is installed. Otherwise only
 * an unambiguous single installed wallet may be picked; guessing between
 * several installed wallets could connect the wrong account, so the user
 * chooses in the picker instead. Loadable web wallets are never picked.
 */
export function pickAutoReconnectWallet(
  entries: { name: string; readyState: string }[],
  rememberedName: string | null,
): string | null {
  const installed = entries.filter((entry) => entry.readyState === 'Installed');
  if (
    rememberedName &&
    installed.some((entry) => entry.name === rememberedName)
  ) {
    return rememberedName;
  }
  return installed.length === 1 ? installed[0].name : null;
}

/** Raised when a wallet connection attempt fails so the UI can show it. */
export const WALLET_CONNECTION_ERROR_EVENT = 'proxyhubb:wallet-connection-error';

/**
 * Turn a wallet connection failure into an actionable message.
 *
 * Connection errors used to be logged to the console only, so the Connect
 * button appeared to do nothing. Every failure path must surface one of
 * these messages next to the control that started the attempt.
 */
export function formatWalletConnectionError(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  const msg = (err instanceof Error ? err.message : typeof err === 'string' ? err : '').trim();
  const lower = `${name} ${msg}`.toLowerCase();

  if (/reject|denied|declin|cancel|4001/.test(lower)) {
    return 'You declined the request in your wallet. Click Connect wallet to try again.';
  }
  if (/not ready|not detected|not installed|no wallet|walletnotready/.test(lower)) {
    return 'No Solana wallet was found in this browser. Install Phantom or Solflare, unlock it, then click Connect wallet.';
  }
  if (/not authorized|not been authorized|unlock/.test(lower)) {
    return 'Your wallet is locked or this site is not approved in it yet. Unlock your wallet, click Connect wallet, and approve the connection in the extension.';
  }
  if (/disconnect/.test(lower)) {
    return 'Your wallet disconnected. Click Connect wallet to reconnect it.';
  }
  return msg || 'Wallet connection failed. Check your wallet extension and try again.';
}

/** Broadcast a connection failure so mounted connect controls can display it. */
export function emitWalletConnectionError(err: unknown): void {
  if (typeof window === 'undefined') return;
  // A disconnect the user asked for is not a connection failure to report.
  const name = err instanceof Error ? err.name : '';
  if (/Disconnected|Disconnection/.test(name)) return;
  try {
    window.dispatchEvent(
      new CustomEvent(WALLET_CONNECTION_ERROR_EVENT, {
        detail: { message: formatWalletConnectionError(err) },
      }),
    );
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
