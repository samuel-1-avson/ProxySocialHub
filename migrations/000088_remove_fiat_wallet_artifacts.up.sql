-- Phase 3: remove dead fiat wallet columns and non-SOL pending transactions
ALTER TABLE wallets DROP COLUMN IF EXISTS balance_usdt;

DELETE FROM pending_transactions WHERE currency IS NOT NULL AND currency != 'SOL';

ALTER TABLE profiles DROP COLUMN IF EXISTS paystack_recipient_code;
