"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "@/lib/auth";
import { deleteAccount } from "@/lib/services/profile";
import { signDeleteAccountMessage } from "@/lib/solana-message-sign";
import { getErrorMessage } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/patterns/ConfirmDialog";

const CONFIRM_PHRASE = "DELETE MY ACCOUNT";

export function DeleteAccountPanel() {
  const { user, logout } = useAuth();
  const { signMessage, publicKey, connected } = useWallet();
  const [showModal, setShowModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setError("");
    try {
      let nonce: string | undefined;
      let signature: string | undefined;

      if (user?.wallet_address) {
        if (!signMessage || !connected || !publicKey) {
          setError(
            "Connect the Solana wallet linked to your account to sign the deletion request."
          );
          return;
        }
        if (publicKey.toBase58() !== user.wallet_address) {
          setError("Connected wallet does not match your linked account address.");
          return;
        }
        const signed = await signDeleteAccountMessage(signMessage);
        nonce = signed.nonce;
        signature = signed.signature;
      }

      await deleteAccount(CONFIRM_PHRASE, { nonce, signature });
      setShowModal(false);
      await logout();
      window.location.href = "/";
    } catch (err) {
      setError(getErrorMessage(err) || "Failed to schedule account deletion");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Card className="space-y-4 border-[color-mix(in_srgb,var(--destructive)_30%,var(--border))] bg-[color-mix(in_srgb,var(--destructive)_6%,transparent)]">
        <div className="flex items-start gap-3">
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-[var(--destructive)]"
            aria-hidden
          />
          <div>
            <h3 className="text-sm font-semibold text-foreground">Delete account</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Permanently removes node configurations, credentials, and schedules profile
              deletion. This cannot be undone.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="danger"
          onClick={() => {
            setError("");
            setShowModal(true);
          }}
        >
          Request account deletion
        </Button>
      </Card>

      <ConfirmDialog
        open={showModal}
        onOpenChange={setShowModal}
        title="Delete your account"
        description="This removes active node configurations, wallet credentials, and schedules profile deletion."
        confirmPhrase={CONFIRM_PHRASE}
        confirmLabel={deleting ? "Deleting…" : "Delete account"}
        destructive
        loading={deleting}
        error={error}
        onConfirm={handleDeleteAccount}
      >
        {user?.wallet_address ? (
          <p className="text-sm text-muted-foreground">
            A wallet signature is required. Connect your linked wallet before confirming.
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
