/**
 * The node doctor, explained: check a model-drafted explanation of the node's own health checks.
 *
 * The deterministic checks in `provider-node doctor` are the source of truth. The model only
 * explains them and orders the fix steps in plain words. Everything here is deterministic: the
 * node sends only check ids, severities and remediation codes (never its messages, which can
 * hold file paths, and never any key), and a step may cite only a check that actually failed.
 *
 * No imports, so `node --test` can load this file directly.
 */

/** What one node doctor check came to, as the node sends it (no message text, no paths). */
export interface DoctorCheck {
  id: string;
  ok: boolean;
  severity: "info" | "warn" | "error";
  /** The doctor's `remediation_code`, when the check has one. */
  code?: string;
}

export interface DoctorStep {
  title: string;
  detail: string;
  /** The failed check this step belongs to, or `null` for a general step. */
  checkId: string | null;
}

export interface DoctorNote {
  level: "info" | "warning" | "blocked";
  message: string;
}

export interface DoctorPlan {
  summary: string;
  /** Ordered: steps for errors first, then warnings, then general steps. */
  steps: DoctorStep[];
  /** The checks that did not pass, with what they mean in plain words. */
  failed: { id: string; severity: "warn" | "error"; meaning: string }[];
  /** How many checks passed. */
  passed: number;
  assumptions: string[];
  cannotDo: string[];
  notes: DoctorNote[];
  /** Every check passed. */
  healthy: boolean;
  /** The draft could not be used; show the plain findings instead. */
  refused: boolean;
}

export const MAX_DOCTOR_CHECKS = 64;
const MAX_STEPS = 6;
const MAX_GENERAL_STEPS = 2;
const MAX_SUMMARY_CHARS = 280;
const MAX_TITLE_CHARS = 80;
const MAX_DETAIL_CHARS = 300;
const MAX_TEXT_ITEMS = 8;
const MAX_TEXT_CHARS = 200;

const ID_RE = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * What each remediation code means, for the model and the window. Kept in step with the codes
 * in services/provider-node/src/doctor.rs (its tests pin them) and the provider app's wording
 * in apps/provider-app/src-tauri/src/diagnosis.rs.
 */
export const CODE_MEANINGS: Record<string, string> = {
  config_missing: "This computer is not connected to an account yet (no node settings file).",
  config_parse_failed: "The node's settings file cannot be read.",
  credentials_missing: "The node's settings hold no key for ProxyHubb.",
  control_api_url_missing: "The node's settings do not say where ProxyHubb's servers are.",
  control_api_unreachable: "This computer cannot reach ProxyHubb's servers.",
  control_api_unhealthy: "ProxyHubb's servers answered with an error.",
  provider_auth_failed: "ProxyHubb's servers did not confirm this computer's key (it may have been revoked, or the servers could not be reached to check).",
  jwt_token_only: "The node's settings hold a short-lived token instead of a lasting key.",
  gateway_missing: "The node's settings list no gateway to connect through.",
  gateway_invalid: "A gateway address in the node's settings cannot be used.",
  gateway_dns_failed: "This computer could not look up ProxyHubb's gateway address.",
  gateway_tcp_unreachable: "This computer could not open a connection to ProxyHubb's gateway.",
  gateway_tls_failed: "The secure connection to ProxyHubb's gateway could not be set up.",
  gateway_udp_unreachable: "This computer could not reach ProxyHubb's gateway over UDP.",
  gateway_udp_socket_failed: "This computer could not open a UDP socket for the gateway connection.",
  signing_key_missing: "The node's signing key is missing from its settings.",
  signing_key_invalid: "The node's signing key in its settings cannot be used.",
  quic_feature_missing: "The settings ask for QUIC but this node build has no QUIC.",
  quic_tls_config: "The QUIC secure-connection settings cannot be used.",
  tls_required_public_gateway: "The settings would connect to a public gateway without encryption.",
  daemon_not_running: "The node is not running on this computer.",
  daemon_stale_pid: "A previous run of the node left a stale marker behind.",
  daemon_pid_reused: "The node's marker points at a different program that is running now.",
  metrics_unreachable: "The node is not answering its local status checks.",
  metrics_unhealthy: "The node's local status checks answered with an error.",
};

