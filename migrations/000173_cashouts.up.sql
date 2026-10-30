-- ============================================================
-- Migration 000159: cash out to Mobile Money for managed-wallet providers
-- ============================================================
-- A provider who signed in with Google earns SOL into their ProxyHubb-managed
-- wallet. To pay them in cedis, the server signs a transfer from that wallet to
-- the platform float, then sends GHS with a Paystack Transfer.
--
-- cashouts.status moves forward only:
--   quoted -> confirmed -> sweeping -> swept -> transferring -> completed
--   transfer failed after the sweep: refunding -> refunded (SOL sent back)
--   quote not confirmed in time: expired
--   failed: needs ops (never after a landed sweep without a refund attempt)
--
-- No foreign keys on purpose: payment records outlive account deletion.
-- ============================================================

CREATE TABLE IF NOT EXISTS payout_destinations (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID NOT NULL UNIQUE,
    type           TEXT NOT NULL DEFAULT 'mobile_money' CHECK (type IN ('mobile_money')),
    network        TEXT NOT NULL CHECK (network IN ('MTN', 'VOD', 'ATL')),
    phone_enc      TEXT NOT NULL,
    phone_last4    TEXT NOT NULL,
    account_name   TEXT NOT NULL,
    recipient_code TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cashouts (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID NOT NULL,
    destination_id UUID NOT NULL,
    reference      TEXT NOT NULL UNIQUE,
    lamports       BIGINT NOT NULL CHECK (lamports > 0),
    amount_minor   BIGINT NOT NULL CHECK (amount_minor > 0),
    fee_minor      BIGINT NOT NULL DEFAULT 0,
    currency       TEXT NOT NULL DEFAULT 'GHS',
    sol_price_usd  NUMERIC(20,6) NOT NULL,
    usd_ghs_rate   NUMERIC(20,6) NOT NULL,
    status         TEXT NOT NULL DEFAULT 'quoted'
        CHECK (status IN ('quoted', 'confirmed', 'sweeping', 'swept', 'transferring',
                          'completed', 'refunding', 'refunded', 'expired', 'failed')),
    sweep_tx       TEXT,
    sweep_sent_at  TIMESTAMPTZ,
    transfer_code  TEXT,
    refund_tx      TEXT,
    -- Set before the refund is sent. A refund that started but never recorded a tx
    -- is left for ops instead of being retried, so it can never be paid twice.
    refund_started_at TIMESTAMPTZ,
    attempts       INT NOT NULL DEFAULT 0,
    last_error     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cashouts_user_created ON cashouts (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cashouts_open ON cashouts (status)
    WHERE status IN ('confirmed', 'sweeping', 'swept', 'transferring', 'refunding');

-- One cash-out in progress per user (a quote doesn't count until confirmed).
CREATE UNIQUE INDEX IF NOT EXISTS uq_cashouts_user_open ON cashouts (user_id)
    WHERE status IN ('confirmed', 'sweeping', 'swept', 'transferring', 'refunding');
