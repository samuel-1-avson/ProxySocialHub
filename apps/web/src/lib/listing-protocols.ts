/**
 * Protocols a listing can offer. A listing stores them as a comma list in
 * this order (for example "http,socks5"); the control API normalises to the
 * same form (normalizeListingProtocols), so signed offers hash identically.
 */
export const LISTING_PROTOCOLS = [
  { value: "http", label: "HTTP" },
  { value: "https", label: "HTTPS" },
  { value: "socks5", label: "SOCKS5" },
] as const;

export type ListingProtocol = (typeof LISTING_PROTOCOLS)[number]["value"];

const ORDER: readonly string[] = LISTING_PROTOCOLS.map((p) => p.value);

function parts(raw: string | readonly string[] | null | undefined): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(/[,;\s]+/);
  return list.map((p) => p.trim().toLowerCase()).filter(Boolean);
}

/** Known protocols in canonical order, without duplicates. */
export function parseListingProtocols(
  raw: string | readonly string[] | null | undefined,
): ListingProtocol[] {
  const chosen = new Set(parts(raw));
  return ORDER.filter((p) => chosen.has(p)) as ListingProtocol[];
}

/**
 * The canonical stored form. Mirrors the API: a value with an unknown part
 * is kept as its trimmed lowercase text so older rows still hash the same.
 */
export function canonicalListingProtocols(
  raw: string | readonly string[] | null | undefined,
): string {
  const list = parts(raw);
  if (!list.length) return "http";
  if (list.some((p) => !ORDER.includes(p))) {
    return Array.isArray(raw) ? list.join(",") : String(raw).trim().toLowerCase();
  }
  return parseListingProtocols(list).join(",");
}

/** "HTTP · SOCKS5" for display; falls back to the raw text. */
export function listingProtocolLabel(raw: string | null | undefined): string {
  const known = parseListingProtocols(raw);
  if (!known.length) return String(raw ?? "").toUpperCase() || "HTTP";
  return known
    .map((p) => LISTING_PROTOCOLS.find((x) => x.value === p)?.label ?? p)
    .join(" · ");
}
