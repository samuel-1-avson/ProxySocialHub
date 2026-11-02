// Runtime configuration. All values come from the environment; nothing is
// hard-coded except documented, overridable defaults. Secrets are only ever
// reported by presence (see describeConfig).

import path from "node:path";
import { fileURLToPath } from "node:url";

export interface AuditorConfig {
  host: string;
  port: number;
  nodeEnv: string;
  /** Shared secret used to verify HMAC-signed requests from the web server. */
  serviceSecret: string | null;
  dataDir: string;
  databaseUrl: string | null;
  /** Finished audits (and their screenshots) older than this are deleted. 0 keeps everything. */
  retentionDays: number;

  proxyEndpoint: string | null;
  allowedTargetOrigins: string[];
  allowedSubresourceOrigins: string[];
  allowNonReadOnlySubrequests: boolean;
  egressEchoUrl: string;
  geoipProvider: "ipwhois" | "none";
  fixtureEnabled: boolean;
  chromeExecutablePath: string | null;
  /** Extra Chromium flags for tests only (e.g. trusting one local test certificate). Rejected unless NODE_ENV=test. */
  testChromeArgs: string[];

  limits: {
    maxConcurrentJobs: number;
    maxConcurrentBrowsers: number;
    maxRegions: number;
    maxChecks: number;
    maxQueue: number;
    maxActiveJobsPerOwner: number;
    createsPerOwnerPerHour: number;
    navTimeoutMs: number;
    checkTimeoutMs: number;
    jobTimeoutMs: number;
    maxRequestsPerRegion: number;
    maxBytesPerRegion: number;
    maxRedirects: number;
    maxBodyBytes: number;
    maxVisibleTextChars: number;
  };

  model: {
    apiKey: string | null;
    baseUrl: string;
    id: string;
    dataMode: "standard" | "contributor";
    reasoningEffort: "low" | "medium" | "high";
    maxOutputTokens: number;
    timeoutMs: number;
    maxRetries: number;
    maxCallsPerJob: number;
    pricing: { inputPerMTok: number; cachedPerMTok: number; outputPerMTok: number; source: string } | null;
  };
}

const SERVICE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function int(env: NodeJS.ProcessEnv, name: string, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

function flag(env: NodeJS.ProcessEnv, name: string, fallback = false): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes";
}

function list(env: NodeJS.ProcessEnv, name: string): string[] {
  return (env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function origins(env: NodeJS.ProcessEnv, name: string): string[] {
  return list(env, name).map((raw) => {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`${name} contains an invalid origin: ${raw}`);
    }
    if (url.protocol !== "https:") throw new Error(`${name} only accepts https origins (got ${url.protocol})`);
    return url.origin;
  });
}

function float(env: NodeJS.ProcessEnv, name: string): number | null {
  const raw = env[name]?.trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return n;
}

/**
 * Documented list prices for Muse Spark 1.3 in standard mode, read from the
 * public pricing page. Used only when the operator has not configured prices,
 * and only to produce a figure labelled as an estimate.
 */
const DOCUMENTED_STANDARD_PRICES = {
  inputPerMTok: 1.25,
  cachedPerMTok: 0.15,
  outputPerMTok: 4.25,
  source: "https://dev.meta.ai/docs/pricing-rate-limits (Muse Spark standard mode, read 2026-11-01); verify before relying on it",
};

/**
 * Documented list prices for Muse Spark 1.3 in contributor mode: discounted in exchange for permission to use
 * prompts, files and responses to train future Meta models. Same rule as above: an estimate, never a bill.
 */
