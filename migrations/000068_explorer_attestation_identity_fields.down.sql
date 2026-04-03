DROP INDEX IF EXISTS idx_explorer_block_att_writer_public_key;

ALTER TABLE explorer_block_attestations
    DROP COLUMN IF EXISTS attestation_signature,
    DROP COLUMN IF EXISTS signature_scheme,
    DROP COLUMN IF EXISTS writer_public_key;
