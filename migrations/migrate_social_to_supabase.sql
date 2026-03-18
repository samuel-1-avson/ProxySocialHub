-- =============================================================================
-- ProxyHub: Migrate social/community tables from local PostgreSQL → Supabase
-- =============================================================================
-- Run this ONE TIME after:
--   1. SUPABASE_DATABASE_URL is set in your .env
--   2. The app has started at least once (so Supabase tables are auto-migrated)
--   3. You have pg_dump / psql access to both databases
--
-- Usage:
--   # 1. Dump social tables from local Docker Postgres
--   docker exec proxyhubb-postgres pg_dump \
--     -U proxyhubb -d proxyhubb \
--     --data-only --no-owner --no-privileges \
--     -t follows -t friend_requests -t friendships \
--     -t badges -t user_badges -t feed_events -t reviews \
--     -t notifications -t notification_preferences \
--     -t provider_showcases -t speed_tests -t testimonials -t provider_stats \
--     -t forum_categories -t forum_threads -t forum_posts -t forum_votes \
--     -t conversations -t messages -t message_reactions \
--     -t circles -t circle_members -t circle_invites \
--     -t circle_slas -t circle_daily_stats -t circle_posts -t circle_leases \
--     -t subscription_plans -t user_subscriptions \
--     -t proposals -t votes \
--     -t use_cases -t user_preferences -t match_requests \
--     -t agents -t agent_outputs -t market_agents -t agent_instances -t agent_jobs \
--     > /tmp/social_data.sql
--
--   # 2. Load into Supabase (replace with your Supabase connection string)
--   psql "$SUPABASE_DATABASE_URL" < /tmp/social_data.sql
--
-- After confirming data is in Supabase, run the CLEANUP section below
-- to reclaim Docker disk space.
-- =============================================================================


-- =============================================================================
-- CLEANUP: Drop social tables from local PostgreSQL AFTER migration is verified
-- =============================================================================
-- IMPORTANT: Only run this after:
--   a) Data has been successfully migrated to Supabase
--   b) SUPABASE_DATABASE_URL is set and the app routes correctly
--   c) You have verified the app works with Supabase for social features
--
-- Run against your LOCAL Docker PostgreSQL (not Supabase):
--   docker exec -i proxyhubb-postgres psql -U proxyhubb -d proxyhubb < this_file.sql

-- Disable foreign key checks temporarily (PostgreSQL uses session-level setting)
SET session_replication_role = replica;

-- Social Graph
DROP TABLE IF EXISTS user_badges CASCADE;
DROP TABLE IF EXISTS badges CASCADE;
DROP TABLE IF EXISTS friend_requests CASCADE;
DROP TABLE IF EXISTS friendships CASCADE;
DROP TABLE IF EXISTS follows CASCADE;
DROP TABLE IF EXISTS feed_events CASCADE;
DROP TABLE IF EXISTS reviews CASCADE;

-- Notifications
DROP TABLE IF EXISTS notification_preferences CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;

-- Showcase & Stats
DROP TABLE IF EXISTS testimonials CASCADE;
DROP TABLE IF EXISTS speed_tests CASCADE;
DROP TABLE IF EXISTS provider_showcases CASCADE;
DROP TABLE IF EXISTS provider_stats CASCADE;

-- Forum
DROP TABLE IF EXISTS forum_votes CASCADE;
DROP TABLE IF EXISTS forum_posts CASCADE;
DROP TABLE IF EXISTS forum_threads CASCADE;
DROP TABLE IF EXISTS forum_categories CASCADE;

-- Messaging
DROP TABLE IF EXISTS message_reactions CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;

-- Community Circles
DROP TABLE IF EXISTS circle_leases CASCADE;
DROP TABLE IF EXISTS circle_posts CASCADE;
DROP TABLE IF EXISTS circle_daily_stats CASCADE;
DROP TABLE IF EXISTS circle_slas CASCADE;
DROP TABLE IF EXISTS circle_invites CASCADE;
DROP TABLE IF EXISTS circle_members CASCADE;
DROP TABLE IF EXISTS circles CASCADE;

-- Subscriptions
DROP TABLE IF EXISTS user_subscriptions CASCADE;
DROP TABLE IF EXISTS subscription_plans CASCADE;

-- Governance
DROP TABLE IF EXISTS votes CASCADE;
DROP TABLE IF EXISTS proposals CASCADE;

-- Smart Matching
DROP TABLE IF EXISTS match_requests CASCADE;
DROP TABLE IF EXISTS user_preferences CASCADE;
DROP TABLE IF EXISTS use_cases CASCADE;

-- Agents & Automation
DROP TABLE IF EXISTS agent_jobs CASCADE;
DROP TABLE IF EXISTS agent_instances CASCADE;
DROP TABLE IF EXISTS agent_outputs CASCADE;
DROP TABLE IF EXISTS agents CASCADE;
DROP TABLE IF EXISTS market_agents CASCADE;

-- Re-enable foreign key checks
SET session_replication_role = DEFAULT;

-- Vacuum to reclaim disk space immediately
VACUUM ANALYZE;

-- =============================================================================
-- VERIFICATION QUERIES
-- Run these on LOCAL Postgres to confirm tables are gone
-- =============================================================================
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- ORDER BY table_name;
--
-- Run these on Supabase to confirm data arrived
-- SELECT COUNT(*) FROM follows;
-- SELECT COUNT(*) FROM messages;
-- SELECT COUNT(*) FROM forum_threads;
-- SELECT COUNT(*) FROM notifications;
