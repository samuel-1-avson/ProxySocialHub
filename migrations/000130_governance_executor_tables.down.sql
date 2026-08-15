DROP INDEX IF EXISTS idx_governance_proposals_onchain_pda;
ALTER TABLE governance_proposals DROP COLUMN IF EXISTS onchain_pda;

DROP TABLE IF EXISTS pending_upgrades;
DROP TABLE IF EXISTS slashing_events;
DROP TABLE IF EXISTS parameter_audits;
DROP TABLE IF EXISTS protocol_parameters;
DROP TABLE IF EXISTS treasury_transactions;
