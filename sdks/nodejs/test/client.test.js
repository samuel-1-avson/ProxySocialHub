"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { ProxyHubClient } = require("../index.js");

describe("ProxyHubClient", () => {
  it("requires apiKey", () => {
    assert.throws(() => new ProxyHubClient(""), TypeError);
  });

  it("defaults to api.proxyhubb.com", () => {
    const client = new ProxyHubClient("phub_test");
    assert.equal(client._baseUrl, "https://api.proxyhubb.com");
  });

  it("strips trailing slash from baseUrl", () => {
    const client = new ProxyHubClient("phub_test", "https://example.com/");
    assert.equal(client._baseUrl, "https://example.com");
  });
});
