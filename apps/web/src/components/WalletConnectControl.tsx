"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  WalletReadyState,
  type WalletName,
} from "@solana/wallet-adapter-base";
import {
  WALLET_CONNECTION_ERROR_EVENT,
  clearLastWalletError,
  clearManualSolanaWalletDisconnect,
  forceDisconnectSolanaWallet,
  formatWalletConnectionError,
  readLastWalletError,
  readRememberedWalletName,
  requestWalletSessionReset,
  shortWallet,
  writeLastWalletError,
} from "@/lib/solana-wallet-session";
import { Modal } from "@/components/patterns/Modal";


type Props = {
  /** Address saved to the account, if any. */
  linkedAddress?: string | null;
  /** Whether the connected wallet may be linked to the account. */
  canLink?: boolean;
  /** Link the currently connected wallet to the account. */
  onLink?: () => void;
  /** Parent is processing a link/unlink action. */
  processing?: boolean;
  /** Connected wallet can sign transactions (deposit approval). */
  signingReady?: boolean;
};

/** Production budget for one wallet connect attempt. */
const CONNECT_TIMEOUT_MS = 60_000;

/** Automated tests shorten the budget through this window flag. */
function connectTimeoutMs(): number {
  if (typeof window !== "undefined") {
    const override = (
      window as unknown as Record<string, unknown>
    ).__PROXYHUBB_WALLET_CONNECT_TIMEOUT_MS__;
    if (
      typeof override === "number" &&
      Number.isFinite(override) &&
      override >= 500
    ) {
      return override;
    }
  }
  return CONNECT_TIMEOUT_MS;
}

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Connect control with its own wallet picker and visible state for every
 * adapter outcome.
 *
 * The library wallet modal only selects a wallet and relies on an
 * auto-connect side effect to finish the job; when that chain stalls in a
 * real browser extension the click appears to do nothing, and the library
 * button swallows the failure. This control selects and connects in one
 * explicit flow, lists every discovered wallet (browser extensions plus
 * Wallet Standard wallets such as Phantom, Solflare, Backpack, OKX Wallet,
 * and Brave Wallet), and lands every failure next to the button.
 */
