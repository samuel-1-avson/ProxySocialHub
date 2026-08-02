DROP INDEX IF EXISTS idx_forum_posts_visible;
DROP INDEX IF EXISTS idx_forum_threads_visible;

ALTER TABLE forum_posts DROP COLUMN IF EXISTS is_hidden;
ALTER TABLE forum_threads DROP COLUMN IF EXISTS is_hidden;

UPDATE forum_categories
SET is_locked = false
WHERE slug = 'announcements';
