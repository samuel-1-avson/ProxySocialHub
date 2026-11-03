/**
 * Agent concierge: check a model-drafted session request before the buyer sees it.
 *
 * The model only proposes. Everything here is deterministic: values outside the
 * allowed sets are dropped, limits match the MCP server (services/proxyhubb-mcp),
 * a budget becomes a bandwidth cap computed here (never by the model), and a
 * country without active listings blocks the plan instead of being swapped for
 * another one. The buyer approves the result before anything is created.
 *
 * No imports, so `node --test` can load this file directly.
 */

export const LIMITS = {
  minMb: 5,
  maxMb: 10_240,
  defaultMb: 100,
  minMinutes: 1,
  maxMinutes: 240,
  defaultMinutes: 20,
  defaultIntervalSeconds: 60,
  maxDomains: 50,
  maxTextItems: 8,
  maxTextChars: 200,
} as const;

/** Billing divides bytes by 1024^3 (control-api internal/billing/price.go). */
export const BYTES_PER_GB = 1024 * 1024 * 1024;
const BYTES_PER_MB = 1024 * 1024;
const MB_PER_GB = 1024;

const SESSION_TYPES = ["rotating", "sticky"] as const;
const ROTATIONS = ["none", "per-request", "time-based"] as const;
const TIERS = ["Bronze", "Silver", "Gold"] as const;
const PURPOSE_FLAGS = ["ok", "unclear", "abusive"] as const;

export type SessionType = (typeof SESSION_TYPES)[number];
export type Rotation = (typeof ROTATIONS)[number];
export type Tier = (typeof TIERS)[number];
export type PurposeFlag = (typeof PURPOSE_FLAGS)[number];

/** What the model returns. Null means "the buyer did not say". */
export interface ConciergeDraft {
  session_type: SessionType;
  country: string | null;
  rotation: Rotation | null;
  rotation_interval_seconds: number | null;
  max_mb: number | null;
  time_limit_minutes: number | null;
  max_price_per_gb: number | null;
  budget_usd: number | null;
  preferred_tier: Tier | null;
  allowed_domains: string[];
  blocked_domains: string[];
  purpose_flag: PurposeFlag;
  assumptions: string[];
  cannot_do: string[];
}

/** One active marketplace listing. The listings API does not say whether its node is online right now. */
export interface MarketListing {
  country: string;
  pricePerGB: number;
}

/** Active listings with a usable country and price, from GET /v1/listings (array or { listings: [...] }). */
export function marketFromListings(body: unknown): MarketListing[] {
  const rec = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const rows: unknown[] = Array.isArray(body) ? body : Array.isArray(rec.listings) ? rec.listings : [];
  const out: MarketListing[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const l = row as Record<string, unknown>;
    if (l.status !== undefined && l.status !== "active") continue;
    const country = typeof l.country === "string" ? l.country.trim().toUpperCase() : "";
    const price = l.price_per_gb;
    if (!/^[A-Z]{2}$/.test(country) || typeof price !== "number" || !Number.isFinite(price) || price < 0) continue;
    out.push({ country, pricePerGB: price });
  }
  return out;
}

/** Body for POST /v1/sessions/intent; a subset of CreateSessionIntentRequest in lib/api/sessions.ts. */
export interface PlannedIntent {
  type: SessionType;
  bandwidth_limit: number;
  time_limit_minutes: number;
  rotation_type: Rotation;
  rotation_interval_seconds?: number;
  target_geo?: string;
  max_price_per_gb?: number;
  preferred_tier?: Tier;
  allowed_domains?: string[];
  blocked_domains?: string[];
}

export interface PlanNote {
  level: "info" | "warning" | "blocked";
  field: keyof ConciergeDraft | "draft";
  message: string;
}

