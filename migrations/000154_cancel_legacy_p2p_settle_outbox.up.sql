-- ============================================================
-- Migration 000154: cancel queued p2p_settle outbox rows (BE-CRIT-01)
-- ============================================================
-- Internal P2P transfers used to enqueue a p2p_settle row that sent real SOL
-- from the treasury hot wallet to the recipient's linked wallet, on top of the
-- recipient's ledger credit. The enqueue was removed; this retires rows that
-- were queued before the fix so they are never paid out.
--
-- 'failed_permanent' keeps the audit trail and satisfies the existing status
-- CHECK constraint (pending / succeeded / failed_permanent).
-- ============================================================

UPDATE compensation_outbox
SET status = 'failed_permanent',
    last_error = 'cancelled: on-chain P2P settle removed (BE-CRIT-01)'
WHERE kind = 'p2p_settle'
  AND status = 'pending';
