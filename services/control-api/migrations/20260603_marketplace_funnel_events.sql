-- Marketplace funnel analytics (Phase 2 WS-D) — mirror of migrations/000096_marketplace_funnel_events.up.sql
CREATE TABLE IF NOT EXISTS marketplace_funnel_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schema_version TEXT NOT NULL DEFAULT 'marketplace.funnel.v1',
    event_name TEXT NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    listing_id UUID REFERENCES proxy_listings(id) ON DELETE SET NULL,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    surface TEXT,
    meta JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_funnel_events_created_at
    ON marketplace_funnel_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketplace_funnel_events_event_name_created_at
    ON marketplace_funnel_events (event_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketplace_funnel_events_listing_id
    ON marketplace_funnel_events (listing_id)
    WHERE listing_id IS NOT NULL;
