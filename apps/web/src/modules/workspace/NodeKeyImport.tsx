import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { getListingProofPolicy } from "@/lib/api/marketplace";
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
 * Recovery panel for CLI-configured nodes: validates a pasted provider_signing_key
 * against the node hotkey and stores it per-node, exactly like Setup-wizard keys.
 */
export function NodeKeyImport({
  nodeId,
  nodeHotkey,
  onImported,
  busy,
}: {
  nodeId: string;
  nodeHotkey: string;
  onImported: () => void;
  busy?: boolean;
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
      <h3>This browser doesn&apos;t have this node&apos;s signing key</h3>
      <p className="ui-note">
        This node was configured outside this browser, so its key was never saved
        here. Paste the <code>provider_signing_key</code> value from your{
        } <code>provider.toml</code> to sign offers in this browser. The key stays
        in this browser&apos;s local storage, exactly as if the node had been
        configured here. Never share it.
      </p>
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

