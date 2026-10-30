"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  WalletReadyState,
  type WalletName,
} from "@solana/wallet-adapter-base";
import {
  WALLET_CONNECTION_ERROR_EVENT,
  clearManualSolanaWalletDisconnect,
  forceDisconnectSolanaWallet,
  formatWalletConnectionError,
} from "@/lib/solana-wallet-session";
import { Modal } from "@/components/patterns/Modal";
import { shortWallet } from "@/components/UnlockWalletPrompt";

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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const pendingSince = useRef(0);

  // Connect attempts started elsewhere in the provider (auto-reconnect)
  // republish their failures here so they are never silent. Any failure
  // also releases a pending picker choice so the control cannot stick on
  // "Connecting" after the provider's own auto-connect attempt settled.
  useEffect(() => {
    const onError = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail
        ?.message;
      if (message) {
        setError(message);
        setPendingName(null);
      }
    };
    window.addEventListener(WALLET_CONNECTION_ERROR_EVENT, onError);
    return () =>
      window.removeEventListener(WALLET_CONNECTION_ERROR_EVENT, onError);
  }, []);

  // A successful connection makes any earlier failure stale and releases
  // any pending picker choice, so the control always leaves "Connecting".
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (connected) setError("");
    if (connected) setPendingName(null);
    if (connected) setPickerOpen(false);
  }, [connected]);

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
        setError(formatWalletConnectionError(new Error("Wallet not ready")));
      }
      return;
    }
    pendingSince.current = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingName(null);
    void connect().catch((err: unknown) => {
      setError(formatWalletConnectionError(err));
    });
  }, [pendingName, wallet, connected, connecting, connect]);

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
    setError("");
    if (
      !wallet ||
      (wallet.readyState !== WalletReadyState.Installed &&
        wallet.readyState !== WalletReadyState.Loadable)
    ) {
      setPickerOpen(true);
      return;
    }
    try {
      await connect();
    } catch (err) {
      setError(formatWalletConnectionError(err));
    }
  };

  const handlePick = (name: string) => {
    clearManualSolanaWalletDisconnect();
    setError("");
    setPickerOpen(false);
    if (wallet?.adapter.name === name) {
      void connect().catch((err: unknown) => {
        setError(formatWalletConnectionError(err));
      });
      return;
    }
    setPendingName(name);
    pendingSince.current = 0;
    select(name as WalletName);
  };

  // Cancel a pending connection attempt without marking a manual
  // disconnect, so automatic restore can still run afterwards.
  const handleCancel = () => {
    setPendingName(null);
    setPickerOpen(false);
    void disconnect().catch(() => {});
  };

  const handleDisconnect = async () => {
    setBusy(true);
    setError("");
    setPendingName(null);
    try {
      await forceDisconnectSolanaWallet({ disconnect, select });
    } catch {
      setError(
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
                ? " — this wallet cannot approve transactions, so deposits stay disabled. Choose a wallet that supports transaction approval."
                : " — ready to approve payments."
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
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {picker}
    </div>
  );
}
