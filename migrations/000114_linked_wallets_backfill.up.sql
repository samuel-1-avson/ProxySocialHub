-- Ensure linked_wallets exists (legacy create lived outside numbered migrations),
-- then backfill from profiles.wallet_address for marketplace escrow.

CREATE TABLE IF NOT EXISTS linked_wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    chain VARCHAR(20) NOT NULL,
    address VARCHAR(64) NOT NULL,
    verified BOOLEAN DEFAULT FALSE,
    verification_signature TEXT,
    verification_message VARCHAR(255),
    is_primary BOOLEAN DEFAULT FALSE,
    label VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(chain, address)
);

CREATE INDEX IF NOT EXISTS idx_linked_wallet_user ON linked_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_linked_wallet_chain ON linked_wallets(chain);
CREATE UNIQUE INDEX IF NOT EXISTS idx_linked_wallet_unique ON linked_wallets(chain, address);

-- Backfill primary Solana rows from profile wallet_address.
INSERT INTO linked_wallets (
    id,
    user_id,
    chain,
    address,
    verified,
    is_primary,
    label,
    created_at,
    updated_at
)
SELECT
    uuid_generate_v4(),
    p.id,
    'solana',
    TRIM(p.wallet_address),
    true,
    true,
    'Primary',
    NOW(),
    NOW()
FROM profiles p
WHERE p.wallet_address IS NOT NULL
  AND TRIM(p.wallet_address) <> ''
  AND NOT EXISTS (
      SELECT 1 FROM linked_wallets lw
      WHERE lw.chain = 'solana' AND lw.address = TRIM(p.wallet_address)
  )
  AND NOT EXISTS (
      SELECT 1 FROM linked_wallets lw2
      WHERE lw2.user_id = p.id AND lw2.chain = 'solana' AND lw2.is_primary = true
  );

UPDATE linked_wallets lw
SET is_primary = true,
    verified = true,
    updated_at = NOW()
FROM profiles p
WHERE lw.user_id = p.id
  AND lw.chain = 'solana'
  AND p.wallet_address IS NOT NULL
  AND lw.address = TRIM(p.wallet_address)
  AND lw.is_primary = false
  AND NOT EXISTS (
      SELECT 1 FROM linked_wallets other
      WHERE other.user_id = p.id
        AND other.chain = 'solana'
        AND other.is_primary = true
        AND other.id <> lw.id
  );
