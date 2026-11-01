"use client";

import { useState } from "react";
import {
  CheckCircle,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Terminal,
} from "lucide-react";
import type { MarketplaceProxyCredentials } from "@/lib/api/marketplace";
import { getBuyerProxyEndpoint } from "@/lib/proxy-endpoint";

type CredentialField = {
  label: string;
  value: string;
  key: string;
  secret?: boolean;
};

function normalizeCredentials(
  raw: MarketplaceProxyCredentials | Record<string, unknown>,
): MarketplaceProxyCredentials {
  const rec = raw as Record<string, unknown>;
  const typed = raw as MarketplaceProxyCredentials;
  const endpoint =
    typed.endpoint ||
    (typeof rec.host === "string" && typeof rec.port === "number"
      ? `${rec.host}:${rec.port}`
      : getBuyerProxyEndpoint());

  const sessionCapability =
    typed.session_capability ||
    (typeof rec.session_capability === "string"
      ? rec.session_capability
      : undefined);

  return {
    username: String(typed.username ?? ""),
    password: String(typed.password ?? ""),
    endpoint,
    seller_name: typed.seller_name,
    listing_title: typed.listing_title,
    legacy_password: typed.legacy_password,
    auth_for_endpoint: typed.auth_for_endpoint,
    session_capability: sessionCapability,
    session_capability_note: typed.session_capability_note,
  };
}

export function MarketplaceOrderCredentials({
  credentials,
  orderId,
}: {
  credentials: MarketplaceProxyCredentials | Record<string, unknown>;
  orderId?: string;
}) {
  const creds = normalizeCredentials(credentials);
  const [showPass, setShowPass] = useState(false);
  const [showCapability, setShowCapability] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState("");

  const copyToClipboard = async (value: string, key: string) => {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopyError(
        "Clipboard access is unavailable. Reveal and select the value to copy it manually.",
      );
    }
  };

  const fields: CredentialField[] = [
    { label: "Endpoint", value: creds.endpoint, key: "endpoint" },
    { label: "Username", value: creds.username, key: "username" },
    { label: "Password", value: creds.password, key: "password", secret: true },
  ];

  const curlExample = `curl -x http://${encodeURIComponent(creds.username)}:${encodeURIComponent(creds.password)}@${creds.endpoint} https://httpbin.org/ip`;
  const maskedCurlExample = `curl -x http://${encodeURIComponent(creds.username)}:••••••••@${creds.endpoint} https://httpbin.org/ip`;

  return (
    <section
      className="credential-panel ui-surface ui-page"
      data-testid="marketplace-order-credentials"
      aria-label="Proxy credentials"
    >
      <div className="credential-panel-heading">
        <span className="ui-region">
          <KeyRound size={19} aria-hidden="true" />
        </span>
        <div>
          <p className="ui-eyebrow">Client access</p>
          <h2>Proxy credentials</h2>
        </div>
      </div>
      <div className="credential-fields">
        <p className="text-xs text-muted-foreground">
          Use HTTP CONNECT with the endpoint, username, and password below. Keep
          these credentials private.
        </p>
        {fields.map(({ label, value, key, secret }) => (
          <div key={key} className="credential-field">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground uppercase tracking-widest">
                {label}
              </p>
              <p className="text-xs font-mono text-foreground break-all">
                {secret && !showPass ? "••••••••••••" : value}
              </p>
            </div>
            <div className="flex gap-1 shrink-0">
              {secret && (
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="credential-icon-button"
                  aria-label={showPass ? "Hide password" : "Show password"}
                  aria-pressed={showPass}
                >
                  {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              )}
              <button
                type="button"
                onClick={() => copyToClipboard(value, key)}
                className="credential-icon-button"
                aria-label={`Copy ${label}`}
              >
                {copied === key ? (
                  <CheckCircle size={14} className="text-success" />
                ) : (
                  <Copy size={14} />
                )}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="credential-quick-test">
        <h3 className="ui-inline-icon">
          <Terminal size={16} aria-hidden="true" />
          Quick test
        </h3>
        <p className="text-xs text-muted-foreground">
          Run this command in a trusted terminal to inspect the proxy exit IP.
          The copied command includes your password; the preview stays masked
          until you reveal it above.
        </p>
        <pre
          data-testid="marketplace-order-credentials-curl"
          className="text-xs font-mono text-foreground bg-secondary border border-border rounded-xl p-3 overflow-x-auto whitespace-pre-wrap break-all"
        >
          {showPass ? curlExample : maskedCurlExample}
        </pre>
        <button
          type="button"
          onClick={() => copyToClipboard(curlExample, "curl")}
          className="ui-button secondary small"
        >
          <Copy size={14} aria-hidden="true" />
          {copied === "curl" ? "Copied curl command" : "Copy curl command"}
        </button>
      </div>

      {creds.session_capability ? (
        <details
          data-testid="marketplace-order-credentials-advanced"
          className="rounded-2xl border border-border bg-card p-4"
        >
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            Advanced integration token
          </summary>
          <p className="mt-2 text-xs text-muted-foreground">
            {creds.session_capability_note ||
              "For supported advanced integrations only. This token does not replace your proxy username and password."}
          </p>
          <div className="mt-3 flex items-start justify-between gap-2">
            <p className="min-w-0 break-all font-mono text-xs text-muted-foreground">
              {showCapability ? creds.session_capability : "••••••••••••"}
            </p>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => setShowCapability((v) => !v)}
                className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
                aria-label={
                  showCapability
                    ? "Hide capability token"
                    : "Show capability token"
                }
              >
                {showCapability ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button
                type="button"
                onClick={() =>
                  copyToClipboard(creds.session_capability ?? "", "capability")
                }
                className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
                aria-label="Copy capability token"
              >
                {copied === "capability" ? (
                  <CheckCircle size={14} className="text-success" />
                ) : (
                  <Copy size={14} />
                )}
              </button>
            </div>
          </div>
        </details>
      ) : null}

      {orderId && (
        <p className="text-xs text-muted-foreground">
          Order{" "}
          <span className="font-mono text-muted-foreground">{orderId}</span> —
          traffic routes through the edge gateway when your client is configured
          with the credentials above.
        </p>
      )}
      {copied && (
        <p className="sr-only" role="status">
          Copied {copied === "curl" ? "curl command" : copied} to clipboard.
        </p>
      )}
      {copyError && (
        <p className="ui-error" role="alert">
          {copyError}
        </p>
      )}
    </section>
  );
}
