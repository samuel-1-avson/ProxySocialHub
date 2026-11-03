"use client";

import { useState } from "react";
import { AlertTriangle, Download } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "@/lib/auth";
import { deleteAccount, exportAccountData } from "@/lib/services/profile";
import { signDeleteAccountMessage } from "@/lib/solana-message-sign";
import { getErrorMessage } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/patterns/ConfirmDialog";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { apiGet, apiPost } from "@/lib/api/client";
import { useQuery } from "@tanstack/react-query";

const CONFIRM_PHRASE = "DELETE MY ACCOUNT";

export function DataExportPanel() {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  const handleExport = async () => {
    setExporting(true);
    setError("");
    try {
      const blob = await exportAccountData();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `proxyhubb-export-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(getErrorMessage(err) || "Failed to download your data");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Download your data</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Downloads your account, privacy settings, transactions, messages, social contributions, and security history. The archive includes a data inventory and excludes usable secrets.
        </p>
      </div>
      {error ? <p className="text-sm text-[var(--destructive)]">{error}</p> : null}
      <Button type="button" variant="outline" onClick={() => void handleExport()} disabled={exporting}>
        <Download className="mr-2 h-4 w-4" aria-hidden />
        {exporting ? "Preparing…" : "Download my data"}
      </Button>
    </Card>
  );
}

export function DeleteAccountPanel() {
  const { user, logout } = useAuth();
  const { signMessage, publicKey, connected } = useWallet();
  const [showModal, setShowModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const [credential, setCredential] = useState("");
  const [code, setCode] = useState("");
  const deletion = useQuery({ queryKey:["account-deletion",user?.id], queryFn:()=>apiGet<{scheduled_deletion_at:string|null;restriction_reason?:string}>("/v1/gdpr/deletion"), enabled:!!user });
  const mfa = useQuery({queryKey:["mfa-status",user?.id],queryFn:()=>apiGet<{enabled:boolean}>("/v1/security/mfa/status"),enabled:!!user});

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setError("");
    try {
      let nonce: string | undefined;
      let signature: string | undefined;

      if (user?.managed_wallet?.address) {
        if (!credential) { setError("Confirm with your linked Google account first."); return; }
      } else if (user?.wallet_address) {
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

      await deleteAccount(CONFIRM_PHRASE, { nonce, signature, google_credential:credential || undefined, code:code || undefined });
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
              Schedules deletion after 30 days and hides your public profile and map presence now. Settle active services and funds first. Required payment records and public blockchain history remain. Managed wallet keys are destroyed only after empty-wallet verification; funds sent after closure may be unrecoverable.
            </p>
          </div>
        </div>
        {deletion.data?.scheduled_deletion_at && <div><p role="status">Deletion scheduled: {new Date(deletion.data.scheduled_deletion_at).toLocaleDateString()}</p><Button variant="outline" onClick={async()=>{try{await apiPost("/v1/gdpr/deletion/cancel",{});await deletion.refetch();}catch(err){setError(getErrorMessage(err));}}}>Cancel scheduled deletion</Button></div>}
        {deletion.data?.restriction_reason && <p role="status">{deletion.data.restriction_reason}</p>}
        {error && !showModal && <p role="alert">{error}</p>}
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
        description="Deletion has a 30-day grace period. Signing in or cancelling before the due date stops it. Public chain records cannot be erased."
        confirmPhrase={CONFIRM_PHRASE}
        confirmLabel={deleting ? "Deleting…" : "Delete account"}
        destructive
        loading={deleting}
        error={error}
        onConfirm={handleDeleteAccount}
      >
        {user?.managed_wallet?.address ? <div><GoogleSignInButton onCredential={(value)=>{setCredential(value);setError("");}} />{credential && <p role="status">Google confirmation received.</p>}</div> : user?.wallet_address ? (
          <p className="text-sm text-muted-foreground">
            A wallet signature is required. Connect your linked wallet before confirming.
          </p>
        ) : null}
        {mfa.data?.enabled && <label>Authenticator or backup code<input className="ui-input" value={code} onChange={(e)=>setCode(e.target.value)} autoComplete="one-time-code" maxLength={32} /></label>}
      </ConfirmDialog>
    </>
  );
}
