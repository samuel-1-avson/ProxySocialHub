"use strict";

/**
 * ProxyHubb Node.js SDK
 *
 * Requires Node 18+ (uses the built-in fetch API).
 */

const DEFAULT_BASE_URL = "https://api.proxyhubb.com";
const DEFAULT_PROXY_ENDPOINT = "proxy.proxyhubb.com:8090";

function defaultProxyEndpoint() {
  return (
    (process.env.PROXYHUBB_PROXY_ENDPOINT || "").trim() || DEFAULT_PROXY_ENDPOINT
  );
}

function stripScheme(host) {
  return String(host || "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "");
}

/**
 * Build an HTTP proxy URL for CONNECT clients.
 * @param {string} username
 * @param {string} password
 * @param {string} [host]
 * @returns {string}
 */
function proxyUrl(username, password, host) {
  const endpoint = stripScheme(host || defaultProxyEndpoint());
  const user = encodeURIComponent(username);
  const pass = encodeURIComponent(password);
  return `http://${user}:${pass}@${endpoint}`;
}

/**
 * Proxy URL for session-intent auth (Connect rotating/sticky).
 * @param {string} token
 * @param {string} [host]
 * @returns {string}
 */
function sessionIntentProxyUrl(token, host) {
  return proxyUrl("session-intent", token, host);
}

class ProxyHubClient {
  /**
   * @param {object|string} optionsOrApiKey
   * @param {string} [optionsOrApiKey.apiKey]
   * @param {string} [optionsOrApiKey.accessToken] Dashboard JWT for intents/credentials
   * @param {string} [optionsOrApiKey.baseUrl]
   * @param {string} [optionsOrApiKey.proxyEndpoint]
   * @param {string} [baseUrl] Legacy: second arg when first is apiKey string
   */
  constructor(optionsOrApiKey, baseUrl) {
    let apiKey = "";
    let accessToken = "";
    let resolvedBase = DEFAULT_BASE_URL;
    let proxyEndpoint = defaultProxyEndpoint();

    if (typeof optionsOrApiKey === "string") {
      apiKey = optionsOrApiKey;
      if (typeof baseUrl === "string" && baseUrl) {
        resolvedBase = baseUrl;
      }
    } else if (optionsOrApiKey && typeof optionsOrApiKey === "object") {
      apiKey = optionsOrApiKey.apiKey || "";
      accessToken = optionsOrApiKey.accessToken || "";
      if (optionsOrApiKey.baseUrl) resolvedBase = optionsOrApiKey.baseUrl;
      if (optionsOrApiKey.proxyEndpoint) {
        proxyEndpoint = optionsOrApiKey.proxyEndpoint;
      }
    } else {
      throw new TypeError("apiKey or accessToken is required");
    }

    if (!apiKey && !accessToken) {
      throw new TypeError("apiKey or accessToken is required");
    }

    this._apiKey = apiKey;
    this._accessToken = accessToken;
    this._baseUrl = resolvedBase.replace(/\/$/, "");
    this._proxyEndpoint = stripScheme(proxyEndpoint);
  }

  /** @returns {string} */
  get proxyEndpoint() {
    return this._proxyEndpoint;
  }

  /**
   * @param {string} token
   */
  setAccessToken(token) {
    this._accessToken = token || "";
  }

  /** @private */
  _url(path) {
    return `${this._baseUrl}${path}`;
  }

  /** @private */
  async _request(method, path, body) {
    const headers = {
      "Content-Type": "application/json",
    };
    if (this._apiKey) {
      headers["X-API-Key"] = this._apiKey;
    }
    if (this._accessToken) {
      headers.Authorization = `Bearer ${this._accessToken}`;
    }

    const init = { method, headers };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const res = await fetch(this._url(path), init);

    if (res.status === 204) return null;

    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text };
      }
    }

    if (!res.ok) {
      const message = data?.error || res.statusText;
      throw new Error(`ProxyHubb API error ${res.status}: ${message}`);
    }

    return data;
  }

  /**
   * Issue a signed session intent (requires accessToken / JWT).
   *
   * @param {"rotating"|"sticky"|string} type
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async createSessionIntent(type = "rotating", options = {}) {
    if (type !== "rotating" && type !== "sticky") {
      throw new TypeError("type must be 'rotating' or 'sticky'");
    }
    const payload = { type };
    const map = {
      listingId: "listing_id",
      bandwidthLimit: "bandwidth_limit",
      targetGeo: "target_geo",
      targetIsp: "target_isp",
      routingProfile: "routing_profile",
      allowedDomains: "allowed_domains",
      blockedDomains: "blocked_domains",
      rotationType: "rotation_type",
      rotationIntervalSeconds: "rotation_interval_seconds",
      timeLimitMinutes: "time_limit_minutes",
      preferredTier: "preferred_tier",
      maxPricePerGb: "max_price_per_gb",
    };
    for (const [camel, snake] of Object.entries(map)) {
      if (options[camel] !== undefined) payload[snake] = options[camel];
      if (options[snake] !== undefined) payload[snake] = options[snake];
    }
    return this._request("POST", "/v1/sessions/intent", payload);
  }

  /**
   * @param {string} token
   * @returns {string}
   */
  sessionIntentProxyUrl(token) {
    return sessionIntentProxyUrl(token, this._proxyEndpoint);
  }

  /**
   * Fetch proxy credentials after escrow activation (requires JWT).
   * @param {string} orderId
   * @returns {Promise<object>}
   */
  async getOrderCredentials(orderId) {
    if (!orderId) throw new TypeError("orderId is required");
    return this._request("GET", `/v1/orders/${orderId}/credentials`);
  }

  /**
   * Build proxy URL from credentials envelope or object.
   * @param {object} credentials
   * @returns {string}
   */
  proxyUrlFromCredentials(credentials) {
    const creds = credentials.proxy_credentials || credentials;
    let host = creds.host || creds.endpoint || this._proxyEndpoint;
    if (creds.port && !String(host).includes(":")) {
      host = `${host}:${creds.port}`;
    }
    return proxyUrl(creds.username, creds.password, host);
  }

  /**
   * Create an HttpsProxyAgent for the given proxy URL.
   * Requires optional peer dependency: `npm install https-proxy-agent`
   *
   * @param {string} proxyUrlString
   * @returns {import("https-proxy-agent").HttpsProxyAgent}
   */
  createHttpsProxyAgent(proxyUrlString) {
    let HttpsProxyAgent;
    try {
      ({ HttpsProxyAgent } = require("https-proxy-agent"));
    } catch {
      throw new Error(
        "Optional dependency https-proxy-agent is required. Run: npm install https-proxy-agent"
      );
    }
    return new HttpsProxyAgent(proxyUrlString);
  }

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
   * List proxy pools for the authenticated account.
   * @returns {Promise<object>} Object with `pools` and `total`.
   */
  async listPools() {
    return this._request("GET", "/v1/bulk/pools");
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

  /**
   * Proxy URL for a pool endpoint index.
   * @param {string} poolId
   * @param {number} [index=0]
   * @returns {Promise<string>}
   */
  async proxyUrlForPool(poolId, index = 0) {
    const endpoints = await this.getProxies(poolId);
    if (!endpoints.length) {
      throw new Error(`Pool ${poolId} has no endpoints`);
    }
    if (index >= endpoints.length) {
      throw new RangeError(
        `index ${index} is out of range for pool with ${endpoints.length} endpoints`
      );
    }
    const ep = endpoints[index];
    return proxyUrl(ep.username, ep.password, `${ep.host}:${ep.port}`);
  }
}

module.exports = {
  ProxyHubClient,
  DEFAULT_BASE_URL,
  DEFAULT_PROXY_ENDPOINT,
  defaultProxyEndpoint,
  proxyUrl,
  sessionIntentProxyUrl,
};
