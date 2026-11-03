/**
 * Plain-language provider rules: check a model-drafted change to the sites a provider's node
 * refuses to connect to.
 *
 * The model only proposes: sites the provider named, and categories from the fixed list below.
 * Everything here is deterministic. Categories are expanded from a short, curated list of major
 * sites (best effort: other sites in a category are not blocked, and the card says so). Site
 * names follow the node's own rules (services/provider-node/src/blocked_sites.rs): a name blocks
 * that site and its subdomains. The provider approves the result before the app writes it to
 * the node, which enforces it on their own computer.
 *
 * No imports, so `node --test` can load this file directly.
 */

/** Same cap as the node (MAX_BLOCKED_SITES). */
export const MAX_BLOCKED_SITES = 1000;

export const CATEGORIES = {
  gambling: {
    label: "Gambling and betting",
    sites: [
      "bet365.com", "betway.com", "betway.com.gh", "sportybet.com", "betking.com", "bet9ja.com", "msport.com",
      "betpawa.com", "betpawa.com.gh", "1xbet.com", "22bet.com", "melbet.com", "parimatch.com", "stake.com",
      "williamhill.com", "paddypower.com", "betfair.com", "ladbrokes.com", "skybet.com", "unibet.com", "bwin.com",
      "betano.com", "888.com", "888casino.com", "pokerstars.com", "draftkings.com", "fanduel.com", "betmgm.com",
      "pinnacle.com", "bovada.lv",
    ],
  },
  adult: {
    label: "Adult content",
    sites: [
      "pornhub.com", "xvideos.com", "xnxx.com", "xhamster.com", "redtube.com", "youporn.com", "tube8.com",
      "spankbang.com", "eporner.com", "beeg.com", "txxx.com", "motherless.com", "brazzers.com", "porn.com",
      "chaturbate.com", "stripchat.com", "bongacams.com", "livejasmin.com", "cam4.com", "myfreecams.com",
      "onlyfans.com", "fansly.com",
    ],
  },
  social_media: {
    label: "Social media",
    sites: [
      "facebook.com", "fb.com", "instagram.com", "threads.net", "tiktok.com", "x.com", "twitter.com",
      "snapchat.com", "linkedin.com", "reddit.com", "pinterest.com", "tumblr.com", "vk.com", "weibo.com",
    ],
  },
  video_streaming: {
    label: "Video streaming (heavy bandwidth)",
    sites: [
      "netflix.com", "nflxvideo.net", "youtube.com", "youtu.be", "googlevideo.com", "primevideo.com",
      "disneyplus.com", "hulu.com", "max.com", "twitch.tv", "ttvnw.net", "dailymotion.com", "vimeo.com",
      "crunchyroll.com", "showmax.com", "peacocktv.com", "paramountplus.com",
    ],
  },
  dating: {
    label: "Dating",
    sites: [
      "tinder.com", "gotinder.com", "bumble.com", "hinge.co", "match.com", "okcupid.com", "pof.com", "badoo.com",
      "grindr.com", "eharmony.com", "zoosk.com",
    ],
  },
} as const;

export type CategoryId = keyof typeof CATEGORIES;
export const CATEGORY_IDS = Object.keys(CATEGORIES) as CategoryId[];

/** What the model returns. */
export interface RulesDraft {
  block_sites: string[];
  block_categories: CategoryId[];
  unblock_sites: string[];
  unblock_categories: CategoryId[];
  assumptions: string[];
  cannot_do: string[];
}

export interface RuleChange {
  host: string;
  /** "named" (the provider named it) or "category:<id>". */
  source: string;
}

export interface RulesNote {
  level: "info" | "warning" | "blocked";
  message: string;
}

export interface RulesPlan {
  /** The full list to write to the node, in order: kept, then added. */
  blocked: string[];
  added: RuleChange[];
  removed: RuleChange[];
  categories: { id: CategoryId; label: string; sites: number; action: "block" | "unblock" }[];
  rejected: string[];
  notes: RulesNote[];
  assumptions: string[];
  cannotDo: string[];
  /** Nothing would change. */
  unchanged: boolean;
  /** The draft could not be used; the list must not be written. */
  refused: boolean;
}

const MAX_TEXT_ITEMS = 8;
const MAX_TEXT_CHARS = 200;

