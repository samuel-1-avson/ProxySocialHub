/** HMAC CONNECT password for the published buyer edge. Never use phubb1. on :8090. */

export const CAPABILITY_PREFIX = 'phubb1.';
export const SOAK_PORT = 18091;

export type ProxyCredentialFields = {
  protocol?: string;
  username?: string;
  password?: string;
  legacy_password?: string;
  auth_for_endpoint?: string;
  host?: string;
  port?: number;
  endpoint?: string;
  expires_at?: string;
};

export type CredentialsEnvelope = ProxyCredentialFields & {
  proxy_credentials?: ProxyCredentialFields;
  session_capability?: string;
  expires_at?: string;
};

export type HmacConnectTarget = {
  protocol: "http" | "https";
  username: string;
  password: string;
  host: string;
  port: number;
  endpoint: string;
};

export function looksLikeCapabilityToken(value: string | undefined): boolean {
  return Boolean(value && value.trim().startsWith(CAPABILITY_PREFIX));
}

export function parseHostPort(endpoint: string, fallbackPort = 8090): { host: string; port: number } {
  const trimmed = endpoint.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
  const colon = trimmed.lastIndexOf(':');
  if (colon <= 0) {
    return { host: trimmed, port: fallbackPort };
  }
  const host = trimmed.slice(0, colon);
  const port = Number.parseInt(trimmed.slice(colon + 1), 10);
  if (!host || !Number.isFinite(port) || port <= 0) {
    throw new Error('invalid proxy endpoint');
  }
  return { host, port };
}

function innerCreds(envelope: CredentialsEnvelope): ProxyCredentialFields {
  return envelope.proxy_credentials ?? envelope;
}

/**
 * Password Chrome must send to the published HMAC edge.
 * If live enforce still put phubb1. in `password`, fall back to `legacy_password`.
 */
export function hmacPasswordForPublishedEdge(envelope: CredentialsEnvelope): string {
  const creds = innerCreds(envelope);
  if (creds.auth_for_endpoint === 'capability') {
    throw new Error('credentials are capability-only; public CONNECT needs HMAC');
  }
  const primary = (creds.password ?? '').trim();
  const legacy = (creds.legacy_password ?? '').trim();
  if (primary && !looksLikeCapabilityToken(primary)) {
    return primary;
  }
  if (legacy && !looksLikeCapabilityToken(legacy)) {
    return legacy;
  }
  throw new Error('no HMAC password for public :8090 (capability token is soak-only)');
}

export function hmacConnectTarget(envelope: CredentialsEnvelope): HmacConnectTarget {
  const creds = innerCreds(envelope);
  const username = (creds.username ?? '').trim();
  if (!username) {
    throw new Error('missing proxy username');
  }
  const password = hmacPasswordForPublishedEdge(envelope);
  const endpoint =
    (creds.endpoint ?? '').trim() ||
    (creds.host && creds.port ? `${creds.host}:${creds.port}` : 'proxy.proxyhubb.com:8090');
  const { host, port } = parseHostPort(endpoint, typeof creds.port === 'number' ? creds.port : 8090);
  if (port === SOAK_PORT) {
    throw new Error('Host-A soak :18091 is not the public Connect target');
  }
  const protocol = creds.protocol;
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (protocol !== "https" && !(protocol === "http" && local)) {
    throw new Error("Encrypted proxy transport is required. Refresh the credentials or contact support.");
  }
  return { username, password, host, port, protocol, endpoint: `${host}:${port}` };
}
