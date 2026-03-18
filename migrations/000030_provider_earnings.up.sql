-- Provider earnings table: records SOL earned per session, per node
CREATE TABLE IF NOT EXISTS provider_earnings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_user_id    UUID NOT NULL,
    node_id             UUID NOT NULL,
    session_id          UUID NOT NULL,
    bandwidth_gb        NUMERIC(20, 8) NOT NULL DEFAULT 0,
    gross_amount_sol    NUMERIC(20, 8) NOT NULL DEFAULT 0,
    platform_fee_sol    NUMERIC(20, 8) NOT NULL DEFAULT 0,
    net_amount_sol      NUMERIC(20, 8) NOT NULL DEFAULT 0,
    earnings_multiplier NUMERIC(5, 4)  NOT NULL DEFAULT 1.0,
    price_per_gb        NUMERIC(20, 8) NOT NULL DEFAULT 0,
    status              VARCHAR(20)    NOT NULL DEFAULT 'pending',
    payout_batch_id     UUID,
    tx_hash             VARCHAR(128),
    created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    paid_at             TIMESTAMPTZ,
    deleted_at          TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_earning_session        ON provider_earnings(session_id) WHERE deleted_at IS NULL;
CREATE        INDEX IF NOT EXISTS idx_earning_provider_user  ON provider_earnings(provider_user_id);
CREATE        INDEX IF NOT EXISTS idx_earning_node           ON provider_earnings(node_id);
CREATE        INDEX IF NOT EXISTS idx_earning_status         ON provider_earnings(status);

-- Add wallet_address to provider_nodes so earnings can be paid out
ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS wallet_address VARCHAR(64);

-- Add demotion_warnings counter for tier grace-period logic
ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS demotion_warnings INT NOT NULL DEFAULT 0;

-- Add idempotency_key to pending_payouts to prevent double-payouts
ALTER TABLE pending_payouts ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_payout_idempotency ON pending_payouts(idempotency_key) WHERE idempotency_key IS NOT NULL;
