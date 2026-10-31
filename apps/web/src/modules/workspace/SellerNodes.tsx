"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  createNode,
  createProviderToken,
  deleteNode,
  getMyNodes,
  getNodeConnectInfo,
  getNodeUptime,
  getProviderTokens,
  revokeProviderToken,
  updateNode,
  type NodeRegistration,
  type ProviderToken,
} from "@/lib/api/provider";
import {
  buildProviderToml,
  buildUnixSetupThisPcScript,
  buildWindowsSetupThisPcScript,
  clearProviderApiKey,
  clearProviderSessionTokens,
  defaultProviderConfigPath,
  downloadProviderToml,
  downloadSetupThisPc,
  getOrCreateProviderSigningKey,
  isWindowsClient,
  loadProviderApiKey,
  sanitizeProviderEndpoints,
  saveProviderApiKey,
} from "@/lib/provider-config";
import { explorerHref } from "@/lib/navigation/workspace";
import { Modal } from "@/components/patterns/Modal";
import {
  PageHeading,
  Loading,
  DataError,
  EmptyState,
  Status,
  amount,
  countryName,
} from "@/components/workspace/Patterns";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

function servedTotal(node: NodeRegistration): number {
  return (node.total_bytes_up ?? 0) + (node.total_bytes_down ?? 0);
}

