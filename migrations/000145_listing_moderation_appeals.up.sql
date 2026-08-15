-- Wave 3.5 / ADR 0008 — listing moderation appeals
CREATE TABLE IF NOT EXISTS listing_moderation_appeals (
    id UUID PRIMARY KEY,
    listing_id UUID NOT NULL REFERENCES proxy_listings(id),
    seller_id UUID NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'open',
    reason TEXT NOT NULL DEFAULT '',
    evidence TEXT NOT NULL DEFAULT '',
    listing_offer_hash VARCHAR(64) NOT NULL DEFAULT '',
    delist_reason TEXT NOT NULL DEFAULT '',
    resolution VARCHAR(32) NOT NULL DEFAULT '',
    resolution_notes TEXT NOT NULL DEFAULT '',
    resolved_by UUID,
    resolved_at TIMESTAMPTZ,
    appeal_deadline_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listing_appeals_listing ON listing_moderation_appeals (listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_appeals_seller ON listing_moderation_appeals (seller_id);
CREATE INDEX IF NOT EXISTS idx_listing_appeals_status ON listing_moderation_appeals (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_listing_appeals_one_open
    ON listing_moderation_appeals (listing_id)
    WHERE status = 'open';
