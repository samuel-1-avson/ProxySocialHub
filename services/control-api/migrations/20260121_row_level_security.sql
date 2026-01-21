-- ============================================================
-- SUPABASE ROW-LEVEL SECURITY (RLS) POLICIES
-- Run this in Supabase SQL Editor
-- ============================================================

-- Enable RLS on all user-facing tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE linked_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE encrypted_credentials ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PROFILES: Users can only read/update their own profile
-- ============================================================

CREATE POLICY "Users can view own profile"
    ON profiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
    ON profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Public profiles are viewable by anyone (for marketplace)
CREATE POLICY "Public profiles viewable by authenticated users"
    ON profiles FOR SELECT
    TO authenticated
    USING (true);

-- ============================================================
-- WALLETS: Users can only access their own wallet
-- ============================================================

CREATE POLICY "Users can view own wallet"
    ON wallets FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own wallet"
    ON wallets FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- WALLET LEDGER: Users can only view their own transactions
-- ============================================================

CREATE POLICY "Users can view own ledger entries"
    ON wallet_ledger_entries FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM wallets 
            WHERE wallets.id = wallet_ledger_entries.wallet_id 
            AND wallets.user_id = auth.uid()
        )
    );

-- ============================================================
-- SESSIONS: Users can only access their own sessions
-- ============================================================

CREATE POLICY "Users can view own sessions"
    ON sessions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own sessions"
    ON sessions FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- ORDERS: Users can view orders where they are buyer or seller
-- ============================================================

CREATE POLICY "Users can view own orders as buyer"
    ON orders FOR SELECT
    USING (auth.uid() = buyer_id);

CREATE POLICY "Sellers can view orders where they are seller"
    ON orders FOR SELECT
    USING (auth.uid() = seller_id);

CREATE POLICY "Buyers can create orders"
    ON orders FOR INSERT
    WITH CHECK (auth.uid() = buyer_id);

-- ============================================================
-- API KEYS: Users can only manage their own API keys
-- ============================================================

CREATE POLICY "Users can view own API keys"
    ON api_keys FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own API keys"
    ON api_keys FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- LINKED WALLETS: Users can only manage their own linked wallets
-- ============================================================

CREATE POLICY "Users can view own linked wallets"
    ON linked_wallets FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own linked wallets"
    ON linked_wallets FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- ENCRYPTED CREDENTIALS: Only accessible via service role
-- ============================================================

-- No user policies - only service role can access
CREATE POLICY "Service role only for credentials"
    ON encrypted_credentials FOR ALL
    TO service_role
    USING (true);

-- ============================================================
-- ADMIN BYPASS POLICIES
-- For admin users who need full access
-- ============================================================

-- Create admin role check function
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

-- Admin policies for profiles
CREATE POLICY "Admins can view all profiles"
    ON profiles FOR SELECT
    TO authenticated
    USING (is_admin());

CREATE POLICY "Admins can update all profiles"
    ON profiles FOR UPDATE
    TO authenticated
    USING (is_admin());

-- Admin policies for orders
CREATE POLICY "Admins can view all orders"
    ON orders FOR SELECT
    TO authenticated
    USING (is_admin());

CREATE POLICY "Admins can update all orders"
    ON orders FOR UPDATE
    TO authenticated
    USING (is_admin());

-- ============================================================
-- HELPER: Grant service role bypass
-- ============================================================

-- Ensure service role can bypass RLS
ALTER TABLE profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE wallets FORCE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;

COMMENT ON POLICY "Users can view own profile" ON profiles IS 'Users can only access their own profile data';
COMMENT ON POLICY "Service role only for credentials" ON encrypted_credentials IS 'Sensitive credentials only accessible by backend service';
