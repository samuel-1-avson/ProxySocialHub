import test from "node:test";
import assert from "node:assert/strict";
import {
  projectPublicData,
  publicResourcePath,
} from "../src/lib/public-data.ts";

test('public map uses only valid reported coordinate pairs and preserves privacy rounding', () => {
  const result = projectPublicData('node-geo', { nodes: [
    { node_id: 'reported', lat: 5.6037, lon: -0.187, geo_source: 'gateway', ip_address: 'private' },
    { node_id: 'missing', lat: 2 },
    { node_id: 'invalid', lat: 91, lon: 181 },
    { node_id: 'unknown', lat: 0, lon: 0, geo_source: 'unknown' },
  ] });
  assert.deepEqual(result.nodes[0], { node_id: 'reported', lat: 5, lon: -0, geo_source: 'gateway' });
  for (const node of result.nodes.slice(1)) {
    assert.equal('lat' in node, false);
    assert.equal('lon' in node, false);
  }
});

test("public transaction projection excludes raw payload and identities", () => {
  const result = projectPublicData("transaction", {
    tx_hash: "public-hash",
    amount: 0,
    raw_data: { secret: "private" },
    linked_user_id: "private-user",
    credentials_pass: "secret",
  });
  assert.deepEqual(result, { tx_hash: "public-hash", amount: 0 });
});
test("public node projection does not expose provider identity, hotkey or RPC", () => {
  const result = projectPublicData("nodes", {
    total: 1,
    nodes: [
      {
        node_id: "opaque-id",
        country: "GH",
        is_active: false,
        hotkey: "secret",
        provider_id: "private",
        rpc_endpoint: "internal",
      },
    ],
  });
  assert.deepEqual(result, {
    total: 1,
    nodes: [{ node_id: "opaque-id", country: "GH", is_active: false }],
  });
});
test("wallet projection excludes platform ledger and linked account", () => {
  assert.deepEqual(
    projectPublicData("wallet", {
      address: "public",
      balance_sol: 0,
      balance_platform: 20,
      linked_user_id: "private",
    }),
    { address: "public", balance_sol: 0 },
  );
});
test("an allowed field cannot smuggle nested private data", () => {
  assert.deepEqual(
    projectPublicData("node", {
      node_id: "public-id",
      name: { credentials_pass: "secret" },
      country: "GH",
    }),
    { node_id: "public-id", country: "GH" },
  );
});
test("unavailable treasury balances are not shown as a reported zero", () => {
  const unavailable = projectPublicData("treasury", {
    treasury: {
      status: "RPC_UNAVAILABLE",
      combined_balance_sol: 0,
      hot: { balance_unavailable: true },
    },
  });
  assert.deepEqual(unavailable.treasury, {
    status: "RPC_UNAVAILABLE",
    balance_unavailable: true,
  });
  const available = projectPublicData("treasury", {
    treasury: { status: "HEALTHY", combined_balance_sol: 0 },
  });
  assert.equal(available.treasury.combined_balance_sol, 0);
});
test("resource paths reject identifiers that can inject paths or URLs", () => {
  for (const id of [
    "../private",
    "https://other.example/path",
    "abc?admin=true",
    "a/b",
  ])
    assert.throws(() =>
      publicResourcePath("transaction", new URLSearchParams({ id })),
    );
  assert.equal(
    publicResourcePath(
      "transaction",
      new URLSearchParams({ id: "valid-hash_123" }),
    ),
    "/v1/explorer/transactions/valid-hash_123",
  );
});
test("pagination stays bounded and does not accept arbitrary endpoint paths", () => {
  assert.equal(
    publicResourcePath(
      "nodes",
      new URLSearchParams({ page: "-3", page_size: "999999999", url: "https://other.example" }),
    ),
    "/v1/explorer/nodes?page=1&page_size=100&active=false",
  );
  assert.equal(
    publicResourcePath("transactions", new URLSearchParams({ page_size: "999999999" })),
    "/v1/explorer/transactions?page=1&page_size=20",
  );
  assert.equal(
    publicResourcePath("blocks", new URLSearchParams({ page: "999999999" })),
    "/v1/explorer/blocks?page=1000000&page_size=20&chain=solana",
  );
});

test("the metrics projection does not pass on the average block time", () => {
  const result = projectPublicData("metrics", { block_height: 7, avg_block_time_ms: 7524 });
  assert.equal(result.block_height, 7);
  assert.equal(Object.hasOwn(result, "avg_block_time_ms"), false);
});
