"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

/** A command box with a copy icon at its end. */
export function CommandBlock({
  label,
  command,
  disabled = false,
  copiedMessage,
}: {
  label: string;
  command: string;
  disabled?: boolean;
  /** Shown after a successful copy; defaults to "<label> copied." */
  copiedMessage?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  async function copy() {
    setError("");
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      setError("Clipboard unavailable. Select the command and copy it.");
    }
  }
  return (
    <div className="ui-code-block">
      <pre className="ui-code">{command}</pre>
      <button
        type="button"
        className="ui-code-copy"
        onClick={() => void copy()}
        disabled={disabled}
        aria-label={"Copy " + label}
        title={copied ? "Copied" : "Copy"}
      >
        {copied ? (
          <Check size={15} aria-hidden="true" />
        ) : (
          <Copy size={15} aria-hidden="true" />
        )}
      </button>
      {copiedMessage ? (
        copied && (
          <p className="ui-code-feedback" role="status">
            {copiedMessage}
          </p>
        )
      ) : (
        <span className="sr-only" role="status">
          {copied ? `${label} copied.` : ""}
        </span>
      )}
      {error && (
        <p className="ui-code-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