/** Same rules as the node's normalize_site: a lowercase site name with a dot, or null. */
export function normalizeSite(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  const host = (s.split(/[/?#]/)[0] ?? "").split(":")[0]?.replace(/\.+$/, "") ?? "";
  if (host.length > 253 || !host.includes(".")) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes("[")) return null;
  const labels = host.split(".");
  const valid = (l: string) => l.length > 0 && l.length <= 63 && !l.startsWith("-") && !l.endsWith("-") && /^[a-z0-9-]+$/.test(l);
  const tld = labels[labels.length - 1] ?? "";
  if (!labels.every(valid) || !/[a-z]/.test(tld)) return null;
  return host;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function categoryIds(v: unknown): CategoryId[] {
  return [...new Set(strings(v).filter((x): x is CategoryId => (CATEGORY_IDS as string[]).includes(x)))];
}

function cleanText(v: unknown): string[] {
  return strings(v)
    .map((s) => s.trim().slice(0, MAX_TEXT_CHARS))
    .filter(Boolean)
    .slice(0, MAX_TEXT_ITEMS);
}

/**
 * Apply a drafted change to the node's current list. Entries already on the list that are not
 * site names (legacy text rules the node still honours) are kept as they are.
 */
export function checkRulesDraft(raw: unknown, current: string[]): RulesPlan {
  const d = asRecord(raw);
  const notes: RulesNote[] = [];
  const refused = !raw || typeof raw !== "object" || Array.isArray(raw);
  if (refused) notes.push({ level: "blocked", message: "The draft could not be read. Edit the list yourself." });

  const kept: string[] = [];
  for (const entry of current) {
    const name = normalizeSite(entry) ?? (typeof entry === "string" && entry.trim() ? entry.trim() : null);
    if (name && !kept.includes(name)) kept.push(name);
  }

  const rejected: string[] = [];
  const named = (list: unknown) => {
    const out: string[] = [];
    for (const s of strings(list)) {
      const host = normalizeSite(s);
      if (host) {
        if (!out.includes(host)) out.push(host);
      } else if (s.trim()) {
        rejected.push(s.trim().slice(0, 80));
      }
    }
    return out;
  };

  const blockCats = categoryIds(d.block_categories);
  const unblockCats = categoryIds(d.unblock_categories).filter((c) => !blockCats.includes(c));
  const unblockNamed = named(d.unblock_sites);
  const blockNamed = named(d.block_sites).filter((h) => !unblockNamed.includes(h));

  const removed: RuleChange[] = [];
  const removeSet = new Map<string, string>();
  for (const h of unblockNamed) removeSet.set(h, "named");
  for (const c of unblockCats) for (const h of CATEGORIES[c].sites) if (!removeSet.has(h)) removeSet.set(h, `category:${c}`);
  const afterRemove = kept.filter((h) => {
    const source = removeSet.get(h);
    if (source) removed.push({ host: h, source });
    return !source;
  });
  for (const h of unblockNamed) {
    if (!kept.includes(h)) notes.push({ level: "info", message: `${h} was not on the list, so there was nothing to unblock.` });
  }

  const added: RuleChange[] = [];
  const blocked = [...afterRemove];
  const add = (h: string, source: string) => {
    if (blocked.includes(h)) return;
    blocked.push(h);
    added.push({ host: h, source });
  };
  for (const h of blockNamed) add(h, "named");
  for (const c of blockCats) for (const h of CATEGORIES[c].sites) add(h, `category:${c}`);

  if (blocked.length > MAX_BLOCKED_SITES) {
    const dropped = new Set(blocked.slice(MAX_BLOCKED_SITES));
    blocked.length = MAX_BLOCKED_SITES;
    for (let i = added.length - 1; i >= 0; i -= 1) if (dropped.has(added[i]!.host)) added.splice(i, 1);
    notes.push({ level: "warning", message: `The node keeps at most ${MAX_BLOCKED_SITES} sites; the rest were left out.` });
  }

  const categories = [
    ...blockCats.map((id) => ({ id, label: CATEGORIES[id].label, sites: CATEGORIES[id].sites.length, action: "block" as const })),
    ...unblockCats.map((id) => ({ id, label: CATEGORIES[id].label, sites: CATEGORIES[id].sites.length, action: "unblock" as const })),
  ];
  if (blockCats.length) {
    notes.push({
      level: "info",
      message: `Categories cover a short list of major sites only (${blockCats.map((c) => `${CATEGORIES[c].label}: ${CATEGORIES[c].sites.length}`).join("; ")}). Other sites in a category are not blocked; add them by name.`,
    });
  }
  if (rejected.length) notes.push({ level: "warning", message: `Not site names, left out: ${rejected.join(", ")}.` });
  if (blocked.some((h) => !h.includes("."))) {
    notes.push({ level: "info", message: "Entries without a dot are old text rules: they block any site whose name contains them." });
  }

  const unchanged = added.length === 0 && removed.length === 0;
  if (unchanged && !refused) notes.push({ level: "info", message: "Nothing would change." });

  return {
    blocked: refused ? kept : blocked,
    added: refused ? [] : added,
    removed: refused ? [] : removed,
    categories: refused ? [] : categories,
    rejected,
    notes,
    assumptions: cleanText(d.assumptions),
    cannotDo: cleanText(d.cannot_do),
    unchanged: refused || unchanged,
    refused,
  };
}
