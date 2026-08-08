ALTER TABLE orders
  DROP COLUMN IF EXISTS escrow_seed_kind,
  DROP COLUMN IF EXISTS escrow_expires_at;
