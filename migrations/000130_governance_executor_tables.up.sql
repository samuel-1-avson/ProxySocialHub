-- Governance executor audit tables + proposal on-chain PDA.
-- Required after AutoMigrate removal so passed proposals can record custody
-- queues, parameter audits, slash events, and upgrade schedules.

CREATE TABLE IF NOT EXISTS treasury_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    proposal_id UUID NOT NULL,
    recipient VARCHAR(64) NOT NULL,
    amount DOUBLE PRECISION NOT NULL,
    currency VARCHAR(10) NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    tx_hash VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    executed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_treasury_transactions_proposal_id
    ON treasury_transactions (proposal_id);
CREATE INDEX IF NOT EXISTS idx_treasury_transactions_status
    ON treasury_transactions (status);

CREATE TABLE IF NOT EXISTS protocol_parameters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_protocol_parameters_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS parameter_audits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parameter VARCHAR(100) NOT NULL,
    old_value TEXT,
    new_value TEXT,
    reason TEXT,
    proposal_id UUID,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parameter_audits_parameter
    ON parameter_audits (parameter);

CREATE TABLE IF NOT EXISTS slashing_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    proposal_id UUID,
    gateway_address VARCHAR(64) NOT NULL,
    slash_percentage SMALLINT NOT NULL,
    reason TEXT,
    evidence VARCHAR(100),
    tx_hash VARCHAR(128),
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slashing_events_gateway
    ON slashing_events (gateway_address);

CREATE TABLE IF NOT EXISTS pending_upgrades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    proposal_id UUID NOT NULL,
    program_id VARCHAR(64) NOT NULL,
    new_version VARCHAR(128) NOT NULL,
    changelog_cid VARCHAR(100),
    rollback_plan_cid VARCHAR(100),
    scheduled_at TIMESTAMPTZ NOT NULL,
    executed_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_upgrades_status
    ON pending_upgrades (status);

ALTER TABLE governance_proposals
    ADD COLUMN IF NOT EXISTS onchain_pda VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_governance_proposals_onchain_pda
    ON governance_proposals (onchain_pda)
    WHERE onchain_pda IS NOT NULL AND onchain_pda <> '';

COMMENT ON COLUMN governance_proposals.onchain_pda IS
    'Base58 PDA of on-chain gov_proposal account when created via chain flow.';
COMMENT ON COLUMN treasury_transactions.status IS
    'pending|pending_custody|completed|failed_* — pending_custody means no auto hot-wallet spend.';
