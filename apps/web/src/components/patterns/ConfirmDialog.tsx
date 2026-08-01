"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "@/components/patterns/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Body content below the description (consequences list, etc.) */
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When set, user must type this exact string to enable confirm */
  confirmPhrase?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  error?: string;
}

/**
 * Confirmation / destructive-action dialog — reconstruction plan §14.2 / §19.2.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmPhrase,
  destructive = false,
  loading = false,
  onConfirm,
  error,
}: ConfirmDialogProps) {
  const [phrase, setPhrase] = useState("");
  const phraseOk = !confirmPhrase || phrase === confirmPhrase;

  const handleOpenChange = (next: boolean) => {
    if (!next) setPhrase("");
    onOpenChange(next);
  };

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? "danger" : "primary"}
            disabled={!phraseOk || loading}
            isLoading={loading}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {destructive ? (
          <div
            className="flex gap-3 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--destructive)_35%,var(--border))] bg-[color-mix(in_srgb,var(--destructive)_8%,transparent)] p-3 text-sm text-foreground"
            role="note"
          >
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--destructive)]"
              aria-hidden
            />
            <span>This action cannot be easily undone. Review carefully before confirming.</span>
          </div>
        ) : null}

        {children}

        {confirmPhrase ? (
          <div className="space-y-2">
            <label
              htmlFor="confirm-phrase"
              className="block text-xs text-muted-foreground"
            >
              Type <span className="font-mono font-semibold text-foreground">{confirmPhrase}</span>{" "}
              to confirm
            </label>
            <Input
              id="confirm-phrase"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder={confirmPhrase}
              autoComplete="off"
              className="font-mono"
              aria-invalid={phrase.length > 0 && !phraseOk}
            />
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-[var(--destructive)]" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
