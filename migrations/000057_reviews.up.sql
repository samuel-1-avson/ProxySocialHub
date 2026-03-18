-- Reviews table lives alongside social tables (local PG or Supabase).
-- FK refs to users/orders are omitted — those tables may live in Supabase Auth DB.
CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reviewer_id UUID NOT NULL,
    seller_id UUID NOT NULL,
    listing_id UUID REFERENCES proxy_listings(id) ON DELETE SET NULL,
    order_id UUID,

    rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    title VARCHAR(200),
    content TEXT,

    speed_rating INT CHECK (speed_rating >= 1 AND speed_rating <= 5),
    reliability_rating INT CHECK (reliability_rating >= 1 AND reliability_rating <= 5),
    support_rating INT CHECK (support_rating >= 1 AND support_rating <= 5),
    value_rating INT CHECK (value_rating >= 1 AND value_rating <= 5),

    helpful_count INT NOT NULL DEFAULT 0,
    seller_response TEXT,
    response_at TIMESTAMPTZ,
    verified_purchase BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_seller_id ON reviews(seller_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer_id ON reviews(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_reviews_listing_id ON reviews(listing_id);
CREATE INDEX IF NOT EXISTS idx_reviews_order_id ON reviews(order_id);
CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews(created_at DESC);
