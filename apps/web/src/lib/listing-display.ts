import type { CatalogProductSummary } from '@/lib/api/catalog';
import type { Listing } from '@/lib/api/marketplace';

/**
 * Buyer-facing listings hide the real country and ISP until a session starts:
 * the API replaces both with a sentence ("Hidden until session"), not a
 * two-letter code. Show that as an intentional privacy note, never as data.
 */
export const LOCATION_SHARED_LATER = 'Location shared after purchase';

/** True when a country value is the API's privacy placeholder, not a code. */
export function isMaskedLocation(value?: string | null): boolean {
    const text = (value ?? '').trim();
    return text !== '' && !/^[A-Za-z]{2}$/.test(text);
}

/** The country when it is real, otherwise an empty string. */
export function visibleCountry(value?: string | null): string {
    return isMaskedLocation(value) ? '' : (value ?? '').trim();
}

/** Primary headline for cards and detail — prefers linked catalog product title. */
export function displayListingTitle(listing: Pick<Listing, 'title' | 'catalog_product'>): string {
    const productTitle = listing.catalog_product?.title?.trim();
    return productTitle || listing.title;
}

export function hasCatalogProduct(listing: Pick<Listing, 'catalog_product'>): boolean {
    return Boolean(listing.catalog_product?.id);
}

/** When catalog title differs from the listing row title, show listing title as secondary line. */
export function listingShowsCatalogSubtitle(
    listing: Pick<Listing, 'title' | 'catalog_product'>,
): boolean {
    const productTitle = listing.catalog_product?.title?.trim();
    return Boolean(productTitle && productTitle !== listing.title);
}

export function catalogProductBadgeLabel(product: CatalogProductSummary | undefined): string | null {
    if (!product?.title) return null;
    if (product.status === 'draft') return 'Draft product';
    return product.slug ? `/${product.slug}` : 'Catalog';
}
