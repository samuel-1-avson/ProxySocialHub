ALTER TABLE explorer_block_attestations
    ADD COLUMN IF NOT EXISTS writer_public_key TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS signature_scheme VARCHAR(32) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS attestation_signature TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_explorer_block_att_writer_public_key
    ON explorer_block_attestations (writer_public_key);
