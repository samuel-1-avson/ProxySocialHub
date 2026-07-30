/**
 * Marketplace listing prices are USD in control-api (converted to SOL at escrow pay time).
 * Use these helpers so browse/checkout UI does not label USD amounts as SOL.
 */

export function formatListingPricePerGB(pricePerGb: number | null | undefined): string {
    const n = Number(pricePerGb || 0);
    if (!Number.isFinite(n)) return "$0.00 / GB";
    return `$${n.toFixed(4)} / GB`;
}

export function formatListingTotalUSD(total: number | null | undefined): string {
    const n = Number(total || 0);
    if (!Number.isFinite(n)) return "$0.00";
    return `$${n.toFixed(2)}`;
}
