-- W-25: freeze platform-fee behaviour per order at funding time so a
-- program upgrade (fee skim on/off) never silently flips release
-- accounting for in-flight escrows.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS platform_fee_bps INT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS platform_fee_skim_recorded BOOLEAN NOT NULL DEFAULT FALSE;
