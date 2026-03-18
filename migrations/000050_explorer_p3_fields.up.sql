-- P3-05: SPL token support columns on explorer_transactions.
ALTER TABLE explorer_transactions
    ADD COLUMN IF NOT EXISTS token_mint  VARCHAR(128) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS is_orphaned BOOLEAN      NOT NULL DEFAULT FALSE;

-- P3-06: Re-org detection column on explorer_blocks.
ALTER TABLE explorer_blocks
    ADD COLUMN IF NOT EXISTS is_orphaned BOOLEAN NOT NULL DEFAULT FALSE;

-- Index to quickly find all orphaned blocks/txs for cleanup or display.
CREATE INDEX IF NOT EXISTS idx_explorer_blocks_orphaned ON explorer_blocks (is_orphaned) WHERE is_orphaned = TRUE;
CREATE INDEX IF NOT EXISTS idx_explorer_tx_orphaned    ON explorer_transactions (is_orphaned) WHERE is_orphaned = TRUE;
CREATE INDEX IF NOT EXISTS idx_explorer_tx_token_mint  ON explorer_transactions (token_mint)  WHERE token_mint != '';
