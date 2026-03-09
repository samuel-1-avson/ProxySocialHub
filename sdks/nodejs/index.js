"use strict";

/**
 * ProxyHub Node.js SDK
 *
 * Requires Node 18+ (uses the built-in fetch API).
 */

class ProxyHubClient {
  /**
   * @param {string} apiKey   A ProxyHub API key starting with `phub_`.
   * @param {string} [baseUrl] Base URL of the ProxyHub API.
   */
  constructor(apiKey, baseUrl = "https://api.proxyhubb.io") {
    this._apiKey = apiKey;
    this._baseUrl = baseUrl.replace(/\/$/, "");
  }

  /** @private */
  _url(path) {
    return `${this._baseUrl}${path}`;
  }

  /** @private */
  async _request(method, path, body) {
    const init = {
      method,
      headers: {
        "X-API-Key": this._apiKey,
        "Content-Type": "application/json",
      },
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const res = await fetch(this._url(path), init);

    if (res.status === 204) return null;

    const data = await res.json();

    if (!res.ok) {
      const message = data?.error || res.statusText;
      throw new Error(`ProxyHub API error ${res.status}: ${message}`);
    }

    return data;
  }

  // ── Pool methods ──────────────────────────────────────────────────────────

  /**
   * Create a new proxy pool.
   *
   * @param {string} name            Human-readable pool name (1-100 chars).
   * @param {object} [options]
   * @param {number} [options.size=10]              Number of endpoints (1-100).
   * @param {string} [options.sessionType="rotating"] "rotating" or "sticky".
   * @param {string} [options.description=""]
   * @param {number} [options.bytesLimit=0]         0 = unlimited.
   * @returns {Promise<object>} The created pool.
   */
  async createPool(name, options = {}) {
    const {
      size = 10,
      sessionType = "rotating",
      description = "",
      bytesLimit = 0,
    } = options;

    return this._request("POST", "/v1/bulk/pools", {
      name,
      size,
      session_type: sessionType,
      description,
      bytes_limit: bytesLimit,
    });
  }

  /**
   * Get the endpoints of a proxy pool.
   *
   * @param {string} poolId UUID of the pool.
   * @returns {Promise<object>} Object with `pool_id`, `endpoints`, and `count`.
   */
  async getPool(poolId) {
    return this._request("GET", `/v1/bulk/pools/${poolId}/endpoints`);
  }

  /**
   * Return the list of endpoint objects for a pool.
   *
   * @param {string} poolId UUID of the pool.
   * @returns {Promise<Array<object>>} Array of endpoint objects.
   */
  async getProxies(poolId) {
    const data = await this.getPool(poolId);
    return data?.endpoints ?? [];
  }

  /**
   * Soft-delete a proxy pool (sets status to "deleted").
   *
   * @param {string} poolId UUID of the pool.
   * @returns {Promise<null>}
   */
  async revokePool(poolId) {
    return this._request("DELETE", `/v1/bulk/pools/${poolId}`);
  }
}

module.exports = { ProxyHubClient };