export function meaningFor(check: DoctorCheck): string {
  return (check.code && CODE_MEANINGS[check.code]) || "A problem the node's checks found.";
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function cleanText(v: unknown): string[] {
  return strings(v)
    .map((s) => s.trim().slice(0, MAX_TEXT_CHARS))
    .filter(Boolean)
    .slice(0, MAX_TEXT_ITEMS);
}

function cleanOne(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * Read the checks the node sent. Only ids, outcomes, severities and codes survive; anything
 * else a caller puts in (messages, paths, keys) is dropped here and never reaches the model.
 * Returns `null` when the shape itself is wrong.
 */
export function parseDoctorChecks(raw: unknown): DoctorCheck[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_DOCTOR_CHECKS) return null;
  const checks: DoctorCheck[] = [];
  for (const item of raw) {
    const c = asRecord(item);
    if (typeof c.id !== "string" || !ID_RE.test(c.id)) return null;
    if (typeof c.ok !== "boolean") return null;
    if (c.severity !== "info" && c.severity !== "warn" && c.severity !== "error") return null;
    const check: DoctorCheck = { id: c.id, ok: c.ok, severity: c.severity };
    if (typeof c.code === "string" && ID_RE.test(c.code)) check.code = c.code;
    checks.push(check);
  }
  return checks;
}

/** The checks that did not pass and are worth explaining (failed info checks are not findings). */
export function failedChecks(checks: DoctorCheck[]): DoctorCheck[] {
  return checks.filter((c) => !c.ok && c.severity !== "info");
}

/**
 * Check a drafted explanation against the checks it explains. A step survives only when it
 * cites a check that actually failed, or is a general step (`check_id` ""), of which at most
 * two are kept. The summary is the model's, or a plain count when it gave none.
 */
export function checkDoctorDraft(raw: unknown, checks: DoctorCheck[]): DoctorPlan {
  const d = asRecord(raw);
  const refused = !raw || typeof raw !== "object" || Array.isArray(raw);
  const notes: DoctorNote[] = [];
  if (refused) notes.push({ level: "blocked", message: "The explanation could not be read. The check results above still stand." });

  const failed = failedChecks(checks);
  const failedById = new Map(failed.map((c) => [c.id, c]));
  const passed = checks.filter((c) => c.ok).length;
  const healthy = failed.length === 0;

  let dropped = 0;
  let general = 0;
  const steps: DoctorStep[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(d.steps) ? d.steps : []) {
    const s = asRecord(item);
    const title = cleanOne(s.title, MAX_TITLE_CHARS);
    const detail = cleanOne(s.detail, MAX_DETAIL_CHARS);
    if (!title || !detail) continue;
    const cited = typeof s.check_id === "string" ? s.check_id : "";
    let checkId: string | null;
    if (cited === "") {
      if (general >= MAX_GENERAL_STEPS) continue;
      general += 1;
      checkId = null;
    } else if (failedById.has(cited)) {
      checkId = cited;
    } else {
      dropped += 1;
      continue;
    }
    const key = `${checkId ?? ""}|${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    steps.push({ title, detail, checkId });
    if (steps.length >= MAX_STEPS) break;
  }
  if (dropped > 0) {
    notes.push({ level: "info", message: "Some suggestions did not match the checks and were left out." });
  }

  const rank = (step: DoctorStep) => {
    if (step.checkId === null) return 2;
    return failedById.get(step.checkId)?.severity === "error" ? 0 : 1;
  };
  const ordered = steps
    .map((step, i) => ({ step, i }))
    .sort((a, b) => rank(a.step) - rank(b.step) || a.i - b.i)
    .map(({ step }) => step);

  let summary = refused ? "" : cleanOne(d.summary, MAX_SUMMARY_CHARS);
  if (!summary) {
    if (healthy) {
      summary = checks.length
        ? `All ${passed} checks passed. Nothing wrong was found on this computer.`
        : "No checks were run.";
    } else {
      const errors = failed.filter((c) => c.severity === "error").length;
      const warnings = failed.length - errors;
      summary =
        `The checks found ${errors} problem${errors === 1 ? "" : "s"}` +
        (warnings ? ` and ${warnings} thing${warnings === 1 ? "" : "s"} worth knowing` : "") +
        `. ${passed} check${passed === 1 ? "" : "s"} passed.`;
    }
  }

  return {
    summary,
    steps: refused ? [] : ordered,
    failed: failed.map((c) => ({ id: c.id, severity: c.severity as "warn" | "error", meaning: meaningFor(c) })),
    passed,
    assumptions: refused ? [] : cleanText(d.assumptions),
    cannotDo: refused ? [] : cleanText(d.cannot_do),
    notes,
    healthy,
    refused,
  };
}
