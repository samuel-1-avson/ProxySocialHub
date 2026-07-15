import type { MarketplaceListingMapPin } from '@/lib/map/marketplace-map-adapters';

/** Human-readable label for map pin coordinate precision (shared across map surfaces). */
export function geoSourceLabel(
    pin: Pick<MarketplaceListingMapPin, 'geo_source' | 'estimated'> & { geo?: { display_label?: string } },
): string {
    if (pin.geo?.display_label) {
        return pin.geo.display_label;
    }
    switch (pin.geo_source) {
        case 'region_hub':
            return 'Regional hub (approx.)';
        case 'city_centroid':
            return 'City area (approx.)';
        case 'country_centroid':
            return 'Country area (approx.)';
        default:
            return pin.estimated ? 'Approximate location' : 'Regional area';
    }
}
