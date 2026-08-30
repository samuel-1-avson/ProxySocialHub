-- Allow durable marketplace escrow settle/refund retries in compensation_outbox.
ALTER TABLE compensation_outbox DROP CONSTRAINT IF EXISTS compensation_outbox_kind_check;
ALTER TABLE compensation_outbox
  ADD CONSTRAINT compensation_outbox_kind_check
  CHECK (kind IN (
    'withdrawal_refund',
    'p2p_refund',
    'p2p_settle',
    'escrow_settle',
    'escrow_refund'
  ));
