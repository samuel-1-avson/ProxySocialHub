-- Migration: Remove Batch Payout Processing (Rollback)
-- Description: Removes batch payout tables
-- Created: 2026-03-14

-- Drop tables in reverse order of creation
DROP TABLE IF EXISTS pending_payouts;
DROP TABLE IF EXISTS batch_payout_items;
DROP TABLE IF EXISTS batch_payouts;

-- Add migration tracking
INSERT INTO schema_migrations (version, description) 
VALUES (29, 'Rollback: Remove batch payout processing tables');
