-- Reverse 000154: intentionally a no-op.
-- Re-queuing cancelled p2p_settle rows would resume treasury-funded on-chain
-- sends for internal transfers (BE-CRIT-01), so the cancellation is not undone.
SELECT 1;
