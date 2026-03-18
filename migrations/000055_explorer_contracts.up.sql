CREATE TABLE IF NOT EXISTS explorer_contracts (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    address         VARCHAR(128) NOT NULL,
    chain           VARCHAR(20)  NOT NULL DEFAULT 'solana',
    name            VARCHAR(255) NOT NULL DEFAULT '',
    contract_type   VARCHAR(50)  NOT NULL DEFAULT 'custom',
    is_verified     BOOLEAN      NOT NULL DEFAULT FALSE,
    source_code_hash VARCHAR(128),
    deploy_tx_hash  VARCHAR(128),
    deployer_address VARCHAR(128),
    total_calls     BIGINT       NOT NULL DEFAULT 0,
    total_volume    NUMERIC(30,8) NOT NULL DEFAULT 0,
    deployed_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_explorer_contracts_address UNIQUE (address)
);

CREATE INDEX IF NOT EXISTS idx_explorer_contracts_chain ON explorer_contracts (chain);
CREATE INDEX IF NOT EXISTS idx_explorer_contracts_type  ON explorer_contracts (contract_type);
