-- P1-09: Prevent duplicate milestone rows for the same escrow + byte threshold.
-- Without this a race between two concurrent milestone-release calls could insert
-- two identical rows and release the same funds twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_escrow_milestones_escrow_threshold
    ON escrow_milestones (escrow_id, byte_threshold);
