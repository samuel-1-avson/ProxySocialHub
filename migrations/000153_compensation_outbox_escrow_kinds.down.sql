-- Reverse 000153: drop escrow outbox kinds.
ALTER TABLE compensation_outbox DROP CONSTRAINT IF EXISTS compensation_outbox_kind_check;
ALTER TABLE compensation_outbox
  ADD CONSTRAINT compensation_outbox_kind_check
  CHECK (kind IN ('withdrawal_refund', 'p2p_refund', 'p2p_settle'));
