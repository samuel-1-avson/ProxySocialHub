"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { ConfirmDialog } from "@/components/patterns/ConfirmDialog";
import { DataError, EmptyState, Loading } from "@/components/workspace/Patterns";
import { createAPIKey, listAPIKeys, revokeAPIKey, type APIKey } from "@/lib/services/security";

export function ApiKeysPanel() {
    const [loading, setLoading] = useState(true);
    const [apiKeys, setApiKeys] = useState<APIKey[]>([]);
    const [newKeyName, setNewKeyName] = useState("");
    const [createdKey, setCreatedKey] = useState<string | null>(null);
    const [copiedKey, setCopiedKey] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [revokeId, setRevokeId] = useState<string | null>(null);
    const [revoking, setRevoking] = useState(false);

    const loadKeys = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setApiKeys(await listAPIKeys());
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load API keys");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadKeys();
    }, [loadKeys]);

    const handleCreateKey = async () => {
        if (!newKeyName.trim() || creating) return;
        setCreating(true);
        setError(null);
        try {
            const res = await createAPIKey(newKeyName.trim());
            const plaintext = res.api_key?.key;
            if (!plaintext) throw new Error("API did not return a one-time key secret");
            setCreatedKey(plaintext);
            setApiKeys((current) => [
                {
                    id: res.api_key.id,
                    name: res.api_key.name,
                    prefix: res.api_key.prefix || res.api_key.key_prefix || plaintext.slice(0, 12),
                    permissions: res.api_key.permissions,
                    rate_limit_per_minute: res.api_key.rate_limit_per_minute,
                    created_at: res.api_key.created_at,
                    expires_at: res.api_key.expires_at,
                },
                ...current,
            ]);
            setNewKeyName("");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create API key");
        } finally {
            setCreating(false);
        }
    };

    const handleRevokeKey = async () => {
        if (!revokeId || revoking) return;
        setRevoking(true);
        setError(null);
        try {
            await revokeAPIKey(revokeId);
            setApiKeys((current) => current.filter((key) => key.id !== revokeId));
            setRevokeId(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to revoke API key");
        } finally {
            setRevoking(false);
        }
    };

    const revokeTarget = apiKeys.find((key) => key.id === revokeId);

    if (loading) return <Loading label="Loading API keys…" />;

    return (
        <div className="grid gap-6">
            <section className="ui-surface">
                <div className="ui-section-heading">
                    <h2>API keys</h2>
                    <span className="ui-note">{apiKeys.length} of 10 active</span>
                </div>
                <p className="ui-note">
                    These pk_ keys authenticate bulk and partner requests with the X-API-Key header.
                    Provider node credentials are created from Nodes, not here. A new secret is shown once.
                </p>
                {error ? <DataError error={new Error(error)} retry={() => void loadKeys()} /> : null}
                <form
                    className="ui-actions"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void handleCreateKey();
                    }}
                >
                    <label className="ui-field" style={{ flex: 1 }}>
                        Key name
                        <input
                            className="ui-input"
                            value={newKeyName}
                            onChange={(event) => setNewKeyName(event.target.value)}
                            placeholder="Billing integration"
                            maxLength={80}
                        />
                    </label>
                    <button className="ui-button" type="submit" disabled={!newKeyName.trim() || creating}>
                        {creating ? "Creating…" : "Create key"}
                    </button>
                </form>
                {createdKey ? (
                    <div className="ui-attention" role="status">
                        <h3>Copy this secret now</h3>
                        <p>This is the only time the full key is shown. Store it outside the browser before leaving this page.</p>
                        <code style={{ overflowWrap: "anywhere" }}>{createdKey}</code>
                        <div className="ui-actions">
                            <button
                                type="button"
                                className="ui-button secondary small"
                                onClick={() => {
                                    void navigator.clipboard.writeText(createdKey).then(() => {
                                        setCopiedKey(true);
                                        window.setTimeout(() => setCopiedKey(false), 2000);
                                    });
                                }}
                            >
                                {copiedKey ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                                {copiedKey ? "Copied" : "Copy secret"}
                            </button>
                            <button type="button" className="ui-button ghost" onClick={() => setCreatedKey(null)}>
                                I have stored it
                            </button>
                        </div>
                    </div>
                ) : null}
            </section>

            {apiKeys.length === 0 ? (
                <EmptyState title="No API keys" description="Create a key when an integration needs its own credential. The secret is shown only at creation." />
            ) : (
                <div className="ui-table-wrap" role="region" aria-label="API keys" tabIndex={0}>
                    <table className="ui-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Prefix</th>
                                <th>Last used</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {apiKeys.map((key) => (
                                <tr key={key.id}>
                                    <td>{key.name}</td>
                                    <td>{key.prefix}</td>
                                    <td>{key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : "Not used"}</td>
                                    <td>
                                        <button type="button" className="ui-button secondary small" onClick={() => setRevokeId(key.id)}>
                                            Revoke
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <ConfirmDialog
                open={revokeId != null}
                onOpenChange={(open) => { if (!open && !revoking) setRevokeId(null); }}
                title="Revoke this API key?"
                description={revokeTarget ? `${revokeTarget.name} (${revokeTarget.prefix}) will stop working immediately. This does not delete past requests.` : "This key will stop working immediately."}
                confirmLabel="Revoke key"
                destructive
                loading={revoking}
                error={error ?? undefined}
                onConfirm={handleRevokeKey}
            />
        </div>
    );
}
