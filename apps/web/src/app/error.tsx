"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, Unplug } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);
  return (
    <main
      className="public-status error-status"
      id="main-content"
      tabIndex={-1}
    >
      <div className="public-status-icon">
        <Unplug size={38} aria-hidden="true" />
      </div>
      <p className="ui-eyebrow">Connection interrupted</p>
      <h1>This view couldn’t be loaded.</h1>
      <p>
        Try loading it again. If the issue continues, return home or contact
        support with the reference below.
      </p>
      {error.digest && (
        <code className="public-error-reference">
          Reference · {error.digest}
        </code>
      )}
      <div className="public-reading-actions">
        <button type="button" className="ui-button" onClick={reset}>
          <RefreshCw size={15} aria-hidden="true" />
          Try again
        </button>
        <Link href="/" className="ui-button secondary">
          <ArrowLeft size={15} aria-hidden="true" />
          Go home
        </Link>
        <Link href="/contact" className="ui-link">
          Contact support
        </Link>
      </div>
    </main>
  );
}
