-- Fix profiles table: add columns the User GORM model expects but migration 000001 omitted.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS status              VARCHAR(50)   NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS social_links        JSONB,
    ADD COLUMN IF NOT EXISTS skills              TEXT[],
    ADD COLUMN IF NOT EXISTS professional_title  VARCHAR(100),
    ADD COLUMN IF NOT EXISTS experience_years    INT           NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS languages           TEXT[],
    ADD COLUMN IF NOT EXISTS primary_specialization VARCHAR(100),
    ADD COLUMN IF NOT EXISTS business_name       VARCHAR(100),
    ADD COLUMN IF NOT EXISTS tax_id              VARCHAR(50),
    ADD COLUMN IF NOT EXISTS paystack_recipient_code VARCHAR(50),
    ADD COLUMN IF NOT EXISTS verification_token  VARCHAR(255),
    ADD COLUMN IF NOT EXISTS email_verified      BOOLEAN       NOT NULL DEFAULT FALSE;

-- governance_proposals table
CREATE TABLE IF NOT EXISTS governance_proposals (
    id             UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    title          VARCHAR(255)  NOT NULL,
    description    TEXT          NOT NULL,
    proposer_id    UUID          NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type           VARCHAR(50)   NOT NULL DEFAULT 'general',
    start_time     TIMESTAMPTZ   NOT NULL,
    end_time       TIMESTAMPTZ   NOT NULL,
    status         VARCHAR(50)   NOT NULL DEFAULT 'active',
    execution_data TEXT,
    quorum         NUMERIC(10,2) NOT NULL DEFAULT 100,
    ipfs_hash      VARCHAR(100),
    arweave_tx_id  VARCHAR(64),
    yes_votes      NUMERIC(20,4) NOT NULL DEFAULT 0,
    no_votes       NUMERIC(20,4) NOT NULL DEFAULT 0,
    thread_id      UUID,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    deleted_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_gov_proposals_status    ON governance_proposals (status);
CREATE INDEX IF NOT EXISTS idx_gov_proposals_proposer  ON governance_proposals (proposer_id);

-- governance votes (referenced by the API)
CREATE TABLE IF NOT EXISTS governance_votes (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    proposal_id UUID        NOT NULL REFERENCES governance_proposals(id) ON DELETE CASCADE,
    voter_id    UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    vote        VARCHAR(10) NOT NULL CHECK (vote IN ('yes', 'no', 'abstain')),
    weight      NUMERIC(20,4) NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (proposal_id, voter_id)
);
CREATE INDEX IF NOT EXISTS idx_gov_votes_proposal ON governance_votes (proposal_id);

-- usage_proofs table (ZK billing aggregator)
CREATE TABLE IF NOT EXISTS usage_proofs (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id          UUID        NOT NULL,
    order_id            UUID,
    buyer_wallet        VARCHAR(64) NOT NULL,
    provider_wallet     VARCHAR(64) NOT NULL,
    bytes_uploaded      BIGINT      NOT NULL DEFAULT 0,
    bytes_downloaded    BIGINT      NOT NULL DEFAULT 0,
    total_bytes         BIGINT      NOT NULL DEFAULT 0,
    request_count       BIGINT      NOT NULL DEFAULT 0,
    period_start        TIMESTAMPTZ NOT NULL,
    period_end          TIMESTAMPTZ NOT NULL,
    message_hash        VARCHAR(64) NOT NULL,
    buyer_signature     VARCHAR(128),
    provider_signature  VARCHAR(128),
    buyer_signed_at     TIMESTAMPTZ,
    provider_signed_at  TIMESTAMPTZ,
    on_chain_tx_hash    VARCHAR(128),
    on_chain_slot       BIGINT      NOT NULL DEFAULT 0,
    status              VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usage_proofs_session ON usage_proofs (session_id);
CREATE INDEX IF NOT EXISTS idx_usage_proofs_status  ON usage_proofs (status);
