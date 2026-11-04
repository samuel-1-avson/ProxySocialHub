import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  getListingProofPolicy,
  getNodeOfferSigner,
} from "@/lib/api/marketplace";
import {
  loadProviderSigningKey,
  saveProviderSigningKey,
} from "@/lib/provider-config";
import {
  publicKeyFromProviderSecret,
  resolveListingSigner,
  type ListingSignerKind,
} from "@/lib/proofs/listing-offer";

export interface ListingSignerState {
  signerKind: ListingSignerKind;
  needsProof: boolean;
  devicePending: boolean;
  policyReady: boolean;
  policyRequired: boolean;
  localSecret: string | null;
  walletHotkey: string;
  devServerSigning: boolean;
  refreshSecret: () => void;
}

/**
 * Shared listing-proof signer resolution for create (ListingEditor) and edit
 * (SellerListings EditOffer): same inputs, same precedence, one implementation.
 */
export function useListingSigner(
  nodeId: string | undefined,
  nodeHotkey: string,
): ListingSignerState {
  const wallet = useWallet();
  // Bumped after a key is saved so the next render re-reads storage.
  const [, setStorageTick] = useState(0);
  const policy = useQuery({
    queryKey: ["listing-proof-policy"],
    queryFn: getListingProofPolicy,
    staleTime: 60_000,
  });
  const localSecret = nodeId
    ? loadProviderSigningKey(nodeId, { allowLegacyFallback: false })
    : null;
  // The derived hotkey belongs to a key, not just a node: keying on the key
  // means a freshly saved key is derived on its own instead of reusing the
  // cached hotkey of the key it replaced.
  const deviceHotkeyQuery = useQuery({
    queryKey: ["device-hotkey", nodeId ?? "", localSecret ?? ""],
    queryFn: () => publicKeyFromProviderSecret(localSecret ?? ""),
    enabled: Boolean(localSecret),
    staleTime: Infinity,
    retry: false,
  });
  const deviceHotkey = deviceHotkeyQuery.data ?? "";
  const walletHotkey =
    wallet.connected && wallet.publicKey ? wallet.publicKey.toBase58() : "";
  const needsProof = Boolean(policy.data?.required || nodeHotkey);
  const signerKind = resolveListingSigner({
    hasSecret: Boolean(localSecret),
    deviceHotkey,
    nodeHotkey,
    walletConnected: wallet.connected,
    walletCanSign: Boolean(wallet.signMessage),
    walletHotkey,
    devServerSigning: policy.data?.dev_server_signing ?? false,
  });
  // isPending stays true for a disabled (no secret) query, which would hide the
  // recovery panel exactly when it is needed. Pending only while deriving.
  const devicePending = Boolean(localSecret) && deviceHotkeyQuery.isPending;
  return {
    signerKind,
    needsProof,
    devicePending,
    policyReady: policy.isSuccess,
    policyRequired: policy.data?.required ?? false,
    localSecret,
    walletHotkey,
    devServerSigning: policy.data?.dev_server_signing ?? false,
    refreshSecret: () => setStorageTick((tick) => tick + 1),
  };
}

/**
 * Whether the node is connected and asking for offers to sign. `listening` is undefined
 * until known (or when the check fails), so callers only act on a definite `false`.
 */
export function useNodeOfferSignerStatus(
  nodeId: string | undefined,
  enabled: boolean,
): { listening: boolean | undefined } {
  const signer = useQuery({
    queryKey: ["node-offer-signer", nodeId ?? ""],
    queryFn: () => getNodeOfferSigner(nodeId ?? ""),
    enabled: Boolean(nodeId) && enabled,
    refetchInterval: 10_000,
    retry: false,
  });
  return { listening: signer.data?.listening };
}

/**
 * Says up front that the node itself will sign the offer, and whether it is connected to do
 * so right now. The node holds provider_signing_key, so nothing has to be pasted here.
 */
export function NodeSignerNote({
  nodeName,
  listening,
}: {
  nodeName: string;
  listening: boolean | undefined;
}) {
  if (listening === false) {
    return (
      <p className="ui-note" role="status">
        Offer signature: <strong>{nodeName}</strong> signs this offer with its own
        key when you publish, but it is not connected right now. Start the ProxyHubb
        app (or <code>provider-node</code>) on that computer and keep it running. It
        needs version 1.0.13 or newer.
      </p>
    );
  }
  return (
    <p className="ui-note" role="status">
      Offer signature: <strong>{nodeName}</strong> signs this offer with its own key
      when you publish{listening ? " (connected)" : ""}. There is no key to copy or
      paste.
    </p>
  );
}

