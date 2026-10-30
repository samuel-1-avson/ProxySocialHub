"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import {
  WALLET_CONNECTION_ERROR_EVENT,
  clearManualSolanaWalletDisconnect,
  forceDisconnectSolanaWallet,
  formatWalletConnectionError,
} from "@/lib/solana-wallet-session";
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
 * Connect control with visible state for every adapter outcome.
 *
 * The raw WalletMultiButton swallows connect failures (its click handler
 * catches and relies on a console-only onError), and it renders no
 * affordance at all while connecting. This control owns the click, so a
 * failure always lands next to the button with a recovery action.
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
  const { setVisible } = useWalletModal();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Connect attempts started from the wallet modal do not pass through
  // handleConnect below; the provider republishes their failures here.
  useEffect(() => {
    const onError = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail
        ?.message;
      if (message) setError(message);
    };
    window.addEventListener(WALLET_CONNECTION_ERROR_EVENT, onError);
    return () =>
      window.removeEventListener(WALLET_CONNECTION_ERROR_EVENT, onError);
  }, []);

  // A successful connection makes any earlier failure stale.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (connected) setError("");
  }, [connected]);

  const connectedAddress = publicKey?.toBase58() ?? null;
  const linked = (linkedAddress || "").trim();
  const matching = Boolean(
    linked && connectedAddress && connectedAddress === linked,
  );
  const differentWallet = Boolean(connected && linked && !matching);
  const hasInstalledWallet = wallets.some(
    (entry) => entry.readyState === WalletReadyState.Installed,
  );

  const handleConnect = async () => {
    clearManualSolanaWalletDisconnect();
    setError("");
    if (!wallet) {
      setVisible(true);
      return;
    }
    try {
      await connect();
    } catch (err) {
      setError(formatWalletConnectionError(err));
    }
  };

  const handleChooseWallet = () => {
    clearManualSolanaWalletDisconnect();
    setError("");
    setVisible(true);
  };

  const handleDisconnect = async () => {
    setBusy(true);
    setError("");
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
    setVisible(true);
  };

  if (connecting) {
    return (
      <div className="wallet-connect-control">
        <div className="ui-actions">
          <button className="ui-button wallet-connect-button" disabled>
            Connecting…
          </button>
          <button
            className="ui-button secondary"
            disabled={busy}
            onClick={() => void handleDisconnect()}
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
            onClick={handleChooseWallet}
          >
            Choose wallet
          </button>
        </div>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
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
            onClick={handleChooseWallet}
          >
            Choose wallet
          </button>
        )}
      </div>
      {!hasInstalledWallet && (
        <p className="ui-note">
          No Solana wallet was detected in this browser. Install Phantom or
          Solflare, unlock it, then click Connect wallet.
        </p>
      )}
      {hasInstalledWallet && wallet && (
        <p className="ui-note">
          {wallet.adapter.name} is selected. Click Connect wallet and approve
          the request in the extension.
        </p>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
