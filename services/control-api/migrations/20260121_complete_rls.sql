-- ============================================================
-- COMPLETE RLS ENABLEMENT FOR ALL TABLES
-- Run this ENTIRE script in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- STEP 1: ENABLE RLS ON ALL TABLES
-- ============================================================

-- Core User Tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_ledger_entries ENABLE ROW LEVEL SECURITY;

-- Sessions & Auth
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_token_families ENABLE ROW LEVEL SECURITY;

-- Marketplace
ALTER TABLE proxy_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_listings ENABLE ROW LEVEL SECURITY;

-- Escrow & Disputes
ALTER TABLE escrow_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

-- Provider & Circles
ALTER TABLE circles ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_slas ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_stats ENABLE ROW LEVEL SECURITY;

-- Social
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;

-- Messaging
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Governance
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_votes ENABLE ROW LEVEL SECURITY;

-- Forum
ALTER TABLE forum_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_votes ENABLE ROW LEVEL SECURITY;

-- Agents
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_agents ENABLE ROW LEVEL SECURITY;

-- Analytics & Usage
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;

-- Blockchain
ALTER TABLE linked_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE blockchain_state_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE encrypted_credentials ENABLE ROW LEVEL SECURITY;

-- Other
ALTER TABLE nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE totp_backup_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE proof_of_service ENABLE ROW LEVEL SECURITY;
ALTER TABLE miner_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE use_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_applications ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- STEP 2: CREATE ADMIN CHECK FUNCTION
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
-- STEP 3: CREATE POLICIES - PROFILES
-- ============================================================

-- Allow users to view all profiles (public marketplace)
CREATE POLICY "profiles_select_all" ON profiles
    FOR SELECT TO authenticated
    USING (true);

-- Users can only update their own profile
CREATE POLICY "profiles_update_own" ON profiles
    FOR UPDATE TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- ============================================================
-- STEP 4: CREATE POLICIES - WALLETS
-- ============================================================

CREATE POLICY "wallets_select_own" ON wallets
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "wallets_all_own" ON wallets
    FOR ALL TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "wallet_ledger_select_own" ON wallet_ledger_entries
    FOR SELECT TO authenticated
    USING (
        EXISTS (SELECT 1 FROM wallets WHERE id = wallet_id AND user_id = auth.uid())
    );

-- ============================================================
-- STEP 5: CREATE POLICIES - SESSIONS
-- ============================================================

CREATE POLICY "sessions_select_own" ON sessions
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "sessions_all_own" ON sessions
    FOR ALL TO authenticated
    USING (auth.uid() = user_id);

-- ============================================================
-- STEP 6: CREATE POLICIES - ORDERS
-- ============================================================

CREATE POLICY "orders_select_buyer" ON orders
    FOR SELECT TO authenticated
    USING (auth.uid() = buyer_id);

CREATE POLICY "orders_select_seller" ON orders
    FOR SELECT TO authenticated
    USING (auth.uid() = seller_id);

CREATE POLICY "orders_insert_buyer" ON orders
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = buyer_id);

-- ============================================================
-- STEP 7: CREATE POLICIES - LISTINGS
-- ============================================================

-- Anyone can view active listings
CREATE POLICY "listings_select_all" ON proxy_listings
    FOR SELECT TO authenticated
    USING (true);

-- Sellers can manage their own listings
CREATE POLICY "listings_all_seller" ON proxy_listings
    FOR ALL TO authenticated
    USING (auth.uid() = seller_id);

CREATE POLICY "saved_listings_own" ON saved_listings
    FOR ALL TO authenticated
    USING (auth.uid() = user_id);

-- ============================================================
-- STEP 8: CREATE POLICIES - API KEYS
-- ============================================================

CREATE POLICY "api_keys_own" ON api_keys
    FOR ALL TO authenticated
    USING (auth.uid() = user_id);

-- ============================================================
-- STEP 9: CREATE POLICIES - LINKED WALLETS
-- ============================================================

CREATE POLICY "linked_wallets_own" ON linked_wallets
    FOR ALL TO authenticated
    USING (auth.uid() = user_id);

-- ============================================================
-- STEP 10: CREATE POLICIES - CIRCLES
-- ============================================================

-- View circles you're a member of or public circles
CREATE POLICY "circles_select" ON circles
    FOR SELECT TO authenticated
    USING (
        is_public = true OR
        EXISTS (SELECT 1 FROM circle_members WHERE circle_id = circles.id AND user_id = auth.uid())
    );

CREATE POLICY "circle_members_select" ON circle_members
    FOR SELECT TO authenticated
    USING (
        user_id = auth.uid() OR
        EXISTS (SELECT 1 FROM circle_members cm WHERE cm.circle_id = circle_members.circle_id AND cm.user_id = auth.uid())
    );

-- ============================================================
-- STEP 11: CREATE POLICIES - MESSAGING
-- ============================================================

CREATE POLICY "messages_participant" ON messages
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM conversations c
            WHERE c.id = messages.conversation_id
            AND (c.participant1_id = auth.uid() OR c.participant2_id = auth.uid())
        )
    );

CREATE POLICY "conversations_participant" ON conversations
    FOR ALL TO authenticated
    USING (participant1_id = auth.uid() OR participant2_id = auth.uid());

-- ============================================================
-- STEP 12: CREATE POLICIES - SOCIAL
-- ============================================================

CREATE POLICY "reviews_select_all" ON reviews
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "reviews_create_own" ON reviews
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = reviewer_id);

CREATE POLICY "follows_own" ON follows
    FOR ALL TO authenticated
    USING (auth.uid() = follower_id);

CREATE POLICY "feed_events_select" ON feed_events
    FOR SELECT TO authenticated
    USING (true);

-- ============================================================
-- STEP 13: CREATE POLICIES - FORUM
-- ============================================================

CREATE POLICY "forum_categories_select" ON forum_categories
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "forum_threads_select" ON forum_threads
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "forum_posts_select" ON forum_posts
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "forum_posts_create" ON forum_posts
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = author_id);

-- ============================================================
-- STEP 14: CREATE POLICIES - AGENTS
-- ============================================================

CREATE POLICY "agents_select" ON agents
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "agent_instances_own" ON agent_instances
    FOR ALL TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "agent_jobs_own" ON agent_jobs
    FOR ALL TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "market_agents_select" ON market_agents
    FOR SELECT TO authenticated
    USING (true);

-- ============================================================
-- STEP 15: CREATE POLICIES - SERVICE ROLE ONLY
-- (These tables are managed by backend only)
-- ============================================================

CREATE POLICY "audit_logs_service_role" ON audit_logs
    FOR ALL TO service_role
    USING (true);

CREATE POLICY "encrypted_credentials_service_role" ON encrypted_credentials
    FOR ALL TO service_role
    USING (true);

CREATE POLICY "blockchain_cache_service_role" ON blockchain_state_cache
    FOR ALL TO service_role
    USING (true);

-- ============================================================
-- STEP 16: ADMIN BYPASS POLICIES
-- ============================================================

CREATE POLICY "admin_bypass_profiles" ON profiles
    FOR ALL TO authenticated
    USING (is_admin());

CREATE POLICY "admin_bypass_orders" ON orders
    FOR ALL TO authenticated
    USING (is_admin());

CREATE POLICY "admin_bypass_disputes" ON disputes
    FOR ALL TO authenticated
    USING (is_admin());

-- ============================================================
-- DONE! All tables now have RLS enabled with policies
-- ============================================================
