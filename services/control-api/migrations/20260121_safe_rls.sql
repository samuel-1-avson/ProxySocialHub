-- ============================================================
-- SAFE RLS ENABLEMENT - Ignores missing tables
-- Run this in Supabase SQL Editor
-- ============================================================

-- Helper function to safely enable RLS
CREATE OR REPLACE FUNCTION safe_enable_rls(table_name text)
RETURNS void AS $$
BEGIN
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE 'Table % does not exist, skipping', table_name;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- ENABLE RLS ON ALL TABLES (safe - ignores missing)
-- ============================================================

SELECT safe_enable_rls('profiles');
SELECT safe_enable_rls('wallets');
SELECT safe_enable_rls('wallet_ledger_entries');
SELECT safe_enable_rls('sessions');
SELECT safe_enable_rls('api_keys');
SELECT safe_enable_rls('refresh_token_families');
SELECT safe_enable_rls('proxy_listings');
SELECT safe_enable_rls('orders');
SELECT safe_enable_rls('saved_listings');
SELECT safe_enable_rls('escrow_transactions');
SELECT safe_enable_rls('disputes');
SELECT safe_enable_rls('circles');
SELECT safe_enable_rls('circle_members');
SELECT safe_enable_rls('circle_invites');
SELECT safe_enable_rls('circle_leases');
SELECT safe_enable_rls('circle_posts');
SELECT safe_enable_rls('circle_slas');
SELECT safe_enable_rls('circle_daily_stats');
SELECT safe_enable_rls('reviews');
SELECT safe_enable_rls('follows');
SELECT safe_enable_rls('feed_events');
SELECT safe_enable_rls('friendships');
SELECT safe_enable_rls('friend_requests');
SELECT safe_enable_rls('badges');
SELECT safe_enable_rls('user_badges');
SELECT safe_enable_rls('conversations');
SELECT safe_enable_rls('messages');
SELECT safe_enable_rls('proposals');
SELECT safe_enable_rls('votes');
SELECT safe_enable_rls('forum_categories');
SELECT safe_enable_rls('forum_threads');
SELECT safe_enable_rls('forum_posts');
SELECT safe_enable_rls('forum_votes');
SELECT safe_enable_rls('agents');
SELECT safe_enable_rls('agent_instances');
SELECT safe_enable_rls('agent_jobs');
SELECT safe_enable_rls('agent_outputs');
SELECT safe_enable_rls('market_agents');
SELECT safe_enable_rls('audit_logs');
SELECT safe_enable_rls('usage_records');
SELECT safe_enable_rls('linked_wallets');
SELECT safe_enable_rls('blockchain_state_cache');
SELECT safe_enable_rls('pending_transactions');
SELECT safe_enable_rls('encrypted_credentials');
SELECT safe_enable_rls('nodes');
SELECT safe_enable_rls('provider_nodes');
SELECT safe_enable_rls('kyc_verifications');
SELECT safe_enable_rls('totp_backup_codes');
SELECT safe_enable_rls('subscription_plans');
SELECT safe_enable_rls('user_subscriptions');
SELECT safe_enable_rls('proof_of_service');
SELECT safe_enable_rls('miner_weights');
SELECT safe_enable_rls('use_cases');
SELECT safe_enable_rls('user_preferences');
SELECT safe_enable_rls('provider_applications');

-- ============================================================
-- ADMIN CHECK FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM profiles
        WHERE id = auth.uid()
        AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- POLICIES FOR CORE TABLES (using DO blocks for safety)
-- ============================================================

-- PROFILES
DO $$ BEGIN
    CREATE POLICY "profiles_select_all" ON profiles FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE TO authenticated 
    USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- WALLETS
DO $$ BEGIN
    CREATE POLICY "wallets_select_own" ON wallets FOR SELECT TO authenticated USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "wallets_all_own" ON wallets FOR ALL TO authenticated USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;

-- SESSIONS
DO $$ BEGIN
    CREATE POLICY "sessions_own" ON sessions FOR ALL TO authenticated USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;

-- ORDERS
DO $$ BEGIN
    CREATE POLICY "orders_buyer" ON orders FOR SELECT TO authenticated USING (auth.uid() = buyer_id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "orders_seller" ON orders FOR SELECT TO authenticated USING (auth.uid() = seller_id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;

-- LISTINGS
DO $$ BEGIN
    CREATE POLICY "listings_select" ON proxy_listings FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "listings_manage" ON proxy_listings FOR ALL TO authenticated USING (auth.uid() = seller_id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;

-- API KEYS
DO $$ BEGIN
    CREATE POLICY "api_keys_own" ON api_keys FOR ALL TO authenticated USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;

-- LINKED WALLETS
DO $$ BEGIN
    CREATE POLICY "linked_wallets_own" ON linked_wallets FOR ALL TO authenticated USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;

-- CIRCLES
DO $$ BEGIN
    CREATE POLICY "circles_view" ON circles FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;

-- MESSAGES
DO $$ BEGIN
    CREATE POLICY "conversations_own" ON conversations FOR ALL TO authenticated 
    USING (participant1 = auth.uid() OR participant2 = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;

-- REVIEWS
DO $$ BEGIN
    CREATE POLICY "reviews_view" ON reviews FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;

-- FORUM
DO $$ BEGIN
    CREATE POLICY "forum_threads_view" ON forum_threads FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "forum_posts_view" ON forum_posts FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;

-- AGENTS
DO $$ BEGIN
    CREATE POLICY "agents_view" ON agents FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "agent_instances_own" ON agent_instances FOR ALL TO authenticated USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;

-- SERVICE ROLE ONLY TABLES
DO $$ BEGIN
    CREATE POLICY "audit_service" ON audit_logs FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "encrypted_service" ON encrypted_credentials FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;

-- ============================================================
-- ADMIN BYPASS
-- ============================================================

DO $$ BEGIN
    CREATE POLICY "admin_profiles" ON profiles FOR ALL TO authenticated USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "admin_orders" ON orders FOR ALL TO authenticated USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;

-- Cleanup helper function
DROP FUNCTION IF EXISTS safe_enable_rls(text);

-- ============================================================
-- DONE! RLS enabled on all existing tables
-- ============================================================
SELECT 'RLS enablement complete!' as status;
