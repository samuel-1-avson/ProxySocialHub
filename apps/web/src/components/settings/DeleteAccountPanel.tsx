"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "@/lib/auth";
import { deleteAccount } from "@/lib/services/profile";
import { signDeleteAccountMessage } from "@/lib/solana-message-sign";
import { getErrorMessage } from "@/lib/utils";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const CONFIRM_PHRASE = "DELETE MY ACCOUNT";

export function DeleteAccountPanel() {
    const { user, logout } = useAuth();
    const { signMessage, publicKey, connected } = useWallet();
    const [showModal, setShowModal] = useState(false);
    const [confirmationText, setConfirmationText] = useState("");
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState("");

    const handleDeleteAccount = async () => {
        if (confirmationText !== CONFIRM_PHRASE) return;
        setDeleting(true);
        setError("");
        try {
            let nonce: string | undefined;
            let signature: string | undefined;

            if (user?.wallet_address) {
                if (!signMessage || !connected || !publicKey) {
                    setError("Connect the Solana wallet linked to your account to sign the deletion request.");
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
            <GlassCard className="p-8 border-rose-500/20 bg-rose-500/5 space-y-4">
                <div className="flex items-start gap-3">
                    <AlertTriangle className="text-rose-500 shrink-0 mt-0.5" size={20} />
                    <div>
                        <h3 className="text-sm font-black font-mono uppercase tracking-tight text-rose-400">
                            Delete account
                        </h3>
                        <p className="text-[10px] font-mono text-muted-foreground uppercase leading-relaxed mt-2 opacity-80">
                            Permanently removes node configurations, credentials, and schedules profile deletion.
                            This cannot be undone.
                        </p>
                    </div>
                </div>
                <Button
                    type="button"
                    onClick={() => {
                        setConfirmationText("");
                        setError("");
                        setShowModal(true);
                    }}
                    className="h-11 px-6 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black font-mono text-[10px] uppercase tracking-widest"
                >
                    Request account deletion
                </Button>
            </GlassCard>

            {showModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                    <div className="bg-neutral-950 w-full max-w-md border border-rose-500/30 p-8 rounded-3xl space-y-6 shadow-2xl">
                        <div className="flex items-center justify-between pb-4 border-b border-white/5">
                            <h3 className="text-lg font-black font-mono uppercase tracking-tight text-rose-500 flex items-center gap-2">
                                <AlertTriangle size={20} /> Terminal termination
                            </h3>
                            <button
                                type="button"
                                onClick={() => setShowModal(false)}
                                className="text-muted-foreground hover:text-white transition-colors"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex gap-3 text-rose-500 text-[10px] font-mono uppercase font-black">
                            <AlertTriangle size={16} className="shrink-0" />
                            <span>
                                This action deletes all active node configurations, wallet credentials, and schedules
                                profile deletion.
                            </span>
                        </div>

                        {user?.wallet_address && (
                            <p className="text-[10px] font-mono text-muted-foreground uppercase">
                                A wallet signature is required. Connect your linked wallet before confirming.
                            </p>
                        )}

                        {error && (
                            <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-[10px] font-mono rounded-xl">
                                {error}
                            </div>
                        )}

                        <div className="space-y-4">
                            <label className="block text-[10px] font-black font-mono uppercase tracking-wider text-muted-foreground leading-relaxed">
                                Type <span className="text-rose-500 font-bold font-mono">{CONFIRM_PHRASE}</span> below
                                to confirm.
                            </label>
                            <Input
                                value={confirmationText}
                                onChange={(e) => setConfirmationText(e.target.value)}
                                placeholder={CONFIRM_PHRASE}
                                className="h-14 bg-black/60 border-rose-500/30 rounded-xl font-mono text-xs text-rose-500 focus:ring-rose-500/20 focus:border-rose-500/50"
                            />
                        </div>

                        <div className="flex gap-4 pt-2">
                            <Button
                                type="button"
                                onClick={() => setShowModal(false)}
                                className="flex-1 h-12 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-black font-mono text-[10px] uppercase tracking-widest"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                onClick={handleDeleteAccount}
                                disabled={confirmationText !== CONFIRM_PHRASE || deleting}
                                className="flex-1 h-12 bg-rose-600 hover:bg-rose-500 text-white font-black font-mono text-[10px] uppercase tracking-widest"
                            >
                                {deleting ? "TERMINATING..." : "CONFIRM TERMINATE"}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
