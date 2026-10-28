export const publicResources = [
  "metrics",
  "health",
  "trust",
  "nodes",
  "node",
  "transactions",
  "transaction",
  "blocks",
  "block",
  "wallet",
  "contract",
  "analytics",
  "proposals",
  "proposal",
  "treasury",
] as const;
export type PublicResource = (typeof publicResources)[number];
type RecordValue = Record<string, unknown>;
const asRecord = (value: unknown): RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
const pick = (value: unknown, keys: string[]) =>
  Object.fromEntries(
    keys
      .filter((key) => {
        const field = asRecord(value)[key];
        return (
          Object.hasOwn(asRecord(value), key) &&
          (field === null ||
            ["string", "number", "boolean"].includes(typeof field))
        );
      })
      .map((key) => [key, asRecord(value)[key]]),
  );
const tx = [
  "tx_hash",
  "chain",
  "from_address",
  "to_address",
  "amount",
  "currency",
  "status",
  "tx_type",
  "timestamp",
  "fee",
  "block_hash",
  "block_number",
  "program_id",
  "confirmations",
];
const node = [
  "node_id",
  "name",
  "chain",
  "region",
  "country",
  "city",
  "is_active",
  "is_validator",
  "uptime_percent",
  "active_sessions",
  "bandwidth_gb",
  "last_heartbeat",
  "latency_ms",
  "total_sessions",
  "success_rate",
  "version",
];
const block = [
  "block_hash",
  "block_number",
  "chain",
  "timestamp",
  "transaction_count",
];
const proposal = [
  "id",
  "title",
  "description",
  "type",
  "status",
  "start_time",
  "end_time",
  "yes_votes",
  "no_votes",
  "votes_for",
  "votes_against",
  "votes_abstain",
  "total_votes",
  "quorum",
];
const list = (value: unknown, keys: string[]) =>
  Array.isArray(value) ? value.map((item) => pick(item, keys)) : [];

/** A public-only allowlist; private DTO fields never cross this boundary. */
export function projectPublicData(
  resource: PublicResource,
  value: unknown,
): RecordValue {
  const data = asRecord(value);
  switch (resource) {
    case "metrics":
      return pick(data, [
        "chain",
        "total_transactions",
        "total_volume",
        "active_wallets",
        "active_nodes",
        "block_height",
        "avg_block_time_ms",
        "total_bandwidth_gb",
        "transactions_per_second",
        "tps_window_hours",
        "last_updated",
        "data_source",
        "time_series_available",
      ]);
    case "health":
      return pick(data, [
        "status",
        "solana_health",
        "database_health",
        "active_nodes",
        "avg_response_time_ms",
        "last_checked",
      ]);
    case "trust":
      return pick(data, [
        "chain",
        "window_slots",
        "latest_attested_slot",
        "recent_slots_analyzed",
        "unique_writers",
        "min_writers_required",
        "slots_meeting_quorum",
        "conflicting_slots",
        "quorum_ratio",
        "explorer_mode",
        "fully_decentralized",
        "last_updated",
      ]);
    case "nodes":
      return {
        ...pick(data, ["total", "active", "page", "page_size"]),
        nodes: list(data.nodes, node),
      };
    case "node":
      return pick(data, node);
    case "transactions":
      return {
        ...pick(data, ["total", "page", "page_size"]),
        transactions: list(data.transactions, tx),
      };
    case "transaction":
      return pick(data, tx);
    case "blocks":
      return {
        ...pick(data, ["total", "page", "page_size"]),
        blocks: list(data.blocks, block),
      };
    case "block":
      return {
        ...pick(data, block),
        transactions: list(data.transactions, tx),
      };
    case "wallet":
      return pick(data, [
        "address",
        "chain",
        "balance_sol",
        "transaction_count",
        "first_activity",
        "last_activity",
        "is_contract",
      ]);
    case "contract":
      return pick(data, [
        "address",
        "name",
        "chain",
        "contract_type",
        "is_verified",
        "total_calls",
        "deployed_at",
        "description",
      ]);
    case "analytics":
      return {
        ...pick(data, ["period", "metrics_available", "message"]),
        ...Object.fromEntries(
          [
            "transaction_volume",
            "bandwidth_gb",
            "active_nodes",
            "active_wallets",
          ].map((key) => [key, list(data[key], ["timestamp", "value"])]),
        ),
      };
    case "proposals":
      return { proposals: list(data.proposals, proposal) };
    case "proposal":
      return pick(data.proposal ?? data, proposal);
    case "treasury": {
      const treasury = asRecord(data.treasury);
      const balanceUnavailable =
        treasury.status === "RPC_UNAVAILABLE" ||
        ["hot", "cold", "vault"].some(
          (key) => asRecord(treasury[key]).balance_unavailable === true,
        );
      return {
        ...pick(data, [
          "network",
          "lifetime_provider_paid_sol",
          "oracle_configured",
        ]),
        treasury: {
          ...pick(treasury, [
            "address",
            ...(!balanceUnavailable
              ? ["balance_sol", "combined_balance_sol"]
              : []),
            "status",
            "last_checked_at",
          ]),
          balance_unavailable: balanceUnavailable,
        },
        recent_batch_payouts: list(data.recent_batch_payouts, [
          "id",
          "status",
          "total_amount",
          "total_count",
          "success_count",
          "tx_hash",
          "created_at",
        ]),
      };
    }
  }
}

export function publicResourcePath(
  resource: PublicResource,
  params: URLSearchParams,
): string {
  const id = params.get("id")?.trim() || "";
  if (
    ["node", "transaction", "block", "wallet", "contract", "proposal"].includes(
      resource,
    ) &&
    (!id || id.length > 160 || !/^[a-zA-Z0-9_-]+$/.test(id))
  )
    throw new Error("Enter a valid public identifier.");
  const page = Math.min(
    1_000_000,
    Math.max(1, Math.floor(Number(params.get("page"))) || 1),
  );
  const endpoints: Record<PublicResource, string> = {
    metrics: "/v1/explorer/metrics",
    health: "/v1/explorer/network/health",
    trust: "/v1/explorer/decentralization/status",
    nodes: `/v1/explorer/nodes?page=${page}&page_size=20&active=false`,
    node: `/v1/explorer/nodes/${encodeURIComponent(id)}`,
    transactions: `/v1/explorer/transactions?page=${page}&page_size=20`,
    transaction: `/v1/explorer/transactions/${encodeURIComponent(id)}`,
    blocks: `/v1/explorer/blocks?page=${page}&page_size=20&chain=solana`,
    block: `/v1/explorer/blocks/${encodeURIComponent(id)}`,
    wallet: `/v1/explorer/wallets/${encodeURIComponent(id)}`,
    contract: `/v1/explorer/contracts/${encodeURIComponent(id)}`,
    analytics: "/v1/explorer/analytics?period=24h",
    proposals: "/v1/governance/proposals",
    proposal: `/v1/governance/proposals/${encodeURIComponent(id)}`,
    treasury: "/v1/treasury/public",
  };
  return endpoints[resource];
}
