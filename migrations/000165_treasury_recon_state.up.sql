-- P2-G: incremental reconciliation watermark (single-row state).
CREATE TABLE IF NOT EXISTS treasury_recon_state (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    last_verified_at TIMESTAMPTZ NOT NULL DEFAULT 'epoch',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO treasury_recon_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
