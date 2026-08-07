"use strict";

const { describe, it, mock, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  ProxyHubClient,
  DEFAULT_BASE_URL,
  DEFAULT_PROXY_ENDPOINT,
  proxyUrl,
  sessionIntentProxyUrl,
} = require("../index.js");

describe("ProxyHubClient", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("requires apiKey or accessToken", () => {
    assert.throws(() => new ProxyHubClient(""), TypeError);
    assert.throws(() => new ProxyHubClient({}), TypeError);
  });

  it("defaults to api.proxyhubb.com", () => {
    const client = new ProxyHubClient("phub_test");
    assert.equal(client._baseUrl, DEFAULT_BASE_URL);
    assert.equal(client.proxyEndpoint, DEFAULT_PROXY_ENDPOINT);
  });

  it("strips trailing slash from baseUrl", () => {
    const client = new ProxyHubClient("phub_test", "https://example.com/");
    assert.equal(client._baseUrl, "https://example.com");
  });

  it("accepts accessToken options object", () => {
    const client = new ProxyHubClient({ accessToken: "jwt" });
    assert.equal(client._accessToken, "jwt");
  });

  it("accepts providerToken as Bearer alias", () => {
    const client = new ProxyHubClient({ providerToken: "ptok" });
    assert.equal(client._accessToken, "ptok");
    client.setProviderToken("ptok2");
    assert.equal(client._accessToken, "ptok2");
  });

  it("builds proxy URLs", () => {
    assert.equal(
      proxyUrl("u", "p", "proxy.proxyhubb.com:8090"),
      "http://u:p@proxy.proxyhubb.com:8090"
    );
    assert.equal(
      sessionIntentProxyUrl("tok"),
      "http://session-intent:tok@proxy.proxyhubb.com:8090"
    );
  });

  it("createSessionIntent posts payload", async () => {
    const client = new ProxyHubClient({ accessToken: "jwt" });
    mock.method(global, "fetch", async (url, init) => {
      assert.match(String(url), /\/v1\/sessions\/intent$/);
      assert.equal(init.method, "POST");
      assert.equal(init.headers.Authorization, "Bearer jwt");
      const body = JSON.parse(init.body);
      assert.equal(body.type, "sticky");
      assert.equal(body.target_geo, "US");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () =>
          JSON.stringify({
            token: "abc",
            intent: { session_type: "sticky" },
          }),
      };
    });
    const out = await client.createSessionIntent("sticky", { targetGeo: "US" });
    assert.equal(out.token, "abc");
  });

  it("getOrderCredentials gets path", async () => {
    const client = new ProxyHubClient({ accessToken: "jwt" });
    mock.method(global, "fetch", async (url, init) => {
      assert.match(String(url), /\/v1\/orders\/ord-1\/credentials$/);
      assert.equal(init.method, "GET");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () =>
          JSON.stringify({
            proxy_credentials: { username: "u", password: "p", host: "h", port: 8090 },
          }),
      };
    });
    const out = await client.getOrderCredentials("ord-1");
    assert.equal(out.proxy_credentials.username, "u");
    assert.equal(
      client.proxyUrlFromCredentials(out),
      "http://u:p@h:8090"
    );
  });

  it("createProviderToken posts and returns plaintext once", async () => {
    const client = new ProxyHubClient({ providerToken: "ptok" });
    mock.method(global, "fetch", async (url, init) => {
      assert.match(String(url), /\/v1\/provider\/tokens$/);
      assert.equal(init.method, "POST");
      assert.equal(init.headers.Authorization, "Bearer ptok");
      const body = JSON.parse(init.body);
      assert.equal(body.name, "edge-01");
      assert.equal(body.node_id, "node-1");
      return {
        ok: true,
        status: 201,
        statusText: "Created",
        text: async () =>
          JSON.stringify({ id: "t1", name: "edge-01", token: "raw-once" }),
      };
    });
    const out = await client.createProviderToken({
      name: "edge-01",
      nodeId: "node-1",
    });
    assert.equal(out.token, "raw-once");
  });

  it("getNodeConnect and earnings summary", async () => {
    const client = new ProxyHubClient({ accessToken: "jwt" });
    const calls = [];
    mock.method(global, "fetch", async (url, init) => {
      calls.push({ url: String(url), method: init.method });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({ ok: true }),
      };
    });
    await client.getNodeConnect("n1");
    await client.getEarningsSummary();
    await client.listMyListings({ page: 1, limit: 10 });
    await client.updateListing("l1", { status: "paused" });
    assert.match(calls[0].url, /\/v1\/provider\/nodes\/n1\/connect$/);
    assert.match(calls[1].url, /\/v1\/provider\/earnings\/summary$/);
    assert.match(calls[2].url, /\/v1\/listings\/my\?page=1&limit=10$/);
    assert.equal(calls[3].method, "PATCH");
  });
});
