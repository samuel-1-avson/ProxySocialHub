-- ============================================================
-- Migration 000158: fiat (Paystack) payments for managed-wallet buyers
-- ============================================================
-- A buyer without a crypto wallet pays in GHS through Paystack. Once Paystack
-- confirms the charge, the treasury sends the quoted SOL to the buyer's managed
-- wallet (embedded_wallets), and the server signs the normal on-chain escrow
-- with that wallet. Providers see no difference.
--
-- One row per quote. Status moves forward only:
--   quoted -> paid -> funded -> escrowed -> active
--   (or failed / refunded)
-- At most one row per order may reach `paid` or later; a second payment for
-- the same order is refunded.
--
-- No foreign keys on purpose: this is a payment record and must outlive
-- account or order deletion for reconciliation with Paystack.
-- ============================================================

CREATE TABLE IF NOT EXISTS fiat_payments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id        UUID NOT NULL,
    user_id         UUID NOT NULL,
    provider        TEXT NOT NULL DEFAULT 'paystack',
    reference       TEXT NOT NULL UNIQUE,
    access_code     TEXT,
    amount_minor    BIGINT NOT NULL CHECK (amount_minor > 0),
    currency        TEXT NOT NULL DEFAULT 'GHS',
    usd_amount      NUMERIC(20,6) NOT NULL,
    usd_ghs_rate    NUMERIC(20,6) NOT NULL,
    sol_price_usd   NUMERIC(20,6) NOT NULL,
    lamports_needed BIGINT NOT NULL CHECK (lamports_needed > 0),
    lamports_funded BIGINT NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'quoted'
        CHECK (status IN ('quoted', 'paid', 'funded', 'escrowed', 'active', 'failed', 'refunded')),
    provider_tx_id  BIGINT,
    funding_tx      TEXT,
    escrow_tx       TEXT,
    attempts        INT NOT NULL DEFAULT 0,
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fiat_payments_order_id ON fiat_payments (order_id);
CREATE INDEX IF NOT EXISTS idx_fiat_payments_user_created ON fiat_payments (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_fiat_payments_pending ON fiat_payments (status)
    WHERE status IN ('paid', 'funded', 'escrowed');

-- Only one paid (or further along) payment may back an order.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiat_payments_order_paid ON fiat_payments (order_id)
    WHERE status IN ('paid', 'funded', 'escrowed', 'active');
