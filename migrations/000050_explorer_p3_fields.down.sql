ALTER TABLE explorer_transactions DROP COLUMN IF EXISTS token_mint;
ALTER TABLE explorer_transactions DROP COLUMN IF EXISTS is_orphaned;
ALTER TABLE explorer_blocks       DROP COLUMN IF EXISTS is_orphaned;
