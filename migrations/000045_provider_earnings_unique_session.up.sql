-- P1-14: Prevent duplicate provider earnings rows for the same provider + session.
-- Without this a race between two concurrent billing workers could insert two
-- identical rows and pay the provider twice for the same session.
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_earnings_provider_session
    ON provider_earnings (provider_user_id, session_id);