export function WalletConnectControl({
  linkedAddress,
  canLink = false,
  onLink,
  processing = false,
  signingReady,
}: Props) {
  const {
    connected,
    connecting,
    publicKey,
    wallet,
    wallets,
    select,
    connect,
    disconnect,
  } = useWallet();
  // The last error survives adapter-session resets (which remount this
  // control), so a reset never wipes the message explaining it.
  const [error, setError] = useState(() => readLastWalletError() ?? "");
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const pendingSince = useRef(0);
  const connectedRef = useRef(connected);
  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  const reportError = (message: string) => {
    setError(message);
    writeLastWalletError(message);
  };

  const clearError = () => {
    setError("");
    clearLastWalletError();
  };

  // Connect attempts started elsewhere in the provider (auto-reconnect)
  // republish their failures here so they are never silent. Any failure
  // also releases a pending picker choice so the control cannot stick on
  // "Connecting" after the provider's own auto-connect attempt settled.
  useEffect(() => {
    const onError = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail
        ?.message;
      if (message) {
        reportError(message);
        setPendingName(null);
      }
    };
    window.addEventListener(WALLET_CONNECTION_ERROR_EVENT, onError);
    return () =>
      window.removeEventListener(WALLET_CONNECTION_ERROR_EVENT, onError);
  }, []);

  // Watchdog: a connect attempt can hang forever (wedged extension,
  // unanswered approval), which also wedges later attempts into silent
  // no-ops. Whatever started it, a stuck "connecting" state always ends
  // here with a visible error and a clean adapter session for the retry.
  useEffect(() => {
    if (!connecting || connected) return;
    const budget = connectTimeoutMs();
    const timer = setTimeout(() => {
      if (connectedRef.current) return;
      console.debug("[wallet] connect watchdog timed out");
      requestWalletSessionReset();
      reportError(
        formatWalletConnectionError(
          new Error(
            "Wallet connection timed out waiting for the wallet to respond.",
          ),
        ),
      );
    }, budget);
    return () => clearTimeout(timer);
  }, [connecting, connected]);

  // A successful connection makes any earlier failure stale and releases
  // any pending picker choice, so the control always leaves "Connecting".
  useEffect(() => {
    if (!connected) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    clearError();
    setPendingName(null);
    setPickerOpen(false);
  }, [connected]);

  /**
   * Connect with a budget and a settle check. Adapter connects can hang
   * forever (wedging later attempts into silent no-ops) or resolve without
   * connecting at all when an earlier attempt wedged the shared adapter
   * flags. Only a confirmed connection counts; anything else resets the
   * adapter session so the next attempt starts from clean flags, and the
   * failure stays visible.
   */
  const attemptConnect = async (label: string) => {
    let outcome: "connected" | "failed" = "failed";
    try {
      await connect();
    } catch (err) {
      // A real rejection leaves clean flags; surface it without churning
      // the adapter session.
      console.debug(`[wallet] ${label} failed`, err);
      reportError(formatWalletConnectionError(err));
      return outcome;
    }
    // A resolved connect is only real if the provider actually connected;
    // adapters resolve silently when a previous attempt wedged them.
    await sleep(500);
    if (connectedRef.current) {
      outcome = "connected";
    } else {
      console.debug(`[wallet] ${label} resolved without connecting`);
      requestWalletSessionReset();
      reportError(
        formatWalletConnectionError(
          new Error("Wallet connection did not respond."),
        ),
      );
    }
    return outcome;
  };

  // Finish a picker choice: selection is applied asynchronously by the
  // provider, so connect once the chosen wallet becomes the selected one.
  // A browser extension can also report "not detected" for a moment after
  // selection; wait for its detection to settle instead of failing fast.
  useEffect(() => {
    if (!pendingName || connected || connecting) return;
    if (wallet?.adapter.name !== pendingName) return;
    if (
      wallet.readyState !== WalletReadyState.Installed &&
      wallet.readyState !== WalletReadyState.Loadable
    ) {
      if (pendingSince.current === 0) pendingSince.current = Date.now();
      if (Date.now() - pendingSince.current > 20000) {
        setPendingName(null);
        reportError(formatWalletConnectionError(new Error("Wallet not ready")));
      }
      return;
    }
    pendingSince.current = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingName(null);
    console.debug(`[wallet] connecting picked wallet ${pendingName}`);
    void attemptConnect(`picked wallet ${pendingName}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingName, wallet, connected, connecting, connect]);

  const rememberedName = readRememberedWalletName();
  const connectedAddress = publicKey?.toBase58() ?? null;
  const linked = (linkedAddress || "").trim();
  const matching = Boolean(
    linked && connectedAddress && connectedAddress === linked,
  );
  const differentWallet = Boolean(connected && linked && !matching);
  const installedNames = wallets
    .filter((entry) => entry.readyState === WalletReadyState.Installed)
    .map((entry) => entry.adapter.name);
  const pickerWallets = [...wallets].sort((a, b) => {
    const rank = (state: WalletReadyState) =>
      state === WalletReadyState.Installed
        ? 0
        : state === WalletReadyState.Loadable
          ? 1
          : 2;
    return rank(a.readyState) - rank(b.readyState);
  });

  const handleConnect = async () => {
    clearManualSolanaWalletDisconnect();
    clearError();
    if (
      !wallet ||
      (wallet.readyState !== WalletReadyState.Installed &&
        wallet.readyState !== WalletReadyState.Loadable)
    ) {
      setPickerOpen(true);
      return;
    }
    await attemptConnect(`connect ${wallet.adapter.name}`);
  };

  const handlePick = (name: string) => {
    clearManualSolanaWalletDisconnect();
    console.debug(`[wallet] picked ${name}`);
    clearError();
    setPickerOpen(false);
    if (wallet?.adapter.name === name) {
      void attemptConnect(`picked wallet ${name}`);
      return;
    }
    setPendingName(name);
    pendingSince.current = 0;
    select(name as WalletName);
  };

  // Cancel a stuck connection attempt and reset to a clean state: drop the
  // pending choice, close the picker, and fully disconnect the adapter so a
  // hung provider-level attempt cannot swallow the next click. Picking a
  // wallet again clears the manual-disconnect mark.
  const handleCancel = () => {
    setPendingName(null);
    setPickerOpen(false);
    console.debug("[wallet] connect cancelled by user");
    requestWalletSessionReset();
    void forceDisconnectSolanaWallet({ disconnect, select }).catch(() => {});
  };

  const handleDisconnect = async () => {
    setBusy(true);
    clearError();
    setPendingName(null);
    try {
      await forceDisconnectSolanaWallet({ disconnect, select });
    } catch {
      reportError(
        "Disconnect failed. Open your wallet extension and disconnect this site, then try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleReconnectLinked = async () => {
    await handleDisconnect();
    setPickerOpen(true);
  };

  const picker = (
    <Modal
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      title="Choose a wallet"
      description="Pick the Solana wallet you signed in with. It stays connected for deposits, withdrawals, and order payments."
    >
      <div className="wallet-picker-list">
        {pickerWallets.map((entry) => {
          const installed =
            entry.readyState === WalletReadyState.Installed;
          return (
            <button
              key={entry.adapter.name}
              type="button"
              className="ui-button secondary wallet-picker-option"
              onClick={() => handlePick(entry.adapter.name)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={entry.adapter.icon}
                alt=""
                width={24}
                height={24}
              />
              <span>{entry.adapter.name}</span>
              <span className="ui-note">
                {installed
                  ? "Detected"
                  : entry.readyState === WalletReadyState.Loadable
                    ? "Web wallet"
                    : "Not detected"}
              </span>
            </button>
          );
        })}
      </div>
      {!installedNames.length && (
        <p className="ui-note">
          No Solana wallet was detected in this browser. Install a Solana
          wallet such as Phantom, Solflare, Backpack, OKX Wallet, or Brave
          Wallet, unlock it, then choose it here.
        </p>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );

  if (connecting || pendingName) {
    return (
      <div className="wallet-connect-control">
        <div className="ui-actions">
          <button className="ui-button wallet-connect-button" disabled>
            Connecting…
          </button>
          <button
            className="ui-button secondary"
            disabled={busy}
            onClick={handleCancel}
          >
            Cancel
          </button>
        </div>
        <p className="ui-note" role="status">
          Check your wallet extension and approve the connection request. If
          no request appeared, unlock the wallet and try again.
        </p>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
        {picker}
      </div>
    );
  }

  if (connected && connectedAddress) {
    return (
      <div className="wallet-connect-control">
        {differentWallet ? (
          <p className="ui-attention" role="status">
            A different wallet is connected. Connected:{" "}
            <code title={connectedAddress}>
              {shortWallet(connectedAddress)}
            </code>{" "}
            · Linked: <code title={linked}>{shortWallet(linked)}</code>.
            Reconnect with your linked wallet, or link this wallet instead.
          </p>
        ) : (
          <p className="ui-note" role="status">
            Wallet connected:{" "}
            <code title={connectedAddress}>
              {shortWallet(connectedAddress)}
            </code>
            {matching
              ? signingReady === false
                ? ". This wallet cannot approve transactions, so deposits stay disabled. Choose a wallet that supports transaction approval."
                : ". Ready to approve payments."
              : ""}
          </p>
        )}
        <div className="ui-actions">
          {differentWallet && (
            <button
              className="ui-button wallet-connect-button"
              disabled={busy || processing}
              onClick={() => void handleReconnectLinked()}
            >
              Disconnect &amp; reconnect
            </button>
          )}
          {!matching && canLink && onLink && (
            <button
              className="ui-button"
              disabled={busy || processing}
              onClick={onLink}
            >
              Link this wallet
            </button>
          )}
          <button
            className="ui-button secondary"
            disabled={busy || processing}
            onClick={() => void handleDisconnect()}
          >
            {busy ? "Disconnecting…" : "Disconnect wallet"}
          </button>
          <button
            className="ui-button secondary"
            disabled={busy || processing}
            onClick={() => setPickerOpen(true)}
          >
            Choose wallet
          </button>
        </div>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
        {picker}
      </div>
    );
  }

  return (
    <div className="wallet-connect-control">
      <div className="ui-actions">
        <button
          className="ui-button wallet-connect-button"
          disabled={busy || processing}
          onClick={() => void handleConnect()}
        >
          Connect wallet
        </button>
        {wallet && (
          <button
            className="ui-button secondary"
            disabled={busy || processing}
            onClick={() => setPickerOpen(true)}
          >
            Choose wallet
          </button>
        )}
      </div>
      {installedNames.length ? (
        <p className="ui-note">
          Detected: {installedNames.join(", ")}. The wallet you signed in
          with reconnects automatically; connect once here if it has not.
        </p>
      ) : (
        <p className="ui-note">
          No Solana wallet was detected in this browser. Install Phantom,
          Solflare, Backpack, OKX Wallet, or Brave Wallet, unlock it, then
          click Connect wallet.
        </p>
      )}
      <p className="ui-note" data-testid="wallet-diagnostics">
        Selected: {wallet?.adapter.name ?? "none"} · Saved:{" "}
        {rememberedName ?? "none"}
        {error ? " · Last error shown above" : ""}
      </p>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {picker}
    </div>
  );
}
