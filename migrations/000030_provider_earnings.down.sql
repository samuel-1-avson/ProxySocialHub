DROP INDEX IF EXISTS idx_pending_payout_idempotency;
ALTER TABLE pending_payouts DROP COLUMN IF EXISTS idempotency_key;

ALTER TABLE provider_nodes DROP COLUMN IF EXISTS demotion_warnings;
ALTER TABLE provider_nodes DROP COLUMN IF EXISTS wallet_address;

DROP INDEX IF EXISTS idx_earning_status;
DROP INDEX IF EXISTS idx_earning_node;
DROP INDEX IF EXISTS idx_earning_provider_user;
DROP INDEX IF EXISTS idx_earning_session;
DROP TABLE IF EXISTS provider_earnings;
