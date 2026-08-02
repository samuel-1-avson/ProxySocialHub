-- Migration: Add ON DELETE CASCADE to social-graph foreign keys
-- Without this, deleting a user leaves orphaned rows in follows, friendships,
-- notifications, and feed_events. (L-02 / Phase 4.2)

-- ============================================================
-- follows: follower_id and following_id → profiles
-- ============================================================
ALTER TABLE follows
    DROP CONSTRAINT IF EXISTS follows_follower_id_fkey,
    DROP CONSTRAINT IF EXISTS follows_following_id_fkey;

ALTER TABLE follows
    ADD CONSTRAINT follows_follower_id_fkey
        FOREIGN KEY (follower_id) REFERENCES profiles(id) ON DELETE CASCADE,
    ADD CONSTRAINT follows_following_id_fkey
        FOREIGN KEY (following_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- ============================================================
-- friendships: user1_id and user2_id → profiles
-- ============================================================
ALTER TABLE friendships
    DROP CONSTRAINT IF EXISTS friendships_user1_id_fkey,
    DROP CONSTRAINT IF EXISTS friendships_user2_id_fkey;

ALTER TABLE friendships
    ADD CONSTRAINT friendships_user1_id_fkey
        FOREIGN KEY (user1_id) REFERENCES profiles(id) ON DELETE CASCADE,
    ADD CONSTRAINT friendships_user2_id_fkey
        FOREIGN KEY (user2_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- ============================================================
-- friend_requests: sender_id and receiver_id → profiles
-- ============================================================
ALTER TABLE friend_requests
    DROP CONSTRAINT IF EXISTS friend_requests_sender_id_fkey,
    DROP CONSTRAINT IF EXISTS friend_requests_receiver_id_fkey;

ALTER TABLE friend_requests
    ADD CONSTRAINT friend_requests_sender_id_fkey
        FOREIGN KEY (sender_id) REFERENCES profiles(id) ON DELETE CASCADE,
    ADD CONSTRAINT friend_requests_receiver_id_fkey
        FOREIGN KEY (receiver_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- ============================================================
-- notifications: user_id and actor_id → profiles
-- ============================================================
ALTER TABLE notifications
    DROP CONSTRAINT IF EXISTS notifications_user_id_fkey,
    DROP CONSTRAINT IF EXISTS notifications_actor_id_fkey;

ALTER TABLE notifications
    ADD CONSTRAINT notifications_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- actor_id is nullable — only add cascade when the actor is deleted so the
-- notification is removed along with the actor that triggered it.
ALTER TABLE notifications
    ADD CONSTRAINT notifications_actor_id_fkey
        FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- ============================================================
-- feed_events: user_id and actor_id → profiles
-- ============================================================
ALTER TABLE feed_events
    DROP CONSTRAINT IF EXISTS feed_events_user_id_fkey,
    DROP CONSTRAINT IF EXISTS feed_events_actor_id_fkey;

ALTER TABLE feed_events
    ADD CONSTRAINT feed_events_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE feed_events
    ADD CONSTRAINT feed_events_actor_id_fkey
        FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- ============================================================
-- Deduplication index for notifications (4.4)
-- Prevents multiple unread notifications of the same (user, type, actor)
-- within a short window — used by the CreateDeduped helper.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_notifications_dedup
    ON notifications (user_id, type, actor_id, created_at)
    WHERE is_read = false;
