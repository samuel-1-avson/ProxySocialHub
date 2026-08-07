-- ============================================================
-- Migration 000139: P2P settle outbox (BE-10)
-- ============================================================
-- Extends compensation_outbox to durable forward settles after
-- P2P ledger commit (survives process crash).
-- ============================================================

ALTER TABLE compensation_outbox DROP CONSTRAINT IF EXISTS compensation_outbox_kind_check;
ALTER TABLE compensation_outbox
  ADD CONSTRAINT compensation_outbox_kind_check
  CHECK (kind IN ('withdrawal_refund', 'p2p_refund', 'p2p_settle'));

ALTER TABLE compensation_outbox
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
