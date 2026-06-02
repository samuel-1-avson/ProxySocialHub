-- Network/social schema hardening for active community and messaging features.
-- This closes gaps left by legacy Supabase-era social tables and adds
-- idempotent constraints used by the current Go models and handlers.

CREATE TABLE IF NOT EXISTS friend_requests (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status      VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_friend_requests_not_self CHECK (sender_id <> receiver_id),
    CONSTRAINT chk_friend_requests_status CHECK (status IN ('pending', 'accepted', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_friend_requests_sender_status
    ON friend_requests (sender_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver_status
    ON friend_requests (receiver_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_requests_pending_pair
    ON friend_requests (sender_id, receiver_id)
    WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS friendships (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    friend_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_friendships_not_self CHECK (user_id <> friend_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_friendships_user_friend
    ON friendships (user_id, friend_id);
CREATE INDEX IF NOT EXISTS idx_friendships_friend_id
    ON friendships (friend_id);

CREATE TABLE IF NOT EXISTS forum_votes (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    post_id    UUID REFERENCES forum_posts(id) ON DELETE CASCADE,
    thread_id  UUID REFERENCES forum_threads(id) ON DELETE CASCADE,
    vote_type  SMALLINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_forum_votes_target CHECK (
        (post_id IS NOT NULL AND thread_id IS NULL)
        OR (post_id IS NULL AND thread_id IS NOT NULL)
    ),
    CONSTRAINT chk_forum_votes_type CHECK (vote_type IN (-1, 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_votes_user_post
    ON forum_votes (user_id, post_id)
    WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_votes_user_thread
    ON forum_votes (user_id, thread_id)
    WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_forum_votes_post
    ON forum_votes (post_id)
    WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_forum_votes_thread
    ON forum_votes (thread_id)
    WHERE thread_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS badges (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    icon        VARCHAR(50),
    criteria    JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS user_badges (
    user_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    badge_id  UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
    earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_user_badges_badge
    ON user_badges (badge_id);

CREATE INDEX IF NOT EXISTS idx_conversations_participant1_last
    ON conversations (participant1, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_participant2_last
    ON conversations (participant2, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
    ON messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_unread
    ON messages (conversation_id, sender_id, read_at)
    WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS saved_listings (
    user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    listing_id UUID NOT NULL REFERENCES proxy_listings(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, listing_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_listings_user_listing
    ON saved_listings (user_id, listing_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread_created
    ON notifications (user_id, created_at DESC)
    WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_forum_threads_category_latest
    ON forum_threads (category_id, is_pinned DESC, last_reply_at DESC NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_posts_thread_created
    ON forum_posts (thread_id, created_at ASC);
