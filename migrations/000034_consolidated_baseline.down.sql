-- I4: Rollback consolidated baseline.
-- WARNING: Dropping these tables is destructive. Only run in a dev/test environment.
-- In production, prefer a targeted rollback of specific objects rather than this script.

DELETE FROM schema_migrations WHERE version = 34;

DROP TABLE IF EXISTS pending_payouts;
DROP TABLE IF EXISTS batch_payout_items;
DROP TABLE IF EXISTS batch_payouts;
DROP TABLE IF EXISTS disputes;
DROP TABLE IF EXISTS provider_earnings;
DROP TABLE IF EXISTS provider_node_registrations;
DROP TABLE IF EXISTS cli_downloads;
DROP TABLE IF EXISTS provider_tokens;

-- Restore balance_sol default (column drop not reverted — multi-currency removal is one-way)
-- ALTER TABLE wallets ADD COLUMN IF NOT EXISTS balance_ghs NUMERIC(20,9) DEFAULT 0; -- uncomment to restore
