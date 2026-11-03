"use client";
import { useState } from "react";
import { Modal } from "@/components/patterns/Modal";

export function MfaChallengeDialog({ onVerify, onCancel }: { onVerify: (code: string) => Promise<void>; onCancel: () => void }) {
  const [code, setCode] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  return <Modal open onOpenChange={(open) => { if (!open && !busy) onCancel(); }} title="Verify your sign-in" description="Enter an authenticator code or an unused backup code. This request expires after five minutes.">
    <form className="ui-page" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(""); try { await onVerify(code.trim()); } catch (e) { setError(e instanceof Error ? e.message : "Verification failed"); } finally { setBusy(false); } }}>
      <label className="ui-field">Verification code<input className="ui-input" autoComplete="one-time-code" autoFocus required minLength={6} maxLength={32} value={code} onChange={(e) => setCode(e.target.value)} /></label>
      {error && <p role="alert" className="ui-note">{error}</p>}
      <div className="ui-actions"><button className="ui-button" disabled={busy || code.trim().length < 6}>{busy ? "Verifying…" : "Verify & sign in"}</button><button type="button" className="ui-button secondary" disabled={busy} onClick={onCancel}>Cancel</button></div>
    </form>
  </Modal>;
}
