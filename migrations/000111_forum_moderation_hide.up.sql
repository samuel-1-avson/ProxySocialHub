-- BC-08 community: soft-hide for moderation + lock announcements.
ALTER TABLE forum_threads
    ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE forum_posts
    ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_forum_threads_visible
    ON forum_threads (category_id, created_at DESC)
    WHERE is_hidden = false;

CREATE INDEX IF NOT EXISTS idx_forum_posts_visible
    ON forum_posts (thread_id, created_at ASC)
    WHERE is_hidden = false;

-- Official announcements: only moderators may post (createThread bypasses lock for mods).
UPDATE forum_categories
SET is_locked = true
WHERE slug = 'announcements';