const DOCUMENTED_CONTRIBUTOR_PRICES = {
  inputPerMTok: 0.1,
  cachedPerMTok: 0.002,
  outputPerMTok: 0.2,
  source: "https://dev.meta.ai/docs/pricing-rate-limits (Muse Spark contributor mode, read 2026-11-02); verify before relying on it",
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AuditorConfig {
  const nodeEnv = env.NODE_ENV?.trim() || "development";
  const modelId = env.AUDITOR_MODEL?.trim() || "muse-spark-1.3";
  const contributorId = /-contributor$/.test(modelId);
  if (contributorId && !flag(env, "AUDITOR_ALLOW_CONTRIBUTOR_MODE")) {
    throw new Error(
      "AUDITOR_MODEL is a contributor-mode model (content is used to train future models). " +
        "Set AUDITOR_ALLOW_CONTRIBUTOR_MODE=1 only if you accept that for the data being audited.",
    );
  }

  const configuredIn = float(env, "AUDITOR_PRICE_INPUT_PER_MTOK_USD");
  const configuredCached = float(env, "AUDITOR_PRICE_CACHED_PER_MTOK_USD");
  const configuredOut = float(env, "AUDITOR_PRICE_OUTPUT_PER_MTOK_USD");
  let pricing: AuditorConfig["model"]["pricing"] = null;
  if (configuredIn !== null && configuredOut !== null) {
    pricing = {
      inputPerMTok: configuredIn,
      cachedPerMTok: configuredCached ?? configuredIn,
      outputPerMTok: configuredOut,
      source: env.AUDITOR_PRICE_SOURCE?.trim() || "operator-configured AUDITOR_PRICE_* values",
    };
  } else if (modelId === "muse-spark-1.3") {
    pricing = { ...DOCUMENTED_STANDARD_PRICES };
  } else if (modelId === "muse-spark-1.3-contributor") {
    pricing = { ...DOCUMENTED_CONTRIBUTOR_PRICES };
  }

  const effort = env.AUDITOR_MODEL_REASONING_EFFORT?.trim() || "low";
  if (effort !== "low" && effort !== "medium" && effort !== "high") {
    throw new Error("AUDITOR_MODEL_REASONING_EFFORT must be low, medium or high");
  }

  const geoip = env.AUDITOR_GEOIP_PROVIDER?.trim() || "ipwhois";
  if (geoip !== "ipwhois" && geoip !== "none") throw new Error("AUDITOR_GEOIP_PROVIDER must be ipwhois or none");

  const fixtureEnabled = flag(env, "AUDITOR_FIXTURE_ENABLED");
  if (fixtureEnabled && nodeEnv === "production") {
    throw new Error("AUDITOR_FIXTURE_ENABLED is a development-only harness and cannot be enabled when NODE_ENV=production");
  }

  return {
    host: env.AUDITOR_HOST?.trim() || "127.0.0.1",
    port: int(env, "AUDITOR_PORT", 4021, 1, 65535),
    nodeEnv,
    serviceSecret: env.AUDITOR_SERVICE_SECRET?.trim() || null,
    dataDir: path.resolve(env.AUDITOR_DATA_DIR?.trim() || path.join(SERVICE_DIR, ".data")),
    databaseUrl: env.AUDITOR_DATABASE_URL?.trim() || null,
    retentionDays: int(env, "AUDITOR_RETENTION_DAYS", 30, 0, 3650),

    proxyEndpoint: env.AUDITOR_PROXY_ENDPOINT?.trim() || null,
    allowedTargetOrigins: origins(env, "AUDITOR_ALLOWED_TARGET_ORIGINS"),
    allowedSubresourceOrigins: origins(env, "AUDITOR_ALLOWED_SUBRESOURCE_ORIGINS"),
    allowNonReadOnlySubrequests: flag(env, "AUDITOR_ALLOW_NON_READ_ONLY_SUBREQUESTS"),
    egressEchoUrl: env.AUDITOR_EGRESS_ECHO_URL?.trim() || "https://api.ipify.org/?format=json",
    geoipProvider: geoip,
    fixtureEnabled,
    chromeExecutablePath: env.AUDITOR_CHROME_PATH?.trim() || null,
    testChromeArgs: parseTestChromeArgs(env, nodeEnv),

    limits: {
      maxConcurrentJobs: int(env, "AUDITOR_MAX_CONCURRENT_JOBS", 1, 1, 8),
      maxConcurrentBrowsers: int(env, "AUDITOR_MAX_CONCURRENT_BROWSERS", 2, 1, 8),
      maxRegions: int(env, "AUDITOR_MAX_REGIONS", 2, 1, 4),
      maxChecks: int(env, "AUDITOR_MAX_CHECKS", 6, 0, 6),
      maxQueue: int(env, "AUDITOR_MAX_QUEUE", 20, 1, 500),
      maxActiveJobsPerOwner: int(env, "AUDITOR_MAX_ACTIVE_JOBS_PER_OWNER", 2, 1, 20),
      createsPerOwnerPerHour: int(env, "AUDITOR_CREATES_PER_OWNER_PER_HOUR", 20, 1, 1000),
      navTimeoutMs: int(env, "AUDITOR_NAV_TIMEOUT_MS", 30_000, 1000, 120_000),
      checkTimeoutMs: int(env, "AUDITOR_CHECK_TIMEOUT_MS", 8_000, 500, 60_000),
      jobTimeoutMs: int(env, "AUDITOR_JOB_TIMEOUT_MS", 240_000, 10_000, 1_800_000),
      maxRequestsPerRegion: int(env, "AUDITOR_MAX_REQUESTS_PER_REGION", 150, 5, 2000),
      maxBytesPerRegion: int(env, "AUDITOR_MAX_BYTES_PER_REGION", 15 * 1024 * 1024, 100_000, 200 * 1024 * 1024),
      maxRedirects: int(env, "AUDITOR_MAX_REDIRECTS", 5, 0, 10),
      maxBodyBytes: int(env, "AUDITOR_MAX_BODY_BYTES", 64 * 1024, 1024, 1024 * 1024),
      maxVisibleTextChars: int(env, "AUDITOR_MAX_VISIBLE_TEXT_CHARS", 6000, 500, 8000),
    },

    model: {
      apiKey: env.MODEL_API_KEY?.trim() || null,
      baseUrl: (env.AUDITOR_MODEL_BASE_URL?.trim() || "https://api.meta.ai/v1").replace(/\/$/, ""),
      id: modelId,
      dataMode: contributorId ? "contributor" : "standard",
      reasoningEffort: effort,
      maxOutputTokens: int(env, "AUDITOR_MODEL_MAX_OUTPUT_TOKENS", 8000, 500, 64_000),
      timeoutMs: int(env, "AUDITOR_MODEL_TIMEOUT_MS", 90_000, 5_000, 600_000),
      maxRetries: int(env, "AUDITOR_MODEL_MAX_RETRIES", 2, 0, 5),
      maxCallsPerJob: int(env, "AUDITOR_MAX_MODEL_CALLS_PER_JOB", 10, 1, 30),
      pricing,
    },
  };
}

/**
 * Test seam: lets an integration test trust one local certificate. It is fail-closed: setting it anywhere
 * but NODE_ENV=test is a startup error, so it can never silently weaken TLS in a real deployment.
 */
function parseTestChromeArgs(env: NodeJS.ProcessEnv, nodeEnv: string): string[] {
  const raw = env.AUDITOR_TEST_CHROME_ARGS?.trim();
  if (!raw) return [];
  if (nodeEnv !== "test") throw new Error("AUDITOR_TEST_CHROME_ARGS is only honoured when NODE_ENV=test; unset it.");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((a) => typeof a === "string" && a.startsWith("--"))) {
    throw new Error("AUDITOR_TEST_CHROME_ARGS must be a JSON array of Chromium flags");
  }
  return parsed as string[];
}

/** Presence-only description for logs and /capabilities. Never contains secret values. */
export function describeConfig(config: AuditorConfig) {
  return {
    signingConfigured: config.serviceSecret !== null,
    modelAccessConfigured: config.model.apiKey !== null,
    model: config.model.id,
    modelDataMode: config.model.dataMode,
    databaseConfigured: config.databaseUrl !== null,
    proxyEndpointConfigured: config.proxyEndpoint !== null,
    allowedTargetOriginCount: config.allowedTargetOrigins.length,
    fixtureEnabled: config.fixtureEnabled,
    geoipProvider: config.geoipProvider,
    limits: config.limits,
  };
}