export interface CheckedPlan {
  intent: PlannedIntent;
  /** What the escrow locks: bandwidth cap x price limit. Null when nothing matches or no price limit can be set. */
  maxCostUsd: number | null;
  /** Active listings the plan can route to after the country and price filters. */
  matchingListings: number;
  notes: PlanNote[];
  assumptions: string[];
  cannotDo: string[];
  /** At least one "blocked" note: the buyer must change the plan before it can be created. */
  blocked: boolean;
}

const CC = /^[A-Z]{2}$/;
// At least one dot: bare names such as "localhost" mean nothing through a residential exit.
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](-*[a-z0-9])*\.)+[a-z][a-z0-9-]*[a-z0-9]$/;

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function pick<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function usd(v: number): string {
  return `$${v.toFixed(2)}`;
}

function cleanText(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is string => typeof s === "string" && s.trim() !== "")
    .map((s) => s.trim().slice(0, LIMITS.maxTextChars))
    .slice(0, LIMITS.maxTextItems);
}

/** Bare lowercase hostnames; full URLs are reduced to their host. Returns what was left out. */
export function normalizeDomains(v: unknown): { hosts: string[]; rejected: string[]; truncated: boolean } {
  const hosts: string[] = [];
  const rejected: string[] = [];
  if (!Array.isArray(v)) return { hosts, rejected, truncated: false };
  for (const raw of v) {
    if (typeof raw !== "string") continue;
    const host = raw.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0]?.split(":")[0]?.replace(/\.$/, "") ?? "";
    if (!HOSTNAME.test(host)) {
      if (raw.trim()) rejected.push(raw.trim().slice(0, 80));
      continue;
    }
    if (!hosts.includes(host)) hosts.push(host);
  }
  const truncated = hosts.length > LIMITS.maxDomains;
  return { hosts: hosts.slice(0, LIMITS.maxDomains), rejected, truncated };
}

/** Largest whole-MB cap whose cost at `pricePerGB` stays within `budgetUsd`. */
export function budgetToMb(budgetUsd: number, pricePerGB: number): number {
  let mb = Math.floor((budgetUsd * MB_PER_GB) / pricePerGB);
  while (mb > 0 && (mb / MB_PER_GB) * pricePerGB > budgetUsd) mb -= 1;
  return mb;
}

