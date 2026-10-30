-- ============================================================
-- Migration 000157: Google sign-in identities + embedded (managed) wallets
-- ============================================================
-- user_identities: external login identities (Google `sub`) mapped to a profile.
--   Lookups go by (provider, subject), never by email.
-- embedded_wallets: a Solana wallet the server creates for users who sign in
--   without a crypto wallet. The ed25519 private key is sealed with a random
--   per-wallet data key (AES-256-GCM, AAD = user_id|address); the data key is
--   wrapped by a key-encryption key (kek_id says which: local:v1 or a KMS key).
--   Plaintext keys are never stored.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_identities (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    provider      TEXT NOT NULL,
    subject       TEXT NOT NULL,
    email_hash    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    CONSTRAINT user_identities_provider_subject_key UNIQUE (provider, subject)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities (user_id);

CREATE TABLE IF NOT EXISTS embedded_wallets (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE RESTRICT,
    chain       TEXT NOT NULL DEFAULT 'solana',
    address     TEXT NOT NULL UNIQUE,
    sealed_key  BYTEA NOT NULL,
    wrapped_dek BYTEA NOT NULL,
    kek_id      TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
