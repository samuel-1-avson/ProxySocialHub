/**
 * Contract checks for listing display helpers (Phase 3A-4).
 * Run: npm run test:listing-display
 * (Pure JS mirror — keeps CI free of a Jest/Vitest harness for this one module.)
 */

function displayListingTitle(listing) {
    const productTitle = listing.catalog_product?.title?.trim();
    return productTitle || listing.title;
}

function listingShowsCatalogSubtitle(listing) {
    const productTitle = listing.catalog_product?.title?.trim();
    return Boolean(productTitle && productTitle !== listing.title);
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

assert(
    displayListingTitle({ title: 'Supply', catalog_product: { title: ' Merch ' } }) === 'Merch',
    'prefers catalog title',
);
assert(
    displayListingTitle({ title: 'Supply', catalog_product: undefined }) === 'Supply',
    'falls back to listing title',
);
assert(
    listingShowsCatalogSubtitle({
        title: 'Supply',
        catalog_product: { title: 'Merch' },
    }) === true,
    'subtitle when titles differ',
);
assert(
    listingShowsCatalogSubtitle({
        title: 'Same',
        catalog_product: { title: 'Same' },
    }) === false,
    'no subtitle when equal',
);

console.log('listing-display contract OK');
