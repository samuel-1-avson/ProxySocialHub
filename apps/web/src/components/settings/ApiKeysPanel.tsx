"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, EyeOff, Key, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useClipboard } from "@/hooks/useClipboard";
import {
  createAPIKey,
  listAPIKeys,
  revokeAPIKey,
  type APIKey,
} from "@/lib/services/security";
import {
  DataError,
  EmptyState,
  Loading,
  shortDate,
} from "@/components/workspace/Patterns";
import { Modal } from "@/components/patterns/Modal";
export function ApiKeysPanel() {
  const { user } = useAuth();
  const client = useQueryClient();
  const queryKey = ["api-keys", user?.id];
  const query = useQuery({ queryKey, queryFn: listAPIKeys, enabled: !!user });
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [revoking, setRevoking] = useState<APIKey | null>(null);
  const { copy, feedback } = useClipboard();
  const create = useMutation({
    retry: false,
    mutationFn: async () => {
      const result = await createAPIKey(name.trim());
      if (!result.api_key?.key)
        throw new Error("The server did not return a one-time key secret.");
      return result;
    },
    onSuccess: (result) => {
      setSecret(result.api_key.key!);
      setShow(false);
      setName("");
      void client.invalidateQueries({ queryKey });
    },
  });
  const revoke = useMutation({
    retry: false,
    mutationFn: (id: string) => revokeAPIKey(id),
    onSuccess: () => {
      setRevoking(null);
      void client.invalidateQueries({ queryKey });
    },
  });
  return (
    <div className="ui-page">
      <header>
        <p className="ui-eyebrow">Account / Automation</p>
        <h2 className="text-3xl font-semibold tracking-tight mt-3">API keys</h2>
        <p className="ui-subtle mt-3">
          Create named keys for supported automation. Each secret is shown once
          after creation.
        </p>
      </header>
      <form
        className="ui-surface api-key-create"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() && !create.isPending) create.mutate();
        }}
      >
        <label className="ui-field">
          Key name
          <input
            className="ui-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={100}
            placeholder="For example, Reporting integration"
          />
        </label>
        <button
          className="ui-button"
          disabled={!name.trim() || create.isPending}
        >
          <Key size={15} />
          {create.isPending ? "Creating…" : "Create API key"}
        </button>
      </form>
      {create.isError && (
        <DataError title="API key was not created" error={create.error} />
      )}
      {secret && (
        <section className="ui-surface api-key-secret">
          <h3>Save your one-time secret</h3>
          <p>
            Store this key securely. Dismissing this panel hides the secret
            permanently.
          </p>
          <div className="api-key-secret-controls">
            <label className="sr-only" htmlFor="created-api-key">
              New API key secret
            </label>
            <input
              id="created-api-key"
              type={show ? "text" : "password"}
              readOnly
              value={secret}
              className="ui-input"
              autoComplete="off"
            />
            <button
              type="button"
              className="ui-button secondary"
              aria-label={show ? "Hide API key" : "Reveal API key"}
              onClick={() => setShow(!show)}
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            <button
              type="button"
              className="ui-button secondary"
              onClick={() => void copy(secret)}
            >
              <Copy size={15} />
              Copy key
            </button>
          </div>
          {feedback && <p role="status">{feedback}</p>}
          <button
            type="button"
            className="ui-button small secondary"
            onClick={() => setSecret(null)}
          >
            I have saved this key
          </button>
        </section>
      )}
      {query.isPending ? (
        <Loading label="Loading API keys…" />
      ) : query.isError ? (
        <DataError
          title="API keys are unavailable"
          error={query.error}
          retry={() => void query.refetch()}
        />
      ) : !query.data.length ? (
        <EmptyState
          title="No API keys returned"
          description="Create a named key when you are ready to connect an integration."
        />
      ) : (
        <ul className="ui-surface api-key-list">
          {query.data.map((key) => (
            <li key={key.id}>
              <span className="api-key-icon">
                <Key size={18} />
              </span>
              <div>
                <strong>{key.name}</strong>
                <p>
                  Prefix ·{" "}
                  <code>{key.prefix || key.key_prefix || "Not reported"}</code>
                </p>
                <p>
                  Created {shortDate(key.created_at)} · Last used{" "}
                  {key.last_used_at
                    ? shortDate(key.last_used_at)
                    : "Not reported"}
                </p>
                {key.expires_at && <p>Expires {shortDate(key.expires_at)}</p>}
              </div>
              <button
                type="button"
                className="ui-button small ghost"
                aria-label={"Revoke " + key.name}
                onClick={() => {
                  revoke.reset();
                  setRevoking(key);
                }}
              >
                <Trash2 size={16} />
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="workflow-note">
        Provider node connections use a separate node-bound token.{" "}
        <Link className="ui-link" href="/provider/nodes/credentials">
          Open provider credentials →
        </Link>
      </p>
      <Modal
        open={!!revoking}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title="Revoke this API key?"
        description={
          revoking
            ? "Integrations using “" + revoking.name + "” will lose access."
            : undefined
        }
        footer={
          <>
            <button
              type="button"
              className="ui-button secondary"
              onClick={() => setRevoking(null)}
            >
              Keep key
            </button>
            <button
              type="button"
              className="ui-button"
              disabled={revoke.isPending}
              onClick={() => revoking && revoke.mutate(revoking.id)}
            >
              {revoke.isPending ? "Revoking…" : "Revoke API key"}
            </button>
          </>
        }
      >
        {revoke.isError ? (
          <DataError error={revoke.error} />
        ) : (
          <p className="ui-subtle">
            Create a replacement key if the integration still needs access.
          </p>
        )}
      </Modal>
    </div>
  );
}
