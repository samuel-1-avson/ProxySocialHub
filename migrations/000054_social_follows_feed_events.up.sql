CREATE TABLE IF NOT EXISTS follows (
    follower_id  UUID NOT NULL,
    following_id UUID NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (follower_id, following_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_follower  ON follows (follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows (following_id);

CREATE TABLE IF NOT EXISTS feed_events (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id    UUID,
    event_type  VARCHAR(50) NOT NULL,
    target_type VARCHAR(50),
    target_id   UUID,
    content     TEXT,
    metadata    JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feed_events_actor_id   ON feed_events (actor_id);
CREATE INDEX IF NOT EXISTS idx_feed_events_event_type ON feed_events (event_type);
CREATE INDEX IF NOT EXISTS idx_feed_events_created_at ON feed_events (created_at DESC);
