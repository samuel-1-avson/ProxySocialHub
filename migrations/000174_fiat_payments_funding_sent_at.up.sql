-- ============================================================
-- Migration 000160: one-transaction funding for fiat payments
-- ============================================================
-- The treasury top-up and initialize_escrow now go out as a single transaction.
-- Its signature is stored in funding_tx before it is sent; funding_sent_at lets a
-- retry tell "still landing" from "dropped" (blockhash expired) so the payment is
-- never funded twice.
-- ============================================================

ALTER TABLE fiat_payments ADD COLUMN IF NOT EXISTS funding_sent_at TIMESTAMPTZ;
