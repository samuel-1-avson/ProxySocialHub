import type { CatalogProductSummary } from '@/lib/api/catalog';
import type { MapGeoMeta, MarketplaceMapPoint } from '@/lib/api/marketplace';
import type { ExplorerListingPin } from '@/components/map/types';
import type { NodeGeoPoint } from '@/lib/services/explorer';

/** Listing pin with marketplace map proof and purchase fields. */

export type MarketplaceListingMapPin = ExplorerListingPin & {
    seller_id?: string;
    proxy_type?: string;
    protocol?: string;
    city?: string;
    isp?: string;
    available_bandwidth_gb: number;
    node_id?: string;
    node_active?: boolean;
    latency_ms?: number;
    geo_resolved?: boolean;
    purchasable: boolean;
    geo_source?: string;
    geo?: MapGeoMeta;
    status?: string;
    listing_offer_signed_at?: string;
    heartbeat_verified?: boolean;
    heartbeat_signer?: string;
    heartbeat_signed_at?: string;
    heartbeat_verification_error?: string;
    catalog_product?: CatalogProductSummary;
};

export function marketplacePointToListingPin(point: MarketplaceMapPoint): MarketplaceListingMapPin {
    const estimated =
        point.geo_source === 'country_centroid' ||
        point.geo_source === 'city_centroid' ||
        point.geo_source === 'region_hub' ||
        point.geo_source === 'unknown';
    return {
        listing_id: point.listing_id ?? point.id.replace(/^listing:/, ''),
        title: point.title,
        seller_id: point.seller_id ?? '',
        proxy_type: point.proxy_type ?? 'residential',
        protocol: point.protocol ?? 'http',
        country: point.country ?? '',
        isp: point.isp,
        city: point.city,
        price_per_gb: point.price_per_gb ?? 0,
        available_bandwidth_gb: point.available_bandwidth_gb ?? 0,
        lat: point.lat,
        lon: point.lon,
        node_id: point.node_id,
        node_active: point.status === 'active',
        uptime_percent: point.uptime_percent ?? 0,
        latency_ms: point.latency_ms,
        sla_source: point.sla_source,
        geo_resolved: point.geo_source !== 'unknown',
        purchasable: point.purchasable,
        estimated: point.geo?.estimated ?? estimated,
        geo_source: point.geo?.source ?? point.geo_source,
        geo: point.geo,
        status: point.status,
        listing_offer_verified: point.listing_offer_verified,
        listing_offer_signer: point.listing_offer_signer,
        listing_offer_signed_at: point.listing_offer_signed_at,
        listing_offer_verification_error: point.listing_offer_verification_error,
        heartbeat_verified: point.heartbeat_verified,
        heartbeat_signer: point.heartbeat_signer,
        heartbeat_signed_at: point.heartbeat_signed_at,
        heartbeat_verification_error: point.heartbeat_verification_error,
        catalog_product: point.catalog_product,
    };
}

export function marketplacePointToNode(point: MarketplaceMapPoint): NodeGeoPoint {
    return {
        node_id: point.node_id ?? point.id.replace(/^node:/, ''),
        lat: point.lat,
        lon: point.lon,
        is_active: point.status === 'active',
        is_validator: !!point.is_validator,
        uptime_percent: point.uptime_percent ?? 0,
        active_sessions: point.active_sessions ?? 0,
        country: point.country ?? '',
        region: point.region ?? point.country ?? '',
        city: point.city,
        isp: point.isp,
        geo_source: point.geo_source,
    };
}
