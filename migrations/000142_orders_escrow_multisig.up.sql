-- BC-06: amount-gated escrow_multisig PDA metadata on orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS escrow_seed_kind VARCHAR(16) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS escrow_expires_at BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN orders.escrow_seed_kind IS 'legacy | multisig (empty treated as legacy)';
COMMENT ON COLUMN orders.escrow_expires_at IS 'unix seconds used in escrow_multisig PDA seeds';
