/**
 * Marketplace listing prices are USD in control-api (converted to SOL at escrow pay time).
 * Use these helpers so browse/checkout UI does not label USD amounts as SOL.
 */

export type ListingProxyType = "residential" | "mobile" | "datacenter" | string;

/** Traffic-first guidance bands (USD/GB) — undercut mid-market centralized peers. */
export const LISTING_PRICE_BANDS_USD: Record<
  "residential" | "mobile" | "datacenter",
  { suggested: number; min: number; max: number; softCapMultiplier: number }
> = {
  // vs PacketStream $1 / IPRoyal ~$1.75+ / Bright PAYG ~$4–8
  residential: { suggested: 0.99, min: 0.7, max: 1.75, softCapMultiplier: 1.75 },
  // vs typical mobile $4–12
  mobile: { suggested: 3.5, min: 2.5, max: 6.0, softCapMultiplier: 1.75 },
  // vs shared DC ~$0.40–0.65/GB
  datacenter: { suggested: 0.15, min: 0.08, max: 0.35, softCapMultiplier: 1.75 },
};

/** Absolute ceiling to catch typos (not a competitive max). */
export const LISTING_PRICE_HARD_CAP_USD = 50;

export function defaultListingPricePerGB(proxyType: ListingProxyType): number {
  const key = normalizeProxyType(proxyType);
  return LISTING_PRICE_BANDS_USD[key].suggested;
}

export function listingPriceBand(proxyType: ListingProxyType) {
  return LISTING_PRICE_BANDS_USD[normalizeProxyType(proxyType)];
}

export function softCapListingPricePerGB(proxyType: ListingProxyType, suggested?: number): number {
  const band = listingPriceBand(proxyType);
  const base = suggested && suggested > 0 ? suggested : band.suggested;
  return base * band.softCapMultiplier;
}

export type ListingPriceGuidance = {
  overSoftCap: boolean;
  overHardCap: boolean;
  softCap: number;
  hardCap: number;
  suggested: number;
  message: string | null;
};

export function evaluateListingPrice(
  pricePerGb: number,
  proxyType: ListingProxyType,
  oracleSuggested?: number | null
): ListingPriceGuidance {
  const band = listingPriceBand(proxyType);
  const suggested = oracleSuggested && oracleSuggested > 0 ? oracleSuggested : band.suggested;
  const softCap = softCapListingPricePerGB(proxyType, suggested);
  const hardCap = LISTING_PRICE_HARD_CAP_USD;
  const overSoftCap = pricePerGb > softCap;
  const overHardCap = pricePerGb > hardCap;

  let message: string | null = null;
  if (overHardCap) {
    message = `Price exceeds the $${hardCap.toFixed(0)}/GB hard limit. Lower it before publishing.`;
  } else if (overSoftCap) {
    message = `Above our traffic-first guidance (suggested ~$${suggested.toFixed(2)}/GB; soft cap $${softCap.toFixed(2)}). Lower prices win more buyers vs Bright/Oxylabs/IPRoyal.`;
  }

  return { overSoftCap, overHardCap, softCap, hardCap, suggested, message };
}

export function formatListingPricePerGB(pricePerGb: number | null | undefined): string {
  const n = Number(pricePerGb || 0);
  if (!Number.isFinite(n)) return "$0.00 / GB";
  return `$${n.toFixed(4)} / GB`;
}

/** Compact map/popup label — still USD. */
export function formatListingPricePerGBCompact(pricePerGb: number | null | undefined): string {
  const n = Number(pricePerGb || 0);
  if (!Number.isFinite(n)) return "$0.00/GB";
  if (n >= 1) return `$${n.toFixed(2)}/GB`;
  return `$${n.toFixed(4)}/GB`;
}

export function formatListingTotalUSD(total: number | null | undefined): string {
  const n = Number(total || 0);
  if (!Number.isFinite(n)) return "$0.00";
  return `$${n.toFixed(2)}`;
}

function normalizeProxyType(proxyType: ListingProxyType): "residential" | "mobile" | "datacenter" {
  const t = String(proxyType || "residential").toLowerCase();
  if (t === "mobile") return "mobile";
  if (t === "datacenter") return "datacenter";
  return "residential";
}