export function useSellerNodes() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["provider-nodes", user?.id],
    queryFn: getMyNodes,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function SellerNodeSetup() {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [registered, setRegistered] = useState<NodeRegistration | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const registration = useMutation({
    retry: false,
    mutationFn: async () => {
      const node =
        registered ??
        (await createNode({
          name: name.trim(),
          country: country.trim().toUpperCase() || undefined,
          city: city.trim() || undefined,
        }));
      setRegistered(node);
      void client.invalidateQueries({ queryKey: ["provider-nodes"] });
      const credential = await createProviderToken({
        name: `${node.name}-connection`.slice(0, 100),
        node_id: node.id,
      });
      saveProviderApiKey(credential.token, node.id);
      setToken(credential.token);
      await client.invalidateQueries({ queryKey: ["provider-nodes"] });
      await client.invalidateQueries({ queryKey: ["provider-tokens"] });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    registration.mutate();
  };
  return (
    <div className="ui-page">
      <Link className="ui-link self-start" href="/provider/nodes">
        ← Nodes
      </Link>
      <PageHeading
        eyebrow="Seller workspace"
        title="Set up a node"
        description="Register your supply, install the node software, then verify its first heartbeat."
      />
      <ol className="ui-workflow-steps" aria-label="Node setup progress">
        <li aria-current={!token ? "step" : undefined}>
          <span>1</span>Register & create credentials
        </li>
        <li aria-current={token ? "step" : undefined}>
          <span>2</span>Install & verify
        </li>
      </ol>
      {!token ? (
        <form className="ui-surface ui-page" onSubmit={submit}>
          <div>
            <h2>
              {registered
                ? "Finish connection setup"
                : "Tell us about this node"}
            </h2>
            <p className="ui-note">
              Registration creates one node and a connection token scoped to it.
              It does not mark the node online.
            </p>
          </div>
          <fieldset
            className="ui-form-grid"
            disabled={registration.isPending || Boolean(registered)}
          >
            <label className="ui-field">
              Node name
              <input
                className="ui-input"
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Accra home node"
              />
            </label>
            <label className="ui-field">
              Country code
              <input
                className="ui-input"
                aria-label="Country code"
                maxLength={2}
                pattern="[A-Za-z]{2}"
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
                aria-describedby="setup-country-help"
                placeholder="e.g. GH"
              />
              <small id="setup-country-help">
                Optional ISO country code. Live location is verified separately.
              </small>
            </label>
            <label className="ui-field">
              City
              <input
                className="ui-input"
                maxLength={100}
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Optional"
              />
            </label>
          </fieldset>
          {registration.isError && <DataError error={registration.error} />}
          {registered && (
            <p className="ui-note" role="status">
              Node {registered.name} is registered. Retry creates its connection
              token without registering another node.
            </p>
          )}
          <div className="ui-actions">
            <button
              className="ui-button"
              disabled={registration.isPending || !name.trim()}
            >
              {registration.isPending
                ? "Preparing your node…"
                : registered
                  ? "Retry connection token"
                  : "Register node & continue"}
            </button>
            {registered && (
              <Link
                className="ui-button secondary"
                href={`/provider/nodes/${registered.id}`}
              >
                Open registered node
              </Link>
            )}
          </div>
        </form>
      ) : (
        registered && (
          <>
            <NodeConnection node={registered} initialToken={token} />
            <NodeVerification nodeId={registered.id} />
            <div className="ui-actions">
              <Link
                className="ui-button secondary"
                href={`/provider/nodes/${registered.id}`}
              >
                Open node details →
              </Link>
              <Link className="ui-button ghost" href="/provider/listings/new">
                Create an offer →
              </Link>
            </div>
          </>
        )
      )}
    </div>
  );
}

export function NodeConnection({
  node,
  initialToken,
}: {
  node: NodeRegistration;
  initialToken?: string | null;
}) {
  const { user } = useAuth();
  const client = useQueryClient();
  const [apiKey, setApiKey] = useState(
    () =>
      initialToken ??
      loadProviderApiKey(node.id, { allowLegacyFallback: false }),
  );
  const [copied, setCopied] = useState("");
  const [copyError, setCopyError] = useState("");
  const connection = useQuery({
    queryKey: ["node-connect", user?.id, node.id],
    queryFn: () => getNodeConnectInfo(node.id),
  });
  const credential = useMutation({
    retry: false,
    mutationFn: () =>
      createProviderToken({
        name: `${node.name}-connection`.slice(0, 100),
        node_id: node.id,
      }),
    onSuccess: (result) => {
      saveProviderApiKey(result.token, node.id);
      setApiKey(result.token);
      void client.invalidateQueries({ queryKey: ["provider-tokens"] });
    },
  });
  function config() {
    if (!apiKey || !connection.data)
      throw new Error(
        "Load the node settings and create a connection token first.",
      );
    const info = connection.data;
    const endpoints = sanitizeProviderEndpoints({
      controlApiUrl: info.control_api_url,
      gatewayTunnelAddr: info.gateway_tunnel_addr,
      gatewayTunnelAddrs: info.gateway_tunnel_addrs ?? [],
      useTls: info.use_tls,
      tlsSkipVerify: info.tls_skip_verify ?? false,
    });
    return {
      endpoints,
      toml: buildProviderToml({
        nodeId: node.id,
        apiKey,
        providerSigningKey: getOrCreateProviderSigningKey(node.id),
        connectionType: info.connection_type,
        endpoints,
      }),
    };
  }
  async function copySetup() {
    setCopyError("");
    try {
      const { toml, endpoints } = config();
      await navigator.clipboard.writeText(
        isWindowsClient()
          ? buildWindowsSetupThisPcScript(toml, endpoints.controlApiUrl)
          : buildUnixSetupThisPcScript(toml, endpoints.controlApiUrl),
      );
      setCopied("Setup script copied");
    } catch (error) {
      setCopyError(
        error instanceof Error
          ? error.message
          : "Could not copy the setup script.",
      );
    }
  }
  const ready = Boolean(apiKey && connection.isSuccess);
  return (
    <section className="ui-surface ui-page">
      <div>
        <h2>Connect {node.name}</h2>
        <p className="ui-note">
          Run the setup script on the machine that will supply bandwidth. It
          installs the software, writes its configuration, and starts the node.
        </p>
      </div>
      {connection.isLoading && (
        <Loading label="Loading node connection settings…" />
      )}
      {connection.isError && (
        <DataError
          error={connection.error}
          retry={() => void connection.refetch()}
        />
      )}
      {!apiKey && (
        <div className="ui-attention">
          <h3>Create credentials for this node</h3>
          <p>
            A new token is created only when you request one. Existing
            credentials can be managed from Node credentials.
          </p>
          <button
            className="ui-button"
            disabled={credential.isPending || !connection.isSuccess}
            onClick={() => credential.mutate()}
          >
            {credential.isPending
              ? "Creating token…"
              : "Create connection token"}
          </button>
        </div>
      )}
      {credential.isError && <DataError error={credential.error} />}
      {apiKey && (
        <p className="ui-note">
          Connection credentials are available in this browser session.
          Downloaded configuration and scripts contain secrets; keep them
          private.
        </p>
      )}
      <div className="ui-actions">
        <button
          className="ui-button"
          disabled={!ready}
          onClick={() => {
            const { toml, endpoints } = config();
            downloadSetupThisPc(toml, endpoints.controlApiUrl);
          }}
        >
          Download setup script
        </button>
        <button
          className="ui-button secondary"
          disabled={!ready}
          onClick={() => void copySetup()}
        >
          Copy setup script
        </button>
      </div>
      {copied && (
        <p className="ui-note" role="status">
          {copied}
        </p>
      )}
      {copyError && <DataError error={new Error(copyError)} />}
      <details className="ui-note">
        <summary>Manual installation & configuration</summary>
        <p className="mt-3">
          The node reads its configuration from{" "}
          {connection.data?.config_path_hint || defaultProviderConfigPath()}.
          Downloading a file does not install or start the node.
        </p>
        <div className="ui-actions mt-3">
          <button
            className="ui-button secondary"
            disabled={!ready}
            title={
              ready ? undefined : "Create a connection token above first"
            }
            onClick={() => {
              setCopyError("");
              try {
                downloadProviderToml("provider.toml", config().toml);
                setCopied("provider.toml downloaded");
              } catch (error) {
                setCopyError(
                  error instanceof Error
                    ? error.message
                    : "Could not download provider.toml.",
                );
              }
            }}
          >
            Download provider.toml
          </button>
          <Link className="ui-link" href="/dashboard/provider/cli">
            Software versions & downloads →
          </Link>
        </div>
      </details>
    </section>
  );
}

export function NodeVerification({ nodeId }: { nodeId: string }) {
  const nodes = useSellerNodes();
  const node = nodes.data?.nodes.find((item) => item.id === nodeId);
  const verified = node?.status === "online" && node.latest_heartbeat_verified;
  return (
    <section className="ui-surface">
      <div className="ui-section-heading">
        <h2>Verify the first heartbeat</h2>
        <Status tone={verified ? "good" : "neutral"}>
          {verified
            ? "Online · signature verified"
            : node?.status === "online"
              ? "Online · signature not verified"
              : "Waiting for a verified heartbeat"}
        </Status>
      </div>
      <p className="ui-note">
        The node software reports its own heartbeat. This screen checks the
        server record; it does not send a simulated heartbeat.
      </p>
      {node?.latest_heartbeat_verification_error && (
        <p className="ui-note mt-3">
          {node.latest_heartbeat_verification_error}
        </p>
      )}
      {nodes.isError && <DataError error={nodes.error} />}
      <button
        className="ui-button secondary mt-4"
        disabled={nodes.isFetching}
        onClick={() => void nodes.refetch()}
      >
        {nodes.isFetching ? "Checking…" : "Check heartbeat"}
      </button>
    </section>
  );
}

export function SellerNodeDetail({ nodeId }: { nodeId: string }) {
  const query = useSellerNodes();
  const node = query.data?.nodes.find((item) => item.id === nodeId);
  return (
    <div className="ui-page">
      <Link className="ui-link self-start" href="/provider/nodes">
        ← Nodes
      </Link>
      {query.isLoading && <Loading label="Loading your node…" />}
      {query.isError && (
        <DataError error={query.error} retry={() => void query.refetch()} />
      )}
      {query.isSuccess && !node && (
        <EmptyState
          title="This node is unavailable."
          description="It may have been removed or belong to another account."
          href="/provider/nodes"
          action="Return to nodes"
        />
      )}
      {node && (
        <>
          <PageHeading
            eyebrow="Seller workspace"
            title={node.name}
            description={`${countryName(node.country)}${node.city ? ` · ${node.city}` : ""} · ${node.id}`}
            actions={
              <Link
                className="ui-button secondary"
                href={`/provider/listings/new?node=${encodeURIComponent(node.id)}`}
              >
                Create offer →
              </Link>
            }
          />
          <NodeVerification nodeId={nodeId} />
          <NodeTraffic node={node} />
          <NodeConnection key={node.id} node={node} />
          <NodeDiagnostics nodeId={node.id} />
          <NodeSettings key={`settings-${node.id}`} node={node} />
        </>
      )}
    </div>
  );
}

function NodeTraffic({ node }: { node: NodeRegistration }) {
  const up = node.total_bytes_up ?? 0;
  const down = node.total_bytes_down ?? 0;
  const lastSeen =
    node.last_seen_at && Number.isFinite(Date.parse(node.last_seen_at))
      ? new Date(node.last_seen_at).toLocaleString()
      : "Not reported";
  return (
    <section>
      <div className="ui-section-heading">
        <h2>Live traffic</h2>
      </div>
      <p className="ui-note">
        Self-reported by the node software on every heartbeat. Settlement stays
        on metered session usage.
      </p>
      <dl className="ui-detail-list">
        <div>
          <dt>Data served</dt>
          <dd>
            {formatBytes(up + down)} ({formatBytes(up)} up ·{" "}
            {formatBytes(down)} down)
          </dd>
        </div>
        <div>
          <dt>Active connections</dt>
          <dd>{node.active_connections ?? 0}</dd>
        </div>
        <div>
          <dt>Sessions served</dt>
          <dd>{node.total_sessions_served ?? 0}</dd>
        </div>
        <div>
          <dt>Last report</dt>
          <dd>{lastSeen}</dd>
        </div>
      </dl>
    </section>
  );
}

function NodeDiagnostics({ nodeId }: { nodeId: string }) {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["node-uptime", user?.id, nodeId],
    queryFn: () => getNodeUptime(nodeId),
    staleTime: 30_000,
  });
  return (
    <section>
      <div className="ui-section-heading">
        <h2>Reported diagnostics</h2>
        <a className="ui-link" href={explorerHref("/nodes")}>
          Public network evidence ↗
        </a>
      </div>
      {query.isLoading && <Loading label="Loading diagnostics…" />}
      {query.isError && (
        <DataError error={query.error} retry={() => void query.refetch()} />
      )}
      {query.data && (
        <dl className="ui-detail-list">
          <div>
            <dt>Service state</dt>
            <dd>{query.data.current_status}</dd>
          </div>
          <div>
            <dt>Latency</dt>
            <dd>
              {query.data.avg_latency_ms > 0
                ? `${amount(query.data.avg_latency_ms)} ms`
                : "Not measured"}
            </dd>
          </div>
          <div>
            <dt>Uptime</dt>
            <dd>
              {query.data.checks_24h > 0
                ? `${amount(query.data.uptime_percent)}%`
                : "Not measured"}
            </dd>
          </div>
          <div>
            <dt>Last seen</dt>
            <dd>
              {query.data.last_seen &&
              Number.isFinite(Date.parse(query.data.last_seen))
                ? new Date(query.data.last_seen).toLocaleString()
                : "Not reported"}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}

function NodeSettings({ node }: { node: NodeRegistration }) {
  const client = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState(node.name);
  const [country, setCountry] = useState(node.country ?? "");
  const [city, setCity] = useState(node.city ?? "");
  const [removeOpen, setRemoveOpen] = useState(false);
  const save = useMutation({
    retry: false,
    mutationFn: () =>
      updateNode(node.id, {
        name: name.trim(),
        country: country.trim().toUpperCase(),
        city: city.trim(),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["provider-nodes"] }),
  });
  const remove = useMutation({
    retry: false,
    mutationFn: () => deleteNode(node.id),
    onSuccess: () => {
      clearProviderApiKey(node.id);
      void client.invalidateQueries({ queryKey: ["provider-nodes"] });
      router.push("/provider/nodes");
    },
  });
  return (
    <section className="ui-surface ui-page">
      <h2>Node settings</h2>
      <form
        className="ui-page"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <fieldset className="ui-form-grid" disabled={save.isPending}>
          <label className="ui-field">
            Node name
            <input
              className="ui-input"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="ui-field">
            Country code
            <input
              className="ui-input"
              pattern="[A-Za-z]{2}"
              aria-label="Country code"
              maxLength={2}
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
            />
          </label>
          <label className="ui-field">
            City
            <input
              className="ui-input"
              maxLength={100}
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </label>
        </fieldset>
        {save.isError && <DataError error={save.error} />}
        {save.isSuccess && (
          <p className="ui-note" role="status">
            Node settings saved.
          </p>
        )}
        <div className="ui-actions">
          <button
            className="ui-button"
            disabled={save.isPending || !name.trim()}
          >
            {save.isPending ? "Saving…" : "Save node settings"}
          </button>
          <Link
            className="ui-button secondary"
            href="/provider/nodes/credentials"
          >
            Node credentials
          </Link>
        </div>
      </form>
      <details className="ui-note">
        <summary>Remove this node</summary>
        <p className="mt-3">
          Remove the registration after stopping its software and reviewing
          linked offers and sessions.
        </p>
        <button
          className="ui-button secondary mt-3"
          onClick={() => setRemoveOpen(true)}
        >
          Remove node…
        </button>
      </details>
      <Modal
        open={removeOpen}
        onOpenChange={(open) => {
          if (!remove.isPending) setRemoveOpen(open);
        }}
        title={`Remove ${node.name}?`}
        description="The server will check whether this node can be removed."
      >
        <p className="ui-note">
          This removes its registration. It does not stop software running on
          another machine or settle existing orders.
        </p>
        {remove.isError && <DataError error={remove.error} />}
        <div className="ui-actions mt-5">
          <button
            className="ui-button secondary"
            disabled={remove.isPending}
            onClick={() => setRemoveOpen(false)}
          >
            Keep node
          </button>
          <button
            className="ui-button"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? "Removing…" : "Remove registration"}
          </button>
        </div>
      </Modal>
    </section>
  );
}

export function SellerNodes() {
  const query = useSellerNodes();
  return (
    <div className="ui-page">
      <PageHeading
        eyebrow="Seller workspace"
        title="Nodes"
        description="Register supply, connect its software, and review reported health."
        actions={
          <Link className="ui-button" href="/provider/nodes/new">
            Add node
          </Link>
        }
      />
      <div className="ui-actions">
        <Link
          className="ui-button secondary"
          href="/provider/nodes/credentials"
        >
          Node credentials
        </Link>
        <Link className="ui-button ghost" href="/dashboard/provider/services">
          Advanced services →
        </Link>
        <Link className="ui-button secondary" href="/dashboard/provider/pair">Pair a computer</Link>
        <Link className="ui-button ghost" href="/dashboard/provider/cli">Software downloads</Link>
        <Link className="ui-button ghost" href="/dashboard/provider/health">Node health</Link>
      </div>
      {query.isLoading && <Loading label="Loading your nodes…" />}
      {query.isError && (
        <DataError error={query.error} retry={() => void query.refetch()} />
      )}
      {query.isSuccess && !query.data.nodes.length && (
        <EmptyState
          title="Start with one healthy node."
          description="Register your machine and verify its first heartbeat before publishing an offer."
          href="/provider/nodes/new"
          action="Set up a node"
        />
      )}
      {Boolean(query.data?.nodes.length) && (
        <div
          className="ui-table-wrap"
          role="region"
          aria-label="Your provider nodes"
          tabIndex={0}
        >
          <table className="ui-table">
            <thead>
              <tr>
                <th>Node</th>
                <th>Service state</th>
                <th>Heartbeat signature</th>
                <th>Reported latency</th>
                <th>Data served</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {query.data?.nodes.map((node) => (
                <tr key={node.id}>
                  <td>
                    {node.name}
                    <p>{countryName(node.country)}</p>
                  </td>
                  <td>
                    <Status
                      tone={node.status === "online" ? "good" : "neutral"}
                    >
                      {node.status}
                    </Status>
                  </td>
                  <td>
                    {node.latest_heartbeat_verified
                      ? "Verified"
                      : "Not verified"}
                  </td>
                  <td>
                    {node.latency_ms != null && node.latency_ms > 0
                      ? `${amount(node.latency_ms)} ms`
                      : "Not measured"}
                  </td>
                  <td>{formatBytes(servedTotal(node))}</td>
                  <td>
                    <Link
                      className="ui-button secondary small"
                      href={`/provider/nodes/${encodeURIComponent(node.id)}`}
                    >
                      Manage node →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function SellerNodeCredentials() {
  const { user } = useAuth();
  const client = useQueryClient();
  const nodes = useSellerNodes();
  const query = useQuery({
    queryKey: ["provider-tokens", user?.id],
    queryFn: getProviderTokens,
  });
  const [name, setName] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [expires, setExpires] = useState("30");
  const [created, setCreated] = useState<{
    token: string;
    nodeId: string;
  } | null>(null);
  const [revoke, setRevoke] = useState<ProviderToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const create = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!nodeId || !nodes.data?.nodes.some((node) => node.id === nodeId))
        throw new Error("Choose one of your registered nodes.");
      return createProviderToken({
        name: name.trim(),
        node_id: nodeId,
        expires_in: Number(expires),
      });
    },
    onSuccess: (result) => {
      saveProviderApiKey(result.token, nodeId);
      setCreated({ token: result.token, nodeId });
      setCopied(false);
      setName("");
      void client.invalidateQueries({ queryKey: ["provider-tokens"] });
    },
  });
  const remove = useMutation({
    retry: false,
    mutationFn: (token: ProviderToken) => revokeProviderToken(token.id),
    onSuccess: () => {
      clearProviderSessionTokens();
      setRevoke(null);
      void client.invalidateQueries({ queryKey: ["provider-tokens"] });
    },
  });
  return (
    <div className="ui-page">
      <Link className="ui-link self-start" href="/provider/nodes">
        ← Nodes
      </Link>
      <PageHeading
        eyebrow="Seller workspace"
        title="Node credentials"
        description="Create credentials for a specific node and revoke access you no longer need."
      />
      <form
        className="ui-surface ui-page"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div>
          <h2>Create or replace a connection token</h2>
          <p className="ui-note">
            A new token for a node replaces its previous node-bound token.
            Update that machine’s configuration after replacement.
          </p>
        </div>
        <fieldset className="ui-form-grid" disabled={create.isPending}>
          <label className="ui-field">
            Token name
            <input
              className="ui-input"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="ui-field">
            Node
            <select
              className="ui-select"
              required
              value={nodeId}
              onChange={(e) => setNodeId(e.target.value)}
            >
              <option value="">Choose your node</option>
              {nodes.data?.nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ui-field">
            Expires in
            <select
              className="ui-select"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            >
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
          </label>
        </fieldset>
        {nodes.isError && (
          <DataError error={nodes.error} retry={() => void nodes.refetch()} />
        )}
        {create.isError && <DataError error={create.error} />}
        <button
          className="ui-button self-start"
          disabled={
            create.isPending || !nodes.isSuccess || !nodeId || !name.trim()
          }
        >
          {create.isPending ? "Creating…" : "Create connection token"}
        </button>
      </form>
      {query.isLoading && <Loading label="Loading credentials…" />}
      {query.isError && (
        <DataError error={query.error} retry={() => void query.refetch()} />
      )}
      {query.data && (
        <section>
          <h2 className="mb-4">Issued tokens</h2>
          {!query.data.tokens.length && (
            <p className="ui-note">No tokens have been issued.</p>
          )}
          {query.data.tokens.map((token) => (
            <div className="ui-row" key={token.id}>
              <div>
                <h3>{token.name}</h3>
                <p>
                  {token.masked} ·{" "}
                  {token.expires_at
                    ? `Expires ${new Date(token.expires_at).toLocaleDateString()}`
                    : "No expiry reported"}
                </p>
              </div>
              <div className="ui-actions">
                <Status
                  tone={
                    token.is_active && !token.is_expired ? "good" : "neutral"
                  }
                >
                  {token.is_expired
                    ? "Expired"
                    : token.is_active
                      ? "Active"
                      : "Revoked"}
                </Status>
                {token.is_active && (
                  <button
                    className="ui-button secondary small"
                    onClick={() => {
                      remove.reset();
                      setRevoke(token);
                    }}
                  >
                    Revoke…
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>
      )}
      <Modal
        open={Boolean(created)}
        onOpenChange={(open) => {
          if (!open) {
            setCreated(null);
            setCopyError("");
          }
        }}
        title="Connection token created"
        description="The server returns the raw token only once."
      >
        {created && (
          <div className="ui-page">
            <p className="ui-note">
              This browser session can use it to prepare the selected node’s
              setup script. Keep the token private.
            </p>
            <code className="ui-code" style={{ overflowWrap: "anywhere" }}>
              {created.token}
            </code>
            <button
              className="ui-button secondary"
              onClick={() => {
                void navigator.clipboard
                  .writeText(created.token)
                  .then(() => setCopied(true))
                  .catch(() =>
                    setCopyError(
                      "Clipboard access failed. Select and copy the token above.",
                    ),
                  );
              }}
            >
              {copied ? "Token copied" : "Copy token"}
            </button>
            {copyError && (
              <p role="alert" className="ui-note">
                {copyError}
              </p>
            )}
            <Link
              className="ui-button"
              href={`/provider/nodes/${created.nodeId}`}
              onClick={() => setCreated(null)}
            >
              Open node configuration →
            </Link>
          </div>
        )}
      </Modal>
      <Modal
        open={Boolean(revoke)}
        onOpenChange={(open) => {
          if (!remove.isPending && !open) setRevoke(null);
        }}
        title={`Revoke ${revoke?.name ?? "token"}?`}
        description="A running node using this token will need replacement credentials."
      >
        <p className="ui-note">
          The raw token cannot be recovered after revocation. Saved connection
          tokens in this browser are cleared to prevent stale setup downloads.
        </p>
        {remove.isError && <DataError error={remove.error} />}
        <div className="ui-actions mt-4">
          <button
            className="ui-button secondary"
            disabled={remove.isPending}
            onClick={() => setRevoke(null)}
          >
            Keep token
          </button>
          <button
            className="ui-button"
            disabled={remove.isPending}
            onClick={() => {
              if (revoke) remove.mutate(revoke);
            }}
          >
            {remove.isPending ? "Revoking…" : "Revoke token"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
