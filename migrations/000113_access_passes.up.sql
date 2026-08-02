-- Access Pass primary sales + legacy subscriber airdrop queue
CREATE TABLE IF NOT EXISTS pass_purchases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    tier VARCHAR(20) NOT NULL,
    mint VARCHAR(64),
    buyer_wallet VARCHAR(64) NOT NULL,
    treasury_wallet VARCHAR(64) NOT NULL,
    amount_sol NUMERIC(20, 9) NOT NULL,
    tx_signature VARCHAR(128),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    idempotency_key VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pass_purchases_tx_signature
    ON pass_purchases (tx_signature) WHERE tx_signature IS NOT NULL AND tx_signature <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_pass_purchases_idempotency
    ON pass_purchases (idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';
CREATE INDEX IF NOT EXISTS idx_pass_purchases_user_status
    ON pass_purchases (user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS pass_airdrop_claims (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    tier VARCHAR(20) NOT NULL,
    wallet_address VARCHAR(64),
    source_plan_name VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'eligible',
    tx_signature VARCHAR(128),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, tier)
);

CREATE INDEX IF NOT EXISTS idx_pass_airdrop_status ON pass_airdrop_claims (status, tier);