// Where provider-node keeps provider.toml (services/provider-node/src/paths.rs).
const PROVIDER_TOML_LOCATIONS = [
  ["Windows", "%APPDATA%\\proxyhubb\\provider.toml"],
  ["macOS", "~/Library/Application Support/proxyhubb/provider.toml"],
  ["Linux", "~/.config/proxyhubb/provider.toml"],
] as const;

/**
 * Recovery panel: validates a pasted provider_signing_key against the node hotkey and
 * stores it per-node, exactly like Setup-wizard keys. Normally the node signs offers
 * itself; with `fallback` this is the way out when it could not.
 */
export function NodeKeyImport({
  nodeId,
  nodeHotkey,
  onImported,
  busy,
  fallback,
}: {
  nodeId: string;
  nodeHotkey: string;
  onImported: () => void;
  busy?: boolean;
  fallback?: boolean;
}) {
  const [importKey, setImportKey] = useState("");
  const [importError, setImportError] = useState("");
  const [importDone, setImportDone] = useState("");

  async function importSigningKey() {
    setImportError("");
    setImportDone("");
    const pasted = importKey.trim();
    if (!pasted) return;
    let derived = "";
    try {
      derived = await publicKeyFromProviderSecret(pasted);
    } catch {
      setImportError(
        "That key could not be read. Paste the full provider_signing_key value from provider.toml.",
      );
      return;
    }
    if (nodeHotkey && derived !== nodeHotkey) {
      setImportError(
        `That key belongs to ${derived.slice(0, 4)}...${derived.slice(-4)}, not this node.`
      );
      return;
    }
    saveProviderSigningKey(pasted, nodeId);
    setImportKey("");
    setImportDone(
      `Saved. This browser can now sign for ${derived.slice(0, 4)}...${derived.slice(-4)}. Continue when ready.`
    );
    onImported();
  }

  return (
    <section className="ui-attention" aria-label="Node signing key needed">
      {fallback ? (
        <>
          <h3>Or sign here with the node&apos;s signing key</h3>
          <p className="ui-note">
            Starting the node (version 1.0.13 or newer) and publishing again is the
            easy way. If that is not possible, paste the{" "}
            <code>provider_signing_key</code> value from the node&apos;s{" "}
            <code>provider.toml</code>. The key stays in this browser&apos;s local
            storage. Never share it.
          </p>
        </>
      ) : (
        <>
          <h3>This browser doesn&apos;t have this node&apos;s signing key</h3>
          <p className="ui-note">
            This node was configured outside this browser, so its key was never
            saved here. Paste the <code>provider_signing_key</code> value from your{" "}
            <code>provider.toml</code> to sign offers in this browser. The key
            stays in this browser&apos;s local storage. Never share it.
          </p>
        </>
      )}
      <details className="ui-note">
        <summary>Where is provider.toml?</summary>
        <ul>
          {PROVIDER_TOML_LOCATIONS.map(([os, path]) => (
            <li key={os}>
              {os}: <code>{path}</code>
            </li>
          ))}
        </ul>
        On Windows, paste the path into the File Explorer address bar, open the
        file with Notepad and copy the text between the quotes on the{" "}
        <code>provider_signing_key</code> line.
      </details>
      {nodeHotkey && (
        <p className="ui-note">
          Node hotkey: <code>{nodeHotkey}</code>
        </p>
      )}
      <label className="ui-field">
        Node signing key
        <input
          className="ui-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={importKey}
          onChange={(e) => setImportKey(e.target.value)}
          onKeyDown={(e) => {
            // This panel can sit inside the edit form; Enter saves the key,
            // not the offer.
            if (e.key === "Enter") {
              e.preventDefault();
              if (importKey.trim() && !busy) void importSigningKey();
            }
          }}
          placeholder="Paste provider_signing_key from provider.toml"
        />
      </label>
      {importError && (
        <p className="ui-note" role="alert">
          {importError}
        </p>
      )}
      {importDone && (
        <p className="ui-note" role="status">
          {importDone}
        </p>
      )}
      <div className="ui-actions">
        <button
          type="button"
          className="ui-button secondary"
          disabled={!importKey.trim() || busy}
          onClick={() => void importSigningKey()}
        >
          Save key in this browser
        </button>
      </div>
    </section>
  );
}

