// Tool output goes to an AI agent and its transcript. Anything that looks like
// a credential or personal identifier is removed before API responses are
// passed through. Proxy URLs are the one deliberate exception: returning one
// is the purpose of create_agent_session, and its output says so explicitly.

const SECRET_KEY =
  /password|passwd|secret|token|api[_-]?key|authorization|private[_-]?key|seed|mnemonic|wallet[_-]?key|credential/i;
const PII_KEY = /email|phone|full[_-]?name/i;

export function isSensitiveKey(key: string): boolean {
  return SECRET_KEY.test(key) || PII_KEY.test(key);
}

/** Deep-copy a JSON value with sensitive keys removed. Depth- and size-bounded. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) continue;
      out[k] = redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 2000) return `${value.slice(0, 2000)}…[truncated]`;
  return value;
}

/** Mask credentials inside a proxy URL for logs. Never used on the tool result itself. */
export function maskProxyUrl(proxyUrl: string): string {
  try {
    const u = new URL(proxyUrl);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "[unparseable proxy url]";
  }
}
