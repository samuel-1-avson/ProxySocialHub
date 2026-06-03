-- Listing Q&A: associate forum threads with marketplace listings
ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS listing_id UUID DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_forum_threads_listing_id
    ON forum_threads (listing_id)
    WHERE listing_id IS NOT NULL;
