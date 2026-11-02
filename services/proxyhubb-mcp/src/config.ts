// Configuration from the environment. Secrets are read here and nowhere else,
// and are never logged or returned from a tool (see redact.ts).

export interface ProxyHubbConfig {
  baseUrl: string;
  proxyEndpoint: string;
  /** Dashboard JWT (Bearer). Required to create session intents. */
  accessToken: string;
  /** Scoped machine API key (X-API-Key, phub_…), when used instead of / alongside a JWT. */
  apiKey: string;
  /** HTTPS endpoint that echoes the caller's IP as JSON ({"ip": …}) or plain text. */
  echoUrl: string;
  requestTimeoutMs: number;
}

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function loadConfig(overrides: Partial<ProxyHubbConfig> = {}): ProxyHubbConfig {
  const timeout = Number(env("PROXYHUBB_TIMEOUT_MS"));
  return {
    baseUrl: (overrides.baseUrl ?? env("PROXYHUBB_BASE_URL") ?? "") || "https://api.proxyhubb.com",
    proxyEndpoint:
      (overrides.proxyEndpoint ?? env("PROXYHUBB_PROXY_ENDPOINT") ?? "") || "proxy.proxyhubb.com:8090",
    accessToken: overrides.accessToken ?? env("PROXYHUBB_ACCESS_TOKEN"),
    apiKey: overrides.apiKey ?? env("PROXYHUBB_API_KEY"),
    echoUrl: (overrides.echoUrl ?? env("PROXYHUBB_ECHO_URL") ?? "") || "https://api.ipify.org?format=json",
    requestTimeoutMs:
      overrides.requestTimeoutMs ?? (Number.isFinite(timeout) && timeout > 0 ? timeout : 15_000),
  };
}

export function stripScheme(host: string): string {
  return host.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

/** Build the HTTP proxy URL for session-intent credentials. The token is a credential: treat the URL as a secret. */
export function sessionIntentProxyUrl(token: string, endpoint: string): string {
  return `http://session-intent:${encodeURIComponent(token)}@${stripScheme(endpoint)}`;
}
