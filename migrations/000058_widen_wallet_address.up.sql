-- Solana addresses are 44 chars (base58-encoded 32-byte pubkey).
-- The original profiles table used VARCHAR(42) which is too short.
ALTER TABLE profiles ALTER COLUMN wallet_address TYPE VARCHAR(64);
