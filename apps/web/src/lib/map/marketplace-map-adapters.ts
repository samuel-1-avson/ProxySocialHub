import type { CatalogProductSummary } from '@/lib/api/catalog';
import type { MapGeoMeta, MarketplaceMapPoint } from '@/lib/api/marketplace';
import type { ExplorerListingPin } from '@/components/map/types';
import type { NodeGeoPoint } from '@/lib/services/explorer';

/** Listing pin with marketplace map quality/privacy fields. */

export type MarketplaceListingMapPin = ExplorerListingPin & {
    seller_id?: string;
    proxy_type?: string;
    protocol?: string;
    city?: string;
    /** @deprecated Prefer network_class; raw ISP is no longer returned by map API. */
    isp?: string;
    network_class?: string;
    available_bandwidth_gb: number;
    max_concurrency?: number;
    node_id?: string;
    node_active?: boolean;
    latency_ms?: number;
    quality_score?: number;
    success_rate?: number;
    trust_badge?: string;
    trust_label?: string;
    geo_resolved?: boolean;
    purchasable: boolean;
    geo_source?: string;
    geo?: MapGeoMeta;
    status?: string;
    /** @deprecated Proof signer material is no longer returned by public map API. */
    listing_offer_signed_at?: string;
    /** @deprecated Prefer listing_offer_verified boolean only. */
    listing_offer_signer?: string;
    listing_offer_verification_error?: string;
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
        network_class: point.network_class,
        city: point.city,
        price_per_gb: point.price_per_gb ?? 0,
        available_bandwidth_gb: point.available_bandwidth_gb ?? 0,
        max_concurrency: point.max_concurrency,
        lat: point.lat,
        lon: point.lon,
        node_id: point.node_id,
        node_active: point.status === 'active',
        uptime_percent: point.uptime_percent ?? 0,
        latency_ms: point.latency_ms,
        quality_score: point.quality_score,
        success_rate: point.success_rate,
        trust_badge: point.trust_badge,
        trust_label: point.trust_label,
        sla_source: point.sla_source,
        geo_resolved: point.geo_source !== 'unknown',
        purchasable: point.purchasable,
        estimated: point.geo?.estimated ?? estimated,
        geo_source: point.geo?.source ?? point.geo_source,
        geo: point.geo,
        status: point.status,
        listing_offer_verified: point.listing_offer_verified,
        catalog_product: point.catalog_product,
        active_sessions: point.active_sessions ?? 0,
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
        network_class: point.network_class,
        title: point.title,
        quality_score: point.quality_score,
        success_rate: point.success_rate,
        trust_badge: point.trust_badge,
        trust_label: point.trust_label,
        geo_source: point.geo_source,
        /** Opaque marketplace ids cannot deep-link to explorer node pages. */
        explorer_linkable: false,
    };
}
