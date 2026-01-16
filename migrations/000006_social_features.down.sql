-- =============================================
-- ProxySocialHub: Social Features Rollback
-- =============================================

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS user_badges;
DROP TABLE IF EXISTS badges;
DROP TABLE IF EXISTS feed_events;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS saved_listings;
DROP TABLE IF EXISTS proxy_listings;
DROP TABLE IF EXISTS follows;

-- Remove columns from users table
ALTER TABLE users DROP COLUMN IF EXISTS display_name;
ALTER TABLE users DROP COLUMN IF EXISTS username;
ALTER TABLE users DROP COLUMN IF EXISTS bio;
ALTER TABLE users DROP COLUMN IF EXISTS avatar_url;
ALTER TABLE users DROP COLUMN IF EXISTS cover_image_url;
ALTER TABLE users DROP COLUMN IF EXISTS location;
ALTER TABLE users DROP COLUMN IF EXISTS website;
ALTER TABLE users DROP COLUMN IF EXISTS followers_count;
ALTER TABLE users DROP COLUMN IF EXISTS following_count;
ALTER TABLE users DROP COLUMN IF EXISTS reviews_count;
ALTER TABLE users DROP COLUMN IF EXISTS avg_rating;
ALTER TABLE users DROP COLUMN IF EXISTS verified;
ALTER TABLE users DROP COLUMN IF EXISTS provider_since;
ALTER TABLE users DROP COLUMN IF EXISTS total_bandwidth_sold;

-- Drop indexes
DROP INDEX IF EXISTS idx_users_username;
