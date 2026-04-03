-- Multi-indexer attestations for explorer decentralization quorum.
CREATE TABLE IF NOT EXISTS explorer_block_attestations (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    chain        VARCHAR(20)  NOT NULL DEFAULT 'solana',
    slot         BIGINT       NOT NULL,
    block_hash   VARCHAR(128) NOT NULL,
    parent_hash  VARCHAR(128) NOT NULL DEFAULT '',
    writer_id    VARCHAR(128) NOT NULL,
    rpc_endpoint VARCHAR(255) NOT NULL DEFAULT '',
    attested_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_explorer_block_att_chain_slot_writer UNIQUE (chain, slot, writer_id)
);

CREATE INDEX IF NOT EXISTS idx_explorer_block_att_chain_slot
    ON explorer_block_attestations (chain, slot DESC);

CREATE INDEX IF NOT EXISTS idx_explorer_block_att_chain_slot_hash
    ON explorer_block_attestations (chain, slot DESC, block_hash);

CREATE INDEX IF NOT EXISTS idx_explorer_block_att_writer
    ON explorer_block_attestations (writer_id);

CREATE INDEX IF NOT EXISTS idx_explorer_block_att_attested_at
    ON explorer_block_attestations (attested_at DESC);
