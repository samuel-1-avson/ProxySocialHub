-- Marketplace moderation: pending_review listing status (Phase 2 WS-C)
CREATE INDEX IF NOT EXISTS idx_proxy_listings_pending_review
    ON proxy_listings (created_at DESC)
    WHERE status = 'pending_review';
