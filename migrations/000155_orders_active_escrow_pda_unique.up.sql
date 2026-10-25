-- ============================================================
-- Migration 000155: one escrow PDA backs one live order (BE-CRIT-03)
-- ============================================================
-- A legacy escrow PDA is a single account per buyer/seller pair. Confirming a second
-- order against a PDA that an active (or disputed) order already holds would give the
-- second order service paid for by the first. The API checks this before activating;
-- this index makes it race-proof.
--
-- Pending, completed, refunded and cancelled orders do not hold the escrow, so they
-- may share a PDA with each other and with a live order.
--
-- If this fails, two live orders already point at the same escrow_pda. Find them with:
--   SELECT escrow_pda, array_agg(id), count(*) FROM orders
--   WHERE status IN ('active','disputed') AND escrow_pda IS NOT NULL AND escrow_pda <> ''
--   GROUP BY escrow_pda HAVING count(*) > 1;
-- then settle, refund or cancel all but one of each group and re-run the migration.
-- ============================================================

DO $$
DECLARE
    dup_count integer;
BEGIN
    SELECT count(*) INTO dup_count FROM (
        SELECT escrow_pda FROM orders
        WHERE status IN ('active', 'disputed') AND escrow_pda IS NOT NULL AND escrow_pda <> ''
        GROUP BY escrow_pda HAVING count(*) > 1
    ) d;
    IF dup_count > 0 THEN
        RAISE EXCEPTION 'migration 000155: % escrow_pda value(s) are shared by more than one active/disputed order; resolve them first (see the query in this file)', dup_count;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_live_escrow_pda
    ON orders (escrow_pda)
    WHERE status IN ('active', 'disputed') AND escrow_pda IS NOT NULL AND escrow_pda <> '';
