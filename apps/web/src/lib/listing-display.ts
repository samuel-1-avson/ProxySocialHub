import type { CatalogProductSummary } from '@/lib/api/catalog';
import type { Listing } from '@/lib/api/marketplace';

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
