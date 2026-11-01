"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function copy() {
    setError("");
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
    } catch {
      setError("Clipboard unavailable. Select and copy the value manually.");
    }
  }
  return (
    <div className="reference-value">
      <div>
        <code>{value}</code>
        <button
          type="button"
          className="credential-icon-button"
          onClick={() => void copy()}
          aria-label={"Copy " + label}
        >
          {copied === value ? (
            <Check size={15} aria-hidden="true" />
          ) : (
            <Copy size={15} aria-hidden="true" />
          )}
        </button>
      </div>
      {copied === value && (
        <span className="sr-only" role="status">
          {label} copied.
        </span>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