export function checkDraft(raw: unknown, market: MarketListing[]): CheckedPlan {
  const d = asRecord(raw);
  const notes: PlanNote[] = [];
  const note = (level: PlanNote["level"], field: PlanNote["field"], message: string) => notes.push({ level, field, message });

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    note("blocked", "draft", "The draft could not be read. Fill in the form yourself.");
  }

  const purpose = pick(d.purpose_flag, PURPOSE_FLAGS) ?? "unclear";
  if (purpose === "abusive") {
    note("blocked", "purpose_flag", "This looks like a use ProxyHubb providers do not allow (for example account takeover, scalping or getting around paywalls). Nothing will be created.");
  } else if (purpose === "unclear") {
    note("info", "purpose_flag", "The purpose was not clear. Only use this session on sites you are allowed to access.");
  }

  let type = pick(d.session_type, SESSION_TYPES);
  if (!type) {
    type = "rotating";
    note("info", "session_type", "No session type given: using rotating.");
  }

  const minutesRaw = finite(d.time_limit_minutes);
  let minutes: number = LIMITS.defaultMinutes;
  if (minutesRaw === null) {
    note("info", "time_limit_minutes", `No time limit given: ${LIMITS.defaultMinutes} minutes.`);
  } else {
    minutes = Math.min(LIMITS.maxMinutes, Math.max(LIMITS.minMinutes, Math.round(minutesRaw)));
    if (minutes !== minutesRaw) note("warning", "time_limit_minutes", `Time limit set to ${minutes} minutes (allowed: ${LIMITS.minMinutes}-${LIMITS.maxMinutes}).`);
  }

  let rotation = pick(d.rotation, ROTATIONS);
  const intervalRaw = finite(d.rotation_interval_seconds);
  let interval: number | undefined;
  if (type === "sticky") {
    if (rotation && rotation !== "none") note("warning", "rotation", "A sticky session keeps one exit, so rotation is off.");
    rotation = "none";
  } else {
    if (rotation === "none") {
      note("warning", "rotation", "A rotating session needs rotation: using per-request. Choose sticky to keep one exit.");
      rotation = "per-request";
    }
    if (!rotation) rotation = intervalRaw !== null ? "time-based" : "per-request";
    if (rotation === "time-based") {
      if (intervalRaw === null || intervalRaw < 1) {
        interval = LIMITS.defaultIntervalSeconds;
        note("info", "rotation_interval_seconds", `No rotation interval given: every ${interval} seconds.`);
      } else {
        interval = Math.round(intervalRaw);
      }
      if (interval >= minutes * 60) note("warning", "rotation_interval_seconds", "The interval is longer than the session, so the exit will not rotate.");
    }
  }

  const listings = market.filter((l) => CC.test(l.country) && Number.isFinite(l.pricePerGB) && l.pricePerGB >= 0);
  let country: string | undefined;
  let pool = listings;
  if (typeof d.country === "string" && d.country.trim()) {
    const c = d.country.trim().toUpperCase();
    if (!CC.test(c)) {
      note("blocked", "country", `"${d.country.trim().slice(0, 40)}" is not a two-letter country code.`);
    } else {
      country = c;
      pool = listings.filter((l) => l.country === c);
      if (pool.length === 0) {
        note("blocked", "country", `No active listings in ${c} right now. Pick another country or remove it; the plan never swaps in a different one.`);
      }
    }
  } else if (listings.length === 0) {
    note("blocked", "country", "There are no active listings right now, so no session can route.");
  } else {
    note("info", "country", "No country given: the exit can be in any country with an active listing.");
  }

  let priceCap: number | undefined;
  const priceRaw = finite(d.max_price_per_gb);
  if (d.max_price_per_gb !== null && d.max_price_per_gb !== undefined) {
    if (priceRaw === null || priceRaw <= 0) {
      note("warning", "max_price_per_gb", "The price limit was not a positive number, so it was left out.");
    } else {
      priceCap = priceRaw;
    }
  }
  const buyerCap = priceCap;
  const matching = buyerCap === undefined ? pool : pool.filter((l) => l.pricePerGB <= buyerCap);
  if (buyerCap !== undefined && pool.length > 0 && matching.length === 0) {
    const cheapest = Math.min(...pool.map((l) => l.pricePerGB));
    note("blocked", "max_price_per_gb", `No active listing${country ? ` in ${country}` : ""} is priced at or below ${usd(buyerCap)}/GB (cheapest: ${usd(cheapest)}/GB).`);
  }
  const ceiling = matching.length > 0 ? Math.max(...matching.map((l) => l.pricePerGB)) : null;
  // Without a listing, the escrow is priced at the intent's price limit, or a node's price, or $0.99/GB
  // (control-api session_intent_state.go, session_intent_escrow.go). Always sending a limit keeps the
  // cost shown here equal to what the buyer is asked to lock.
  if (priceCap === undefined && ceiling !== null && ceiling > 0) {
    priceCap = ceiling;
    note("info", "max_price_per_gb", `Price limit set to ${usd(ceiling)}/GB, the most expensive matching listing today, so the cost shown is what the escrow locks.`);
  } else if (priceCap === undefined && ceiling === 0) {
    note("info", "max_price_per_gb", "Every matching listing is free, so no price limit is sent; the escrow amount is set when you fund it.");
  }

  let budgetMb: number | undefined;
  const budgetRaw = finite(d.budget_usd);
  if (d.budget_usd !== null && d.budget_usd !== undefined) {
    if (budgetRaw === null || budgetRaw <= 0) {
      note("warning", "budget_usd", "The budget was not a positive number, so it was left out.");
    } else if (ceiling === 0) {
      note("info", "budget_usd", "Every matching listing is free, so the budget does not limit the size.");
    } else if (priceCap !== undefined && ceiling !== null) {
      budgetMb = budgetToMb(budgetRaw, priceCap);
      if (budgetMb < LIMITS.minMb) {
        note("blocked", "budget_usd", `A ${usd(budgetRaw)} budget buys less than ${LIMITS.minMb} MB at ${usd(priceCap)}/GB, the smallest session allowed.`);
      }
    }
  }

  const mbRaw = finite(d.max_mb);
  let mb: number;
  if (mbRaw !== null) {
    mb = Math.min(LIMITS.maxMb, Math.max(LIMITS.minMb, Math.round(mbRaw)));
    if (mb !== mbRaw) note("warning", "max_mb", `Size set to ${mb} MB (allowed: ${LIMITS.minMb}-${LIMITS.maxMb} MB).`);
  } else if (budgetMb !== undefined) {
    mb = Math.min(LIMITS.maxMb, Math.max(LIMITS.minMb, budgetMb));
  } else {
    mb = LIMITS.defaultMb;
    note("info", "max_mb", `No size given: ${LIMITS.defaultMb} MB.`);
  }
  if (budgetMb !== undefined && budgetMb >= LIMITS.minMb) {
    const capped = Math.min(mb, budgetMb);
    const largest = budgetMb > LIMITS.maxMb ? `; the largest session allowed is ${LIMITS.maxMb} MB` : "";
    const lowered = capped < mb ? `, so the size is lowered from ${mb} to ${capped} MB` : "";
    note("info", "budget_usd", `Budget ${usd(budgetRaw as number)} at up to ${usd(priceCap as number)}/GB allows ${budgetMb} MB${largest}${lowered}.`);
    mb = capped;
  }

  const tier = pick(d.preferred_tier, TIERS);
  if (d.preferred_tier && !tier) note("warning", "preferred_tier", "Unknown tier left out (use Bronze, Silver or Gold).");

  const allowed = normalizeDomains(d.allowed_domains);
  const blockedList = normalizeDomains(d.blocked_domains);
  for (const [field, list] of [["allowed_domains", allowed], ["blocked_domains", blockedList]] as const) {
    if (list.rejected.length) note("warning", field, `Not a hostname, left out: ${list.rejected.join(", ")}.`);
    if (list.truncated) note("warning", field, `Only the first ${LIMITS.maxDomains} hosts are kept.`);
  }
  // Keep a host on both lists: dropping it from the allow list could empty it, which would allow every site.
  const overlap = allowed.hosts.filter((h) => blockedList.hosts.includes(h));
  if (overlap.length) note("warning", "allowed_domains", `Both allowed and blocked, so they will be refused: ${overlap.join(", ")}.`);
  if (allowed.hosts.length) note("info", "allowed_domains", `Only these sites and their subdomains can be reached: ${allowed.hosts.join(", ")}.`);

  const intent: PlannedIntent = {
    type,
    bandwidth_limit: mb * BYTES_PER_MB,
    time_limit_minutes: minutes,
    rotation_type: rotation,
  };
  if (interval !== undefined) intent.rotation_interval_seconds = interval;
  if (country) intent.target_geo = country;
  if (priceCap !== undefined) intent.max_price_per_gb = priceCap;
  if (tier) intent.preferred_tier = tier;
  if (allowed.hosts.length) intent.allowed_domains = allowed.hosts;
  if (blockedList.hosts.length) intent.blocked_domains = blockedList.hosts;

  return {
    intent,
    maxCostUsd: priceCap === undefined || matching.length === 0 ? null : (mb / MB_PER_GB) * priceCap,
    matchingListings: matching.length,
    notes,
    assumptions: cleanText(d.assumptions),
    cannotDo: cleanText(d.cannot_do),
    blocked: notes.some((n) => n.level === "blocked"),
  };
}
