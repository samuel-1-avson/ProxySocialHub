import { publicApiPost } from '@/lib/api/client';

export const MARKETPLACE_FUNNEL_SCHEMA = 'marketplace.funnel.v1' as const;

export type MarketplaceFunnelEventName = 'listing_view' | 'buy_modal_open';

export type MarketplaceFunnelSurface =
    | 'browse'
    | 'detail'
    | 'map'
    | 'explorer_map'
    | 'saved'
    | 'unknown';

type TrackPayload = {
    listing_id?: string;
    order_id?: string;
    surface?: MarketplaceFunnelSurface | string;
    meta?: Record<string, string | number | boolean>;
};

/**
 * Fire-and-forget marketplace funnel event (no PII).
 * Server-authoritative steps (order, escrow, credentials, save) are recorded by control-api.
 */
export function trackMarketplaceEvent(
    event: MarketplaceFunnelEventName,
    payload: TrackPayload = {},
): void {
    const body = {
        event,
        schema_version: MARKETPLACE_FUNNEL_SCHEMA,
        listing_id: payload.listing_id,
        order_id: payload.order_id,
        surface: payload.surface,
        meta: payload.meta,
    };

    void publicApiPost<{ ok: boolean }>('/v1/marketplace/funnel-events', body).catch(() => {
        /* analytics must not break UX */
    });
}

/** Deduped listing_view per tab session. */
export function trackListingViewOnce(
    listingId: string,
    surface: MarketplaceFunnelSurface | string,
    authenticated: boolean,
): void {
    if (typeof window === 'undefined') {
        return;
    }
    const key = `funnel:view:${listingId}:${surface}`;
    if (sessionStorage.getItem(key)) {
        return;
    }
    sessionStorage.setItem(key, '1');
    trackMarketplaceEvent('listing_view', {
        listing_id: listingId,
        surface,
        meta: { authenticated },
    });
}
